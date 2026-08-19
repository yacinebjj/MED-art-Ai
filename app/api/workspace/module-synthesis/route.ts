import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildSummaryChunkPrompt, buildKeywordRowPrompt, type ModuleSynthesisCourseInput } from "@/lib/ai/module-synthesis-prompts";
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

/** Maps the frontend-facing request type to the course-level cache's own generation_type — kept as two distinct vocabularies on purpose: "global_summary"/"keywords_table" describe what the STUDENT asked for; "summary_chunk"/"keyword_row_v2" describe the granularity of what's actually CACHED (one course's worth), which is the real architectural point of this pivot. */
const CACHE_GENERATION_TYPE: Record<WorkspaceType, CourseWorkspaceGenerationType> = {
  global_summary: "summary_chunk",
  keywords_table: "keyword_row_v2",
};

const KEYWORD_CATEGORY_KEYS: (keyof KeywordCategories)[] = [
  "mots_cles_principaux",
  "signes_cliniques",
  "examens_diagnostic",
  "traitements",
];

/** Defensive parsing of the model's per-course keyword object — a missing/wrong-typed category becomes an empty array rather than crashing the whole batch or silently rendering "undefined" in a table cell. Also enforces the "short keyword, not a sentence" rule server-side as a hard backstop: anything over ~6 words is dropped rather than trusted, since the prompt instruction alone can't guarantee the model never slips. */
function normalizeKeywordCategories(raw: unknown): KeywordCategories {
  const source = (raw ?? {}) as Record<string, unknown>;
  const result = {} as KeywordCategories;
  for (const key of KEYWORD_CATEGORY_KEYS) {
    const value = source[key];
    result[key] = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().split(/\s+/).length <= 6).map((item) => item.trim())
      : [];
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

/** Same token-saving priority as before (Explication over raw_text, combined-budget-aware per-course cap) — unaffected by the caching-granularity pivot, this part was already correct. */
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

/** Basic table-safety escaping — an LLM-generated field containing a literal "|" or a newline would otherwise silently break the stitched Markdown table for every course in the response, not just the offending one. */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/**
 * Renders one category's keyword list as a bullet-separated run INSIDE a
 * single table cell. NOT `<br/>`-joined: this app's ReactMarkdown setup has
 * no `rehype-raw` anywhere (checked before writing this) — without it, raw
 * HTML in Markdown source is stripped/escaped by default, so a `<br/>`
 * would render as the literal text "<br/>", not a line break. Adding
 * rehype-raw would fix that but enables raw HTML on every Markdown surface
 * in the app (chat, demo pages, quizzes) for content that's meant to stay
 * plain AI-generated text — a real security-surface change nobody asked
 * for. A same-line " • "-separated run reads just as cleanly for short
 * keywords and needs no new dependency. Empty category = empty cell, never
 * a stray "•" or "undefined".
 */
function formatCategoryCell(keywords: string[]): string {
  if (keywords.length === 0) return "";
  return keywords.map((kw) => escapeTableCell(kw)).join(" • ");
}

/**
 * ONE global table, ONE row per course — not one table per course. Markdown
 * has no rowspan, so avoiding a repeated "Cours" column on every row (the
 * original complaint) means each course's several keywords per category
 * must live inside ONE cell instead of spanning multiple rows — hence the
 * <br/>-joined bullet stack in formatCategoryCell rather than a real nested
 * list, which Markdown table cells can't render.
 */
function stitchKeywordsTable(coursesInOrder: EligibleCourseRow[], categoriesByHash: Map<string, KeywordCategories>): string {
  const header = "| Cours | Mots-clés Principaux | Signes Cliniques | Examens / Diagnostic | Traitements |";
  const separator = "| --- | --- | --- | --- | --- |";

  const rows = coursesInOrder.map((course) => {
    const categories = categoriesByHash.get(resolveContentHash(course)) ?? normalizeKeywordCategories(undefined);
    return `| **${escapeTableCell(course.title)}** | ${formatCategoryCell(categories.mots_cles_principaux)} | ${formatCategoryCell(categories.signes_cliniques)} | ${formatCategoryCell(categories.examens_diagnostic)} | ${formatCategoryCell(categories.traitements)} |`;
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
 * MODULAR CHUNK PIPELINE (Fetch All -> Isolate Missing -> Generate Missing ->
 * Save Missing -> Stitch All) — see course_workspace_cache's own comment in
 * supabase/schema.sql for why this replaced the earlier combination-level
 * cache. Body: { moduleId: number, courseIds: number[], type: WorkspaceType }.
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

  let fallbackTitles: string[] = [];

  if (missingCourses.length > 0) {
    // ── STEP 3: Generate Missing (ONE batched OpenRouter call covering
    // every miss — not one call per missing course) ───────────────────────
    // Plan quota RESERVATION — one unit for this whole batch, regardless of
    // how many courses were missing, mirroring how a single Studio
    // generation or a single Flashcards definitive-set generation each
    // reserve one unit too. Reserved only for a genuine miss — a fully
    // cached request (missingCourses.length === 0) never reaches this
    // branch and never touches courseCap.
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }

    try {
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
      // batch rather than silently stitching an incomplete result, which
      // would look like a real answer while quietly missing content.
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

      // ── STEP 4: Save Missing ─────────────────────────────────────────────
      // Stored BEFORE stitching/returning — the next student (or this one,
      // next click including one of these same courses in a DIFFERENT
      // selection) benefits immediately. Fail-open internally.
      await storeCourseWorkspaceChunks(newChunks, cacheType);
    } catch (error) {
      await refundGeneration(user.id);
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
      }
      console.error(`[workspace/module-synthesis:${type}] Erreur non gérée:`, error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }
  }

  // Telemetry only, never load-bearing — how many of this request's courses
  // were already cached vs. freshly generated.
  const hitHashes = eligibleCourses.map(resolveContentHash).filter((hash) => !missingCourses.some((c) => resolveContentHash(c) === hash));
  if (hitHashes.length > 0) await recordCourseWorkspaceCacheHits(hitHashes, cacheType);

  // ── STEP 5: Stitch All ───────────────────────────────────────────────────
  const content =
    type === "global_summary"
      ? stitchSummaryChunks(eligibleCourses, cachedByHash as Map<string, string>)
      : stitchKeywordsTable(eligibleCourses, cachedByHash as Map<string, KeywordCategories>);

  return NextResponse.json({
    success: true,
    content,
    fullyCached: missingCourses.length === 0,
    coursesGenerated: missingCourses.length,
    coursesFromCache: eligibleCourses.length - missingCourses.length,
    coursesUsingRawTextFallback: fallbackTitles,
  });
}
