import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, HAIKU_MODEL } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import {
  buildSummaryChunkPrompt,
  buildKeywordRowPrompt,
  buildCrossCourseSynthesisPrompt,
  CATEGORY_SUPERSET,
  type ModuleSynthesisCourseInput,
} from "@/lib/ai/module-synthesis-prompts";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import {
  lookupCourseWorkspaceChunks,
  storeCourseWorkspaceChunks,
  recordCourseWorkspaceCacheHits,
  type CourseWorkspaceGenerationType,
  type KeywordCategories,
} from "@/lib/course-workspace-cache";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
export const maxDuration = 300;

type WorkspaceType = "global_summary" | "keywords_table";
const VALID_TYPES: WorkspaceType[] = ["global_summary", "keywords_table"];
function isValidType(value: unknown): value is WorkspaceType {
  return typeof value === "string" && (VALID_TYPES as string[]).includes(value);
}

/** Maps the frontend-facing request type to the course-level cache's own generation_type — kept as two distinct vocabularies on purpose: "global_summary"/"keywords_table" describe what the STUDENT asked for; "summary_chunk"/"keyword_row_v3" describe the granularity of what's actually CACHED (one course's worth), which is the real architectural point of this pivot. */
const CACHE_GENERATION_TYPE: Record<WorkspaceType, CourseWorkspaceGenerationType> = {
  global_summary: "summary_chunk",
  keywords_table: "keyword_row_v3",
};

/** Per-course category cap — without this, one unusually enthusiastic course could add many one-off columns that every OTHER course in the table then shows as empty, bloating the table width for no real benefit. */
const MAX_CATEGORIES_PER_COURSE = 6;
/** Per-category item cap and per-item word cap ("**keyword:** brief explanation" — brief, not a paragraph) — a hard backstop server-side, since the prompt instruction alone can't guarantee the model never slips. */
const MAX_ITEMS_PER_CATEGORY = 6;
const MAX_WORDS_PER_ITEM = 20;

/**
 * Defensive parsing of the model's per-course keyword object — DYNAMIC keys
 * now, not a fixed 4. A missing/wrong-typed value becomes an empty array
 * rather than crashing the whole batch; an over-long item (the model
 * ignoring the "brief explanation" instruction) is dropped rather than
 * trusted; a course offering more than MAX_CATEGORIES_PER_COURSE keys is
 * truncated to the first N encountered, in JSON key order.
 */
function normalizeKeywordCategories(raw: unknown): KeywordCategories {
  const source = (raw ?? {}) as Record<string, unknown>;
  const result: KeywordCategories = {};
  for (const key of Object.keys(source).slice(0, MAX_CATEGORIES_PER_COURSE)) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    const items = value
      .filter((item): item is string => typeof item === "string" && item.trim().split(/\s+/).length <= MAX_WORDS_PER_ITEM)
      .map((item) => item.trim())
      .slice(0, MAX_ITEMS_PER_CATEGORY);
    if (items.length > 0) result[key] = items;
  }
  return result;
}

const MAX_PER_COURSE_CHARS = 8_000;
const MAX_TOTAL_SYNTHESIS_CHARS = 60_000;

interface EligibleCourseRow {
  id: number;
  title: string;
  content_hash: string | null;
  explication: string | null;
  raw_text: string;
}

function resolveContentHash(course: EligibleCourseRow): string {
  return course.content_hash ?? sha256(normalizeText(course.raw_text));
}

/** Same token-saving priority as before (Explication over raw_text, combined-budget-aware per-course cap) — unaffected by every pivot so far, this part was already correct. */
function buildCourseInputs(courses: EligibleCourseRow[]): { inputs: ModuleSynthesisCourseInput[]; fallbackTitles: string[] } {
  const perCourseCap = Math.max(500, Math.min(MAX_PER_COURSE_CHARS, Math.floor(MAX_TOTAL_SYNTHESIS_CHARS / Math.max(1, courses.length))));
  const fallbackTitles: string[] = [];
  const inputs = courses.map((course) => {
    const usedFallback = !course.explication;
    if (usedFallback) fallbackTitles.push(course.title);
    const source = course.explication ?? course.raw_text;
    return { contentHash: resolveContentHash(course), title: course.title, text: source.slice(0, perCourseCap) };
  });
  return { inputs, fallbackTitles };
}

/** Basic table-safety escaping — an LLM-generated field containing a literal "|" or a newline would otherwise silently break the stitched Markdown table for every course in the response, not just the offending one. Markdown emphasis syntax (**bold**) is preserved on purpose — GFM tables render inline formatting inside cells correctly, unlike raw HTML. */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** Same-line bullet-separated run inside one cell — see the historical note in git blame for why this isn't `<br/>`-joined (no rehype-raw in this app's ReactMarkdown setup; raw HTML would render as literal text). Empty category = "-", matching the spec (never a stray "•" or "undefined"). */
function formatCategoryCell(keywords: string[] | undefined): string {
  if (!keywords || keywords.length === 0) return "-";
  return keywords.map((kw) => escapeTableCell(kw)).join(" • ");
}

