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
import { callOpenRouter, OpenRouterError, CHEAP_MODEL, STUDIO_FAST_MODEL } from "@/lib/ai/openrouter";
import {
  buildSummaryChunkPrompt,
  buildKeywordRowPrompt,
  buildMedicalDictionaryPrompt,
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
import { MAX_SOURCE_CHARS, errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export type ModuleSynthesisType = "global_summary" | "keywords_table" | "medical_dictionary";

/** Product direction: a synthesis/table across fewer courses isn't what this feature is for — enforced identically for both callers (module-synthesis's own route, and global-summary, which only ever requests "global_summary"). */
export const MIN_COURSES_REQUIRED = 5;

const CACHE_GENERATION_TYPE: Record<ModuleSynthesisType, CourseWorkspaceGenerationType> = {
  global_summary: "summary_chunk",
  keywords_table: "keyword_row_v3",
  medical_dictionary: "medical_dictionary_v2",
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

/** Same definition as studio_courses.content_hash (60k-char prefix) — the fallback used to hash the FULL text, giving long courses two different keys. */
function resolveContentHash(course: EligibleCourseRow): string {
  return course.content_hash ?? sha256(normalizeText(course.raw_text.slice(0, MAX_SOURCE_CHARS)));
}

/**
 * Cross-course synthesis cache (module_cross_synthesis_cache): the synthesis
 * is a pure function of the courses' contents AND titles (the titles appear
 * in the output, so they are part of the key — another student's file names
 * are never shown). It used to be regenerated on every request, even when
 * every per-course chunk was a cache hit.
 */
function crossSynthesisKey(coursesInOrder: EligibleCourseRow[]): string {
  const parts = coursesInOrder.map((course) => `${resolveContentHash(course)}|${course.title.trim()}`).sort();
  return sha256(`cross-v1\n${parts.join("\n")}`);
}

async function lookupCrossSynthesis(key: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().from("module_cross_synthesis_cache").select("content").eq("cache_key", key).maybeSingle<{ content: string }>();
    if (error) return null;
    return data?.content ?? null;
  } catch {
    return null;
  }
}

async function storeCrossSynthesis(key: string, content: string): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().from("module_cross_synthesis_cache").upsert({ cache_key: key, content }, { onConflict: "cache_key", ignoreDuplicates: true });
    if (error) console.error("[module-synthesis:cross-cache] Échec écriture (non bloquant):", error.message);
  } catch (error) {
    console.error("[module-synthesis:cross-cache] Exception écriture (non bloquant):", errorMessage(error));
  }
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
  const cacheKey = crossSynthesisKey(coursesInOrder);
  const cached = await lookupCrossSynthesis(cacheKey);
  if (cached) return cached;

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
    { model: CHEAP_MODEL, maxTokens: 1200, bypassMock: true, responseFormat: { type: "json_object" } }
  );

  const parsed = parseJsonResponse(raw);
  const content = typeof parsed.content === "string" ? sanitizeForPostgres(parsed.content) : "";
  if (!content.trim()) {
    throw new Error("La réponse de l'IA ne contient pas de synthèse transversale exploitable.");
  }
  await storeCrossSynthesis(cacheKey, content);
  return content;
}

export interface ModuleSynthesisResult {
  content: string;
  fullyCached: boolean;
  coursesGenerated: number;
  coursesFromCache: number;
  coursesUsingRawTextFallback: string[];
  /**
   * medical_dictionary ONLY (always [] for every other type) — course titles
   * whose sub-batch failed even after this function's own per-batch
   * isolation (see runModuleSynthesis' own comment). The request still
   * succeeds overall as long as at least one course generated; these titles
   * are simply missing from `content` rather than silently pretended
   * complete — the frontend surfaces this so the student knows to retry
   * specifically for what's missing, not the whole dictionary.
   */
  coursesFailedToGenerate: string[];
}

export type ModuleSynthesisOutcome =
  | { ok: true; result: ModuleSynthesisResult }
  | { ok: false; status: number; error: string };

