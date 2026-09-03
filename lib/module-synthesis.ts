/**
 * Shared MODULAR CHUNK PIPELINE (Fetch All -> Isolate Missing -> Generate
 * Missing -> Save Missing -> Stitch All -> Cross-Course Synthesis) — the
 * real generation logic behind BOTH app/api/workspace/module-synthesis
 * (the fuller "workspace" page, history + keyword table + per-course
 * selection UI) and app/api/modules/[id]/global-summary (a simpler
 * "Résumé global" quick modal, rendered from CurriculumView.tsx).
 *
 * Extracted from module-synthesis/route.ts so global-summary's POST handler
 * can call the SAME per-course, cross-student cache (course_workspace_cache)
 * instead of its own bespoke, always-fresh, full-raw-text OpenRouter call —
 * two students selecting the same courses now share the cost through
 * EITHER entry point, not just the workspace page. See
 * course_workspace_cache's own comment in supabase/schema.sql for why this
 * per-course design replaced an earlier, abandoned combination-hash cache.
 *
 * MINIMUM COURSE COUNT: both callers require at least MIN_COURSES_REQUIRED
 * courses selected — a synthesis/table across too few courses isn't the
 * point of this feature (product direction), enforced here once so neither
 * route can drift out of sync with the other.
 */

import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, CHEAP_MODEL, ECONOMY_MODEL } from "@/lib/ai/openrouter";
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
import { parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export type ModuleSynthesisType = "global_summary" | "keywords_table";

/** Product direction: a synthesis/table across fewer courses isn't what this feature is for — enforced identically for both callers (module-synthesis's own route, and global-summary, which only ever requests "global_summary"). */
export const MIN_COURSES_REQUIRED = 5;

const CACHE_GENERATION_TYPE: Record<ModuleSynthesisType, CourseWorkspaceGenerationType> = {
  global_summary: "summary_chunk",
  keywords_table: "keyword_row_v3",
};

const MAX_CATEGORIES_PER_COURSE = 6;
const MAX_ITEMS_PER_CATEGORY = 6;
const MAX_WORDS_PER_ITEM = 20;

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

export interface EligibleCourseRow {
  id: number;
  title: string;
  content_hash: string | null;
  explication: string | null;
  raw_text: string;
}

function resolveContentHash(course: EligibleCourseRow): string {
  return course.content_hash ?? sha256(normalizeText(course.raw_text));
}

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

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function formatCategoryCell(keywords: string[] | undefined): string {
  if (!keywords || keywords.length === 0) return "-";
  return keywords.map((kw) => escapeTableCell(kw)).join(" • ");
}

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

async function buildCrossCourseSynthesis(coursesInOrder: EligibleCourseRow[], chunksByHash: Map<string, unknown>): Promise<string> {
  const chunksByCourseTitle = Object.fromEntries(
    coursesInOrder.map((course) => [course.title, chunksByHash.get(resolveContentHash(course)) ?? {}])
  );
  const prompt = buildCrossCourseSynthesisPrompt(chunksByCourseTitle);

  const raw = await callOpenRouter(
    [
      { role: "system", content: prompt },
      { role: "user", content: "Génère la synthèse transversale demandée." },
    ],
    // CHEAP_MODEL — see its own extensive comment in lib/ai/openrouter.ts.
    // This is the PERSONALIZED, per-student, uncached cross-course
    // combination step (never the cross-student-cached per-course chunk
    // generation just above, which now runs on ECONOMY_MODEL — see that
    // call's own comment; there is no Sonnet fallback anywhere in this
    // file, or anywhere in the Studio pipeline it borrows from).
    // Tested with one real call: clean schema, medically accurate and
    // genuinely additive cross-course synthesis — a knowingly-accepted
    // tradeoff on a small sample, per the product owner's own explicit
    // "runway over accuracy margin" decision.
    { model: CHEAP_MODEL, maxTokens: 1200, bypassMock: true }
  );

  const parsed = parseJsonResponse(raw);
  const content = typeof parsed.content === "string" ? sanitizeForPostgres(parsed.content) : "";
  if (!content.trim()) {
    throw new Error("La réponse de l'IA ne contient pas de synthèse transversale exploitable.");
  }
  return content;
}

export interface ModuleSynthesisResult {
  content: string;
  fullyCached: boolean;
  coursesGenerated: number;
  coursesFromCache: number;
  coursesUsingRawTextFallback: string[];
}

export type ModuleSynthesisOutcome =
  | { ok: true; result: ModuleSynthesisResult }
  | { ok: false; status: number; error: string };

/**
 * Runs the full pipeline for one (user, module, courseIds, type) request.
 * Scoped to THIS user AND THIS module — a courseId the caller doesn't own,
 * or one that belongs to a different module, is silently excluded rather
 * than trusted from the request body. Reserves/refunds plan quota
 * internally exactly like the original route body did.
 */
export async function runModuleSynthesis(
  user: User,
  moduleId: number,
  courseIds: number[],
  type: ModuleSynthesisType
): Promise<ModuleSynthesisOutcome> {
  if (courseIds.length < MIN_COURSES_REQUIRED) {
    return {
      ok: false,
      status: 400,
      error: `Sélectionne au moins ${MIN_COURSES_REQUIRED} cours pour générer cette synthèse (actuellement ${courseIds.length}).`,
    };
  }

  const supabase = getSupabaseAdmin();
  const cacheType = CACHE_GENERATION_TYPE[type];

  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, content_hash, explication, raw_text")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .in("id", courseIds)
    .order("id", { ascending: true });

  if (coursesError) {
    console.error("[module-synthesis] Échec lecture Supabase:", coursesError);
    return { ok: false, status: 500, error: `Lecture échouée : ${coursesError.message}` };
  }

  const eligibleCourses = (courses ?? []) as EligibleCourseRow[];
  if (eligibleCourses.length < MIN_COURSES_REQUIRED) {
    return {
      ok: false,
      status: 400,
      error: `Sélectionne au moins ${MIN_COURSES_REQUIRED} cours possédés dans ce module pour générer cette synthèse (${eligibleCourses.length} trouvé(s)).`,
    };
  }

  const allHashes = eligibleCourses.map(resolveContentHash);
  const cachedByHash = await lookupCourseWorkspaceChunks(allHashes, cacheType);

  const missingCourses = eligibleCourses.filter((course) => !cachedByHash.has(resolveContentHash(course)));
  const needsCrossCourseSynthesis = eligibleCourses.length > 1;

  let fallbackTitles: string[] = [];
  let crossCourseSection: string | null = null;

  const needsReservation = missingCourses.length > 0 || needsCrossCourseSynthesis;

  if (needsReservation) {
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return { ok: false, status: 403, error: quotaGate.reason ?? "Quota atteint." };
    }
  }

  try {
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
        // ECONOMY_MODEL (was STUDIO_MODEL / Sonnet — removed entirely, see
        // lib/ai/studio-prompts.ts's own header comment) + the matching
        // reasoning cap: without it, this model's hidden reasoning tokens
        // can silently consume the completion budget before writing any of
        // the actual JSON, truncating it (see callOpenRouter's own doc
        // comment).
        { model: ECONOMY_MODEL, maxTokens: 8000, bypassMock: true, reasoning: { effort: "low" } }
      );

      const parsed = parseJsonResponse(raw);
      const chunks = parsed.chunks as Record<string, unknown> | undefined;
      if (!chunks || typeof chunks !== "object") {
        throw new Error("La réponse de l'IA ne contient pas de chunks exploitables.");
      }

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

      await storeCourseWorkspaceChunks(newChunks, cacheType);
    }

    if (needsCrossCourseSynthesis) {
      crossCourseSection = await buildCrossCourseSynthesis(eligibleCourses, cachedByHash);
    }
  } catch (error) {
    if (needsReservation) await refundGeneration(user.id);
    if (error instanceof OpenRouterError) {
      return { ok: false, status: error.status, error: error.message };
    }
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    console.error(`[module-synthesis:${type}] Erreur non gérée:`, error);
    return { ok: false, status: 502, error: message };
  }

  const hitHashes = eligibleCourses.map(resolveContentHash).filter((hash) => !missingCourses.some((c) => resolveContentHash(c) === hash));
  if (hitHashes.length > 0) await recordCourseWorkspaceCacheHits(hitHashes, cacheType);

  const mainContent =
    type === "global_summary"
      ? stitchSummaryChunks(eligibleCourses, cachedByHash as Map<string, string>)
      : stitchKeywordsTable(eligibleCourses, cachedByHash as Map<string, KeywordCategories>);

  const content = crossCourseSection ? `${mainContent}\n\n---\n\n${crossCourseSection}` : mainContent;

  return {
    ok: true,
    result: {
      content,
      fullyCached: missingCourses.length === 0 && !needsCrossCourseSynthesis,
      coursesGenerated: missingCourses.length,
      coursesFromCache: eligibleCourses.length - missingCourses.length,
      coursesUsingRawTextFallback: fallbackTitles,
    },
  };
}