/**
 * ONE global table, ONE row per course, DYNAMIC columns — the header row is
 * the UNION of every key present across every course's own chunk, ordered
 * with CATEGORY_SUPERSET's preferred categories first (for a stable,
 * predictable column order across different selections) and any one-off
 * extra categories a course introduced afterward, alphabetically.
 */
function stitchKeywordsTable(coursesInOrder: EligibleCourseRow[], categoriesByHash: Map<string, KeywordCategories>): string {
  const usedKeys = new Set<string>();
  for (const course of coursesInOrder) {
    const categories = categoriesByHash.get(resolveContentHash(course));
    if (categories) Object.keys(categories).forEach((key) => usedKeys.add(key));
  }

  const orderedKeys = [
    ...CATEGORY_SUPERSET.filter((key) => usedKeys.has(key)),
    ...[...usedKeys].filter((key) => !(CATEGORY_SUPERSET as string[]).includes(key)).sort(),
  ];

  if (orderedKeys.length === 0) {
    // Every selected course's chunk came back with zero usable categories
    // (should be rare — normalizeKeywordCategories only drops malformed
    // items, not whole courses) — an honest empty table beats a header-only
    // table with no columns at all.
    return "| Cours |\n| --- |\n" + coursesInOrder.map((c) => `| **${escapeTableCell(c.title)}** |`).join("\n");
  }

  const header = `| Cours | ${orderedKeys.map((key) => key.replace(/_/g, " ")).join(" | ")} |`;
  const separator = `| --- | ${orderedKeys.map(() => "---").join(" | ")} |`;

  const rows = coursesInOrder.map((course) => {
    const categories = categoriesByHash.get(resolveContentHash(course)) ?? {};
    const cells = orderedKeys.map((key) => formatCategoryCell(categories[key]));
    return `| **${escapeTableCell(course.title)}** | ${cells.join(" | ")} |`;
  });

  return [header, separator, ...rows].join("\n");
}

function stitchSummaryChunks(coursesInOrder: EligibleCourseRow[], chunksByHash: Map<string, string>): string {
  return coursesInOrder
    .map((course) => chunksByHash.get(resolveContentHash(course)))
    .filter((chunk): chunk is string => typeof chunk === "string" && chunk.trim().length > 0)
    .join("\n\n---\n\n");
}

/**
 * SECOND PASS — the only cross-course reasoning in this feature, and
 * deliberately NOT cacheable: it's a function of the exact combination of
 * selected courses, which is precisely what course-level caching exists to
 * avoid keying on (see course_workspace_cache's comment in schema.sql for
 * why combination-level caching was abandoned). Fed the ALREADY-GENERATED
 * per-course chunks (small, structured JSON) — never raw_text/Explication
 * again — so this stays cheap regardless of source size, on a fast/cheap
 * model since the input is already distilled. Returns `null` for a single
 * selected course (nothing to connect) — caller must check this.
 */
async function buildCrossCourseSynthesis(
  coursesInOrder: EligibleCourseRow[],
  chunksByHash: Map<string, unknown>
): Promise<string> {
  const chunksByCourseTitle = Object.fromEntries(
    coursesInOrder.map((course) => [course.title, chunksByHash.get(resolveContentHash(course)) ?? {}])
  );
  const prompt = buildCrossCourseSynthesisPrompt(chunksByCourseTitle);

  const raw = await callOpenRouter(
    [
      { role: "system", content: prompt },
      { role: "user", content: "Génère la synthèse transversale demandée." },
    ],
    { model: HAIKU_MODEL, maxTokens: 1200, bypassMock: true }
  );

  const parsed = parseJsonResponse(raw);
  const content = typeof parsed.content === "string" ? sanitizeForPostgres(parsed.content) : "";
  if (!content.trim()) {
    throw new Error("La réponse de l'IA ne contient pas de synthèse transversale exploitable.");
  }
  return content;
}