/**
 * Recovers a usable chunks map from a response that parsed as valid JSON
 * (parseJsonResponse's own repair layer already handles truncation/escaping
 * separately — this is a DIFFERENT failure: syntactically valid JSON that
 * simply doesn't wrap its content under the expected "chunks" key) — a real,
 * observed compliance gap after the CHEAP_MODEL migration to
 * qwen/qwen-2.5-72b-instruct, surfacing as "La réponse de l'IA ne contient
 * pas de chunks exploitables." Tries two increasingly permissive but still
 * evidence-based readings before giving up — never invents content that
 * isn't already present in the response, only reshapes it:
 *  1. The model dropped the "chunks" wrapper and returned the
 *     contentHash -> content map directly at the JSON root — recognized
 *     because every REQUESTED contentHash is present as a top-level key.
 *  2. The model wrapped the map under a different key name (e.g. "result",
 *     "data") — recognized when exactly one top-level key holds an object.
 * Returns null (never throws) when neither reading is defensible, so the
 * caller can still raise its own clear error rather than silently accepting
 * something that isn't actually a chunks map.
 */
function recoverChunksMap(parsed: Record<string, unknown>, expectedHashes: string[]): Record<string, unknown> | null {
  const direct = parsed.chunks;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  if (expectedHashes.length > 0 && expectedHashes.every((hash) => hash in parsed)) {
    return parsed;
  }

  const objectEntries = Object.entries(parsed).filter(([, value]) => value !== null && typeof value === "object" && !Array.isArray(value));
  if (objectEntries.length === 1) {
    return objectEntries[0][1] as Record<string, unknown>;
  }

  return null;
}

// medical_dictionary's 3-column format (Terme | Explication clinique |
// الشرح بالعربية) produces meaningfully more output per course than
// global_summary/keywords_table's own chunks. Combined with CHEAP_MODEL's
// real, small context window (see the constant below), a single dense
// course's own chunk (up to 15 terms × 3 columns, plus JSON escaping
// overhead) can genuinely need this much output alone — confirmed in
// production (cours "Traumatismes du coude", 8000/8000 completion_tokens
// hit, unrecoverable even by parseJsonResponse's own repair layer — a
// genuine truncation, not a fixable escaping quirk). This is a PER-COURSE
// output floor, not a per-call one — see medicalDictionaryMaxTokens' own
// call site in generateAndStoreSynthesisChunks below.
const MEDICAL_DICTIONARY_TOKENS_PER_COURSE = 3000;

// Real production overflow, 2026-09-30: "17533 input + 16384 output = 33917
// tokens" on a single call covering ALL missing courses in the module at
// once — qwen/qwen-2.5-72b-instruct's real ceiling (confirmed live against
// GET https://openrouter.ai/api/v1/models) is 32,768 tokens TOTAL, input and
// output COMBINED. medical_dictionary is the one ModuleSynthesisType that
// runs on CHEAP_MODEL at all (see its own comment below) — every other type
// uses ECONOMY_MODEL's much larger context, never observed to hit this.
//
// FIXED by actually batching the calls — buildMedicalDictionaryPrompt's own
// header comment already anticipated this ("even when a single OpenRouter
// call covers several missing courses at once — a batching optimization,
// not a synthesis step, each course's chunk is produced independently") but
// runModuleSynthesis never previously split a large missingCourses list into
// more than one call.
//
// TOKEN MATH ALONE permits up to ~5 courses/call: fixed persona overhead
// (MEDICAL_DICTIONARY_SYSTEM_PROMPT itself, ~2,739 chars ≈ 800 tokens at this
// codebase's established ~0.29 tokens/char French-medical-text ratio) +
// per-course (input ~8,000 chars ≈ 2,320 tokens + output 3,000 tokens) ≈
// 5,320 tokens/course, against a 28,000-token target (≈4,700 tokens of
// margin below the real 32,768 ceiling): (28,000 - 800) / 5,320 ≈ 5.1.
//
// LOWERED 5 -> 3, 2026-09-30, after a real follow-up report: even a 5-course
// batch (safely under the token ceiling by the math above) still failed with
// a generic error — most consistent with per-call LATENCY or output-parsing
// reliability, not context length (qwen-2.5-72b-instruct's real generation
// throughput/large-input prefill time for THIS specific task has never been
// measured live in this codebase, unlike deepseek-v3.2's own confirmed
// ~70 tokens/second). Smaller batches are both faster individually (less to
// prefill, less to generate) and less likely to produce a single malformed/
// truncated JSON response covering many courses at once. Paired with
// MEDICAL_DICTIONARY_CONCURRENCY below specifically so that shrinking the
// batch size (which on its own would mean MORE sequential batches for the
// same course count) doesn't linearly increase total wall-clock time.
const MAX_MEDICAL_DICTIONARY_COURSES_PER_CALL = 3;