/**
 * MODULAR CHUNK PIPELINE (Fetch All -> Isolate Missing -> Generate Missing ->
 * Save Missing -> Stitch All -> Cross-Course Synthesis) — see
 * course_workspace_cache's own comment in supabase/schema.sql for why the
 * per-course cache replaced an earlier combination-level design. Body:
 * { moduleId: number, courseIds: number[], type: WorkspaceType }.
 *
 * The cross-course synthesis step (>1 course selected) is NOT cacheable —
 * see buildCrossCourseSynthesis's own comment — so BOTH generation types
 * lose their "fully free on repeat" guarantee the moment more than one
 * course is selected, even when every per-course chunk is already cached.
 * That's the deliberate cost of restoring cross-course value, not a bug.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`workspace-module-synthesis:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { moduleId, courseIds, type } = (body ?? {}) as { moduleId?: unknown; courseIds?: unknown; type?: unknown };

  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'courseIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  if (!isValidType(type)) {
    return NextResponse.json({ success: false, error: `'type' invalide. Valeurs acceptées : ${VALID_TYPES.join(", ")}.` }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const cacheType = CACHE_GENERATION_TYPE[type];

  // Scoped to THIS user AND THIS module — a courseId the student doesn't
  // own, or one that belongs to a different module, is silently excluded.
  // Ordered by id for a stable, deterministic stitch order regardless of
  // the order courseIds arrived in the request body.
  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, content_hash, explication, raw_text")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .in("id", courseIds)
    .order("id", { ascending: true });

  if (coursesError) {
    console.error("[workspace/module-synthesis] Échec lecture Supabase:", coursesError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = (courses ?? []) as EligibleCourseRow[];
  if (eligibleCourses.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun cours sélectionné trouvé dans ce module." }, { status: 400 });
  }

  // ── STEP 1: Fetch All ──────────────────────────────────────────────────
  const allHashes = eligibleCourses.map(resolveContentHash);
  const cachedByHash = await lookupCourseWorkspaceChunks(allHashes, cacheType);

  // ── STEP 2: Isolate Missing ──────────────────────────────────────────────
  const missingCourses = eligibleCourses.filter((course) => !cachedByHash.has(resolveContentHash(course)));
  const needsCrossCourseSynthesis = eligibleCourses.length > 1;

  let fallbackTitles: string[] = [];
  let crossCourseSection: string | null = null;

  // Reserve if EITHER a chunk needs generating OR the (always-live,
  // never-cacheable) cross-course pass will run — the only case that skips
  // quota entirely is a single already-cached course, which really does
  // cost nothing at all.
  const needsReservation = missingCourses.length > 0 || needsCrossCourseSynthesis;

  if (needsReservation) {
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }
  }

  try {
    // ── STEP 3: Generate Missing (ONE batched OpenRouter call covering
    // every miss — not one call per missing course) ─────────────────────
    if (missingCourses.length > 0) {
      const { inputs, fallbackTitles: missingFallbacks } = buildCourseInputs(missingCourses);
      fallbackTitles = missingFallbacks;

      const prompt = type === "global_summary" ? buildSummaryChunkPrompt(inputs) : buildKeywordRowPrompt(inputs);
      const userPrompt =
        type === "global_summary" ? "Génère les chunks de résumé demandés." : "Génère les lignes de mots-clés demandées.";

      const raw = await callOpenRouter(
        [
          { role: "system", content: prompt },
          { role: "user", content: userPrompt },
        ],
        { model: STUDIO_MODEL, maxTokens: 8000, bypassMock: true }
      );

      const parsed = parseJsonResponse(raw);
      const chunks = parsed.chunks as Record<string, unknown> | undefined;
      if (!chunks || typeof chunks !== "object") {
        throw new Error("La réponse de l'IA ne contient pas de chunks exploitables.");
      }

      // Every missing course MUST come back — a partial response (the model
      // silently dropped one course) is treated as a failure for the whole
      // batch rather than silently stitching an incomplete result.
      const newChunks: { courseContentHash: string; content: unknown }[] = [];
      for (const input of inputs) {
        const chunk = chunks[input.contentHash];
        if (chunk === undefined || chunk === null) {
          throw new Error(`La réponse de l'IA ne contient pas de chunk pour le cours "${input.title}".`);
        }
        const sanitized = type === "global_summary" ? sanitizeForPostgres(String(chunk)) : normalizeKeywordCategories(chunk);
        newChunks.push({ courseContentHash: input.contentHash, content: sanitized });
        cachedByHash.set(input.contentHash, sanitized);
      }

      // ── STEP 4: Save Missing ───────────────────────────────────────────
      // Stored BEFORE the cross-course pass/stitching — the next student
      // benefits immediately. Fail-open internally.
      await storeCourseWorkspaceChunks(newChunks, cacheType);
    }

    // ── Cross-Course Synthesis (>1 course only, never cached) ────────────
    if (needsCrossCourseSynthesis) {
      crossCourseSection = await buildCrossCourseSynthesis(eligibleCourses, cachedByHash);
    }
  } catch (error) {
    if (needsReservation) await refundGeneration(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error(`[workspace/module-synthesis:${type}] Erreur non gérée:`, error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  // Telemetry only, never load-bearing — how many of this request's courses
  // were already cached vs. freshly generated (the cross-course pass, when
  // it runs, is never counted as a "hit" for any course — it's its own,
  // separate, always-live cost).
  const hitHashes = eligibleCourses.map(resolveContentHash).filter((hash) => !missingCourses.some((c) => resolveContentHash(c) === hash));
  if (hitHashes.length > 0) await recordCourseWorkspaceCacheHits(hitHashes, cacheType);

  // ── STEP 5: Stitch All ───────────────────────────────────────────────────
  const mainContent =
    type === "global_summary"
      ? stitchSummaryChunks(eligibleCourses, cachedByHash as Map<string, string>)
      : stitchKeywordsTable(eligibleCourses, cachedByHash as Map<string, KeywordCategories>);

  const content = crossCourseSection ? `${mainContent}\n\n---\n\n${crossCourseSection}` : mainContent;

  return NextResponse.json({
    success: true,
    content,
    fullyCached: missingCourses.length === 0 && !needsCrossCourseSynthesis,
    coursesGenerated: missingCourses.length,
    coursesFromCache: eligibleCourses.length - missingCourses.length,
    coursesUsingRawTextFallback: fallbackTitles,
  });
}