// Concurrency ceiling for the sub-batch fan-out below. Reuses the SAME value
// already established and proven in production for this exact question
// (bounded fan-out of independent CHEAP_MODEL calls from one account) at two
// other call sites — lib/studio-explication-client.ts's
// MAX_CONCURRENT_REQUESTS and app/api/exam/generate/route.ts's
// MAX_CONCURRENT_COURSE_GENERATIONS — rather than inventing a third, untested
// number for the same underlying constraint (OpenRouter/DeepSeek-family
// per-account concurrency tolerance, still not independently measured).
const MEDICAL_DICTIONARY_CONCURRENCY = 8;

/**
 * Runs `fn` over every item, at most `limit` in flight at once. A third,
 * independent copy of the same small helper already duplicated in
 * lib/studio-explication-client.ts ("use client", browser-only) and
 * app/api/exam/generate/route.ts (a separate route file) — still not worth a
 * shared module for three small, independent copies of ~15 lines each.
 * Order-preserving in the RETURNED array even though completion order isn't.
 */
async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * ONE OpenRouter call for `batchInputs` (a full `missingCourses` list for
 * global_summary/keywords_table, or one sub-batch of it for
 * medical_dictionary — see runModuleSynthesis' own call sites), storing the
 * result immediately on success. Throws (never returns partial data) on any
 * failure — the caller's own try/catch handles quota refund; a partial
 * medical_dictionary batch is never lost even so, since any EARLIER batch in
 * the same request already called storeCourseWorkspaceChunks before this one
 * ran.
 */
async function generateAndStoreSynthesisChunks(
  type: ModuleSynthesisType,
  cacheType: CourseWorkspaceGenerationType,
  batchInputs: ModuleSynthesisCourseInput[],
  cachedByHash: Map<string, unknown>
): Promise<void> {
  const prompt =
    type === "global_summary"
      ? buildSummaryChunkPrompt(batchInputs)
      : type === "keywords_table"
        ? buildKeywordRowPrompt(batchInputs)
        : buildMedicalDictionaryPrompt(batchInputs);
  const userPrompt =
    type === "global_summary"
      ? "Génère les chunks de résumé demandés."
      : type === "keywords_table"
        ? "Génère les lignes de mots-clés demandées."
        : "Génère les entrées de dictionnaire médical demandées.";

  // medical_dictionary is the ONE exception to the ECONOMY_MODEL policy
  // below — explicit product request: use the cheapest available text model
  // for this specific tab. CHEAP_MODEL (qwen/qwen-2.5-72b-instruct) is
  // genuinely cheaper than ECONOMY_MODEL here (see lib/ai/openrouter.ts), at
  // the accepted tradeoff already disclosed on every other CHEAP_MODEL call
  // site in this codebase (a real, measured medical-accuracy risk on a
  // different, comparably rigor-sensitive task — exam QCM generation; never
  // independently re-measured for a term-dictionary task specifically). No
  // `reasoning` option, matching every other CHEAP_MODEL call site.
  // global_summary / keywords_table: STUDIO_FAST_MODEL (Gemini 3.1 Flash-Lite,
  // 2026-10-07 cost pass — same JSON family as the previous ECONOMY_MODEL at
  // -60/-67% price; ECONOMY_MODEL stays its automatic model fallback).
  const model = type === "medical_dictionary" ? CHEAP_MODEL : STUDIO_FAST_MODEL;

  // Scales with THIS BATCH's own course count (bounded by
  // MAX_MEDICAL_DICTIONARY_COURSES_PER_CALL above, never the full
  // missingCourses list — see that constant's own comment for why that
  // bound is what actually keeps this under the real 32,768 ceiling, not
  // this formula's own min/max alone), capped at CHEAP_MODEL's real
  // top_provider.max_completion_tokens (16,384, confirmed live).
  const medicalDictionaryMaxTokens = Math.min(16384, Math.max(16000, batchInputs.length * MEDICAL_DICTIONARY_TOKENS_PER_COURSE));

  const raw = await callOpenRouter(
    [
      { role: "system", content: prompt },
      { role: "user", content: userPrompt },
    ],
    type === "medical_dictionary"
      ? { model, maxTokens: medicalDictionaryMaxTokens, bypassMock: true, responseFormat: { type: "json_object" } }
      // ECONOMY_MODEL (was STUDIO_MODEL / Sonnet — removed entirely, see
      // lib/ai/studio-prompts.ts's own header comment) + the matching
      // reasoning cap: without it, this model's hidden reasoning tokens can
      // silently consume the completion budget before writing any of the
      // actual JSON, truncating it (see callOpenRouter's own doc comment).
      : { model, maxTokens: 8000, bypassMock: true, reasoning: { effort: "minimal" }, responseFormat: { type: "json_object" } }
  );

  const parsed = parseJsonResponse(raw);
  const chunks = recoverChunksMap(parsed, batchInputs.map((input) => input.contentHash));
  if (!chunks) {
    throw new Error("La réponse de l'IA ne contient pas de chunks exploitables.");
  }

  const newChunks: { courseContentHash: string; content: unknown }[] = [];
  for (const input of batchInputs) {
    const chunk = chunks[input.contentHash];
    if (chunk === undefined || chunk === null) {
      throw new Error(`La réponse de l'IA ne contient pas de chunk pour le cours "${input.title}".`);
    }
    // keywords_table alone stores structured categories; global_summary and
    // medical_dictionary are both a self-contained Markdown string per
    // course.
    const sanitized = type === "keywords_table" ? normalizeKeywordCategories(chunk) : sanitizeForPostgres(String(chunk));
    newChunks.push({ courseContentHash: input.contentHash, content: sanitized });
    cachedByHash.set(input.contentHash, sanitized);
  }

  await storeCourseWorkspaceChunks(newChunks, cacheType);
}

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
  // medical_dictionary is deliberately excluded — CROSS_COURSE_SYNTHESIS_
  // SYSTEM_PROMPT (lib/ai/module-synthesis-prompts.ts) is written assuming
  // keyword-table-shaped input ("fiches de mots-clés... catégories ->
  // mots-clés") and asks for cross-course diagnostics/differentials, neither
  // of which fits a per-course glossary — a dictionary's entries don't gain
  // anything from being "synthesized" across courses the way a clinical
  // summary or keyword table does. Skipping it here also means one fewer
  // OpenRouter call per dictionary request, for free.
  const needsCrossCourseSynthesis = type !== "medical_dictionary" && eligibleCourses.length > 1;

  let fallbackTitles: string[] = [];
  let crossCourseSection: string | null = null;
  // medical_dictionary ONLY — course titles whose sub-batch failed even after
  // this function's own per-batch isolation below (see the batching loop's
  // own comment).
  let dictionaryFailedCourses: string[] = [];

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

      if (type === "medical_dictionary") {
        // BATCHED, 2026-09-30 — see MAX_MEDICAL_DICTIONARY_COURSES_PER_CALL's
        // own comment for why: a single call covering every missing course in
        // the module at once (this feature's whole premise routinely selects
        // most/all of a module) was a real, confirmed production overflow of
        // CHEAP_MODEL's real 32,768-token combined ceiling. Each sub-batch is
        // stored (storeCourseWorkspaceChunks, inside the helper) as soon as
        // it succeeds, not only after every batch finishes — a later batch
        // failing still leaves the earlier ones' real, paid-for work durably
        // cached, so a retry only needs to regenerate whatever's still
        // missing (same "don't discard already-good work" principle already
        // applied to Explication's checkpointing and Exam's per-course
        // tolerance elsewhere in this app).
        //
        // CONCURRENT (bounded — MEDICAL_DICTIONARY_CONCURRENCY) rather than
        // sequential, and FAILURE-ISOLATED PER BATCH, both added 2026-09-30
        // after a real follow-up report: a batch failing (timeout or
        // malformed output — see MAX_MEDICAL_DICTIONARY_COURSES_PER_CALL's
        // own comment) used to propagate straight to this function's outer
        // catch below, discarding every OTHER batch's already-succeeded,
        // already-cached work behind one generic "Échec de la génération".
        // Now: each batch's failure is caught right here, logged with the
        // REAL underlying error and exactly which courses it covered, and
        // does not stop the remaining batches. Only if EVERY batch failed
        // (nothing at all was generated) does this rethrow — using the LAST
        // real error seen, not a generic message — so the outer catch's
        // quota refund still fires for a genuinely total failure. Any
        // partial failure is reported honestly via dictionaryFailedCourses
        // (see ModuleSynthesisResult's own comment) rather than silently
        // pretending the dictionary is complete.
        const batches: ModuleSynthesisCourseInput[][] = [];
        for (let i = 0; i < inputs.length; i += MAX_MEDICAL_DICTIONARY_COURSES_PER_CALL) {
          batches.push(inputs.slice(i, i + MAX_MEDICAL_DICTIONARY_COURSES_PER_CALL));
        }
        let lastBatchError: unknown = null;
        const batchOutcomes = await mapWithConcurrencyLimit(batches, MEDICAL_DICTIONARY_CONCURRENCY, async (batchInputs) => {
          try {
            await generateAndStoreSynthesisChunks(type, cacheType, batchInputs, cachedByHash);
            return { ok: true as const, batchInputs };
          } catch (error) {
            lastBatchError = error;
            console.warn(
              `[module-synthesis:medical_dictionary] Sous-lot échoué pour [${batchInputs.map((c) => c.title).join(", ")}] — poursuite avec les autres sous-lots:`,
              errorMessage(error)
            );
            return { ok: false as const, batchInputs };
          }
        });
        dictionaryFailedCourses = batchOutcomes.filter((o) => !o.ok).flatMap((o) => o.batchInputs.map((c) => c.title));
        if (dictionaryFailedCourses.length === inputs.length) {
          throw lastBatchError instanceof Error ? lastBatchError : new Error("Aucun cours n'a pu être ajouté au dictionnaire médical.");
        }
      } else {
        // global_summary/keywords_table run on ECONOMY_MODEL, whose real
        // context window has never shown this failure — left as a single
        // call covering every missing course, exactly as before.
        await generateAndStoreSynthesisChunks(type, cacheType, inputs, cachedByHash);
      }
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

  // Everything past this point is pure assembly of already-generated/cached
  // content (no further OpenRouter calls, nothing left to refund quota for)
  // — but it is NOT risk-free: stitchKeywordsTable/stitchSummaryChunks read
  // back content this function itself just wrote or fetched from cache, and
  // an unexpected shape there (or in recordCourseWorkspaceCacheHits) would
  // otherwise escape this function as an unhandled exception, surfacing to
  // the student as an opaque crash ("Impossible de contacter le serveur")
  // instead of this function's own structured, catchable error contract. Its
  // own try/catch, separate from the generation one above, since quota was
  // never at risk here.
  try {
    const hitHashes = eligibleCourses.map(resolveContentHash).filter((hash) => !missingCourses.some((c) => resolveContentHash(c) === hash));
    if (hitHashes.length > 0) await recordCourseWorkspaceCacheHits(hitHashes, cacheType);

    const mainContent =
      type === "keywords_table"
        ? stitchKeywordsTable(eligibleCourses, cachedByHash as Map<string, KeywordCategories>)
        : stitchSummaryChunks(eligibleCourses, cachedByHash as Map<string, string>);

    const content = crossCourseSection ? `${mainContent}\n\n---\n\n${crossCourseSection}` : mainContent;

    return {
      ok: true,
      result: {
        content,
        fullyCached: missingCourses.length === 0 && !needsCrossCourseSynthesis,
        // Actual successes, not merely attempted — subtracts any
        // medical_dictionary sub-batch that failed (dictionaryFailedCourses
        // is always [] for every other type, so this is a no-op there).
        coursesGenerated: missingCourses.length - dictionaryFailedCourses.length,
        coursesFromCache: eligibleCourses.length - missingCourses.length,
        coursesUsingRawTextFallback: fallbackTitles,
        coursesFailedToGenerate: dictionaryFailedCourses,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    console.error(`[module-synthesis:${type}] Échec assemblage final:`, error);
    return { ok: false, status: 502, error: message };
  }
}
