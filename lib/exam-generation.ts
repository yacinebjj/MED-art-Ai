import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, EXAM_FALLBACK_MODEL, EXAM_MODEL } from "@/lib/ai/openrouter";
import { buildExamBatchInstruction, buildExamStaticSystemPrompt, type ExamCourseInput } from "@/lib/ai/exam-prompts";
import { ExamQuestionSchema } from "@/lib/ai/exam-schemas";
import { parseJsonResponse } from "@/lib/course-generation-shared";
import type { ExamQuestion } from "@/lib/exam-pooling";

/**
 * Server-side exam generation core, shared by the one-shot route
 * (app/api/exam/generate) and the client-orchestrated run
 * (app/api/exam/run: plan -> parallel micro-batches -> assemble).
 */

export type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** PostgREST "function not found" (RPC not deployed on this database yet). */
export function isMissingRpcError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

/**
 * Fallback for a database where reserve_module_exam_regenerate isn't deployed
 * (see supabase/migrations/20261004_module_exam_regenerations.sql): the same
 * reservation as a compare-and-set on the same column, so the cap still
 * holds under concurrent clicks. Returns the post-increment count, null when
 * capped, or "unavailable" when even the column is missing.
 */
export async function reserveRegenerationFallback(supabase: SupabaseAdmin, userId: string, cap: number): Promise<number | null | "unavailable"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase.from("profiles").select("module_exam_regenerations_used").eq("id", userId).maybeSingle();
    if (error || !data) return "unavailable";
    const used = Number((data as { module_exam_regenerations_used?: number | null }).module_exam_regenerations_used ?? 0);
    if (used >= cap) return null;
    const { data: updated, error: updateError } = await supabase
      .from("profiles")
      .update({ module_exam_regenerations_used: used + 1 })
      .eq("id", userId)
      .eq("module_exam_regenerations_used", used)
      .select("module_exam_regenerations_used")
      .maybeSingle();
    if (updateError) return "unavailable";
    if (updated) return used + 1;
    // Lost a race with another click: re-read and try again.
  }
  return "unavailable";
}

export async function refundRegenerationFallback(supabase: SupabaseAdmin, userId: string): Promise<void> {
  const { data } = await supabase.from("profiles").select("module_exam_regenerations_used").eq("id", userId).maybeSingle();
  const used = Number((data as { module_exam_regenerations_used?: number | null } | null)?.module_exam_regenerations_used ?? 0);
  if (used <= 0) return;
  await supabase.from("profiles").update({ module_exam_regenerations_used: used - 1 }).eq("id", userId).eq("module_exam_regenerations_used", used);
}

// SEQUENTIAL BATCHING: the 40-question exam used to be requested in ONE call
// (32000 max tokens, relying on the model not stopping early before 40),
// then 4 batches of 10 (8000 tokens — too tight for 10 fully-explained QCMs
// on a real course), then 5 batches of 8 at 8192 tokens. STILL truncated in
// production on a long, image/detail-dense course (a real 40k-char stress
// test) — the "~40 words per explanation" instruction is a request, not a
// hard ceiling the model always obeys, and a denser source text pushes it
// toward longer, more specific explanations. Bumped again to 16000: real
// headroom over what 8 QCMs with 5 explanations each has ever measured at,
// even on a verbose response. lib/course-generation-shared.ts's
// parseJsonResponse also now repairs a truncated response as a second line
// of defense (recovers whatever complete questions made it through instead
// of hard-failing the whole batch) — see that function's own comment.
export const EXAM_BATCH_MAX_TOKENS = 16_000;
export const QUESTIONS_PER_BATCH = 8;
// 1 initial attempt + 2 retries — bounded so a persistently broken batch
// still fails (and refunds) the whole exam rather than looping indefinitely.
// Raised from 2 after a real production failure (a cheaper model of the day
// occasionally mis-hit an exact count) — kept at 3 as a general safety net
// even after reverting that model choice (see HAIKU_MODEL's call site
// below): the over-generation repair right above this loop already recovers
// a "1 too many" response for free, no retry needed, so this extra attempt
// is specifically for genuine under-generation or a malformed question.
export const MAX_BATCH_ATTEMPTS = 3;

// SMART AGGREGATION (product direction): the exam total no longer comes
// exclusively from fresh generation. For each selected course, up to
// QUESTIONS_PER_COURSE_TARGET already-generated, EXAM-COMPATIBLE QCMs (see
// lib/exam-pooling.ts's own header comment for the exact compatibility
// rules — no fabrication) are pooled first; only the shortfall is generated
// fresh. Ceiling-divided so the total lands at/above EXAM_TARGET_TOTAL
// regardless of how many courses are selected.
export const EXAM_TARGET_TOTAL = 40;
// Real "Régénérer" generations ever produced per course set — once this many
// exist, every future "Régénérer" click on this same set is served from them
// at $0, for ANY student, not just the one who triggered each generation.
// Same mechanism and cap as Studio's own "Régénérer" (see
// app/api/studio/regenerate/route.ts's MAX_VARIATIONS).
export const MAX_EXAM_VARIATIONS = 20;
// Only applied when `variation: true` — forces creative divergence for a
// regenerated exam. Left unset (provider default) for a first generation,
// since a first exam should stay close to the source material, not roam.
export const VARIATION_TEMPERATURE = 0.85;

// MAX_PER_COURSE_CHARS used to be a hard 8_000-char ceiling applied even
// when a SINGLE course was selected — meaning a real 40-60k char course
// (heavy on radiology/imaging detail, exactly the kind a "Semaine Bloquée"
// exam most needs full coverage of) was silently gutted down to its first
// ~20%, regardless of MAX_TOTAL_EXAM_CHARS's much larger budget. Raised to
// match MAX_TOTAL_EXAM_CHARS itself, so a single course gets the ENTIRE
// budget instead of an arbitrary low ceiling — the Math.min(...) below then
// only ever bites for genuine multi-course selections, exactly as the
// "spread the shared budget across N courses" design always intended.
//
// The `cache_control`-based cost justification this comment used to make
// ("only the FIRST batch pays full price, batches 2-5 read from Anthropic's
// prompt cache") never actually applied to CHEAP_MODEL: `cache_control:
// {type:"ephemeral"}` is an ANTHROPIC-SPECIFIC breakpoint (see
// lib/chat-model-routing.ts's own supportsAnthropicPromptCaching), and
// CHEAP_MODEL has never been an Anthropic model (was deepseek-v3.2, now
// qwen/qwen-2.5-72b-instruct) — that block has been sent, unused, to every
// CHEAP_MODEL batch call since this feature shipped. Removed at the actual
// call site below (generateExamBatch) rather than left as a no-op, since an
// unrecognized field forwarded to a non-Anthropic provider has "no
// documented, verified behavior" per that same file's own comment, and is a
// plausible contributor to the generic "Provider returned error" failures
// reported after the CHEAP_MODEL migration.
//
// LOWERED 60,000 -> 40,000, 2026-09-30, for the real reason this budget must
// now respect: qwen/qwen-2.5-72b-instruct's real context window is 32,768
// tokens total (input + output combined, confirmed live against
// GET https://openrouter.ai/api/v1/models) — a small fraction of
// deepseek-v3.2's 163,840, which this 60,000-char figure was sized against
// with enormous headroom to spare. At ~0.29 tokens/char (this codebase's own
// established French-medical-text ratio), 60,000 chars of course content
// alone is ~17,500 tokens — add the persona/style system prompt (~1-2k
// tokens) and EXAM_BATCH_MAX_TOKENS's own 16,000-token output reservation,
// and a single combined call could exceed 32,768 outright, which OpenRouter
// rejects as a hard error rather than truncating. This exact shape — a
// student selecting most/all of a module's courses for "Examen Guidé par le
// Style Prof" (the one path that concatenates every selected course into ONE
// call, see generateExamBatch's own call site below) — is the reproducible
// "Provider returned error" reported. 40,000 chars (~11,700 tokens) leaves
// ~3,000 tokens of real margin alongside the system prompt and the full
// 16,000-token output reservation. The ordinary (non-style) generation path
// was never actually at risk from this — see buildCourseInputs' own comment:
// normal shortfall generation is PER COURSE, so it was already naturally far
// under any per-call ceiling regardless of how many courses are selected.
export const MAX_TOTAL_EXAM_CHARS = 40_000;
export const MAX_PER_COURSE_CHARS = MAX_TOTAL_EXAM_CHARS;

export interface EligibleCourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string;
  qcms: unknown;
}

// Concurrency ceiling for the per-course shortfall fan-out below (see its own
// call-site comment for the real scalability bug this fixes). Reuses the
// EXACT value lib/studio-explication-client.ts's own MAX_CONCURRENT_REQUESTS
// already established and put into production for the same underlying
// question — bounded, not unbounded, because OpenRouter/DeepSeek's real
// per-account concurrency tolerance for a sudden burst from one account has
// never been measured live. Reusing that already-accepted number here rather
// than inventing a new untested one for a second call site.
export const MAX_CONCURRENT_COURSE_GENERATIONS = 8;

/**
 * 40+ COURSE SAFETY (2026-10-04). Real report: "Échec de génération" on large
 * course selections. Root cause: with N courses, targetPerCourse is
 * ceil(40 / N) — ~1 question per course at N=40 — and EVERY course short of
 * pooled QCMs got its OWN full-batch AI call (8 questions, ~100-150 s on
 * CHEAP_MODEL). 40 calls at 8 concurrent = 5 waves ≈ 600 s, past this
 * route's maxDuration (300 s): Vercel killed the whole request.
 *
 * Fix (orchestration only — same model, prompts, schemas and validation):
 *  - MAP-REDUCE GROUPING: when more courses need a shortfall than one
 *    concurrent wave can hold, courses are dealt into at most
 *    MAX_CONCURRENT_COURSE_GENERATIONS groups, each generating its combined
 *    shortfall in ONE call over the group's courses (budget shared inside the
 *    group: 40k chars / group size — more source per course than the old
 *    40k / N split). 40 courses ⇒ ~5 calls, one wave.
 *  - DEADLINE: every batch call shares EXAM_GENERATION_BUDGET_MS (well under
 *    maxDuration); a call's timeout is clamped to what remains, no attempt
 *    starts without MIN_BATCH_WINDOW_MS left, and the gap-filling top-up only
 *    runs when time remains — the route always answers instead of being
 *    killed mid-flight.
 *  - 429 pacing: a rate-limited attempt waits briefly before retrying instead
 *    of re-hitting a saturated provider immediately.
 */
export const EXAM_GENERATION_BUDGET_MS = 235_000;
export const MIN_BATCH_WINDOW_MS = 30_000;
export const BATCH_CALL_TIMEOUT_MS = 170_000;

export interface ShortfallUnit {
  courses: EligibleCourseRow[];
  count: number;
  /** Set when the unit covers exactly one course: its questions are harvested back into that course's pool. */
  harvestCourseId: number | null;
}

/** One unit per course while a single concurrent wave can hold them; otherwise courses are dealt round-robin into at most MAX_CONCURRENT_COURSE_GENERATIONS groups. */
export function planShortfallUnits(shortfalls: { id: number; shortfall: number }[], courses: EligibleCourseRow[]): ShortfallUnit[] {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const entries = shortfalls
    .map((s) => ({ course: byId.get(s.id), count: s.shortfall }))
    .filter((e): e is { course: EligibleCourseRow; count: number } => Boolean(e.course) && e.count > 0);
  if (entries.length <= MAX_CONCURRENT_COURSE_GENERATIONS) {
    return entries.map((e) => ({ courses: [e.course], count: e.count, harvestCourseId: e.course.id }));
  }
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const groupCount = Math.min(MAX_CONCURRENT_COURSE_GENERATIONS, Math.max(1, Math.ceil(total / QUESTIONS_PER_BATCH)));
  const groups: ShortfallUnit[] = Array.from({ length: groupCount }, () => ({ courses: [], count: 0, harvestCourseId: null }));
  [...entries]
    .sort((a, b) => b.count - a.count)
    .forEach((e, i) => {
      const g = groups[i % groupCount];
      g.courses.push(e.course);
      g.count += e.count;
    });
  return groups.filter((g) => g.courses.length > 0).map((g) => (g.courses.length === 1 ? { ...g, harvestCourseId: g.courses[0].id } : g));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Runs `fn` over every item, at most `limit` in flight at once. Duplicated
 * (not imported) from lib/studio-explication-client.ts's own identical
 * helper: that file is "use client" (browser-only), this is a server route,
 * and this is the only other call site in the app that needs bounded
 * fan-out — not worth a shared module for two small, independent copies.
 * Order-preserving in the RETURNED array even though completion order isn't.
 */
export async function mapWithConcurrencyLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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
 * Same Explication-preferred, combined-budget-aware per-course cap used by
 * the Workspace synthesis route — see that route's own comment for why.
 *
 * `budgetCourseCount` defaults to `courses.length` but MUST be passed
 * explicitly as the full selected-course count when this is called with a
 * narrowed subset (see the per-course shortfall loop below) — otherwise the
 * shared MAX_TOTAL_EXAM_CHARS budget silently stops being shared at all: a
 * length-1 array would compute its own cap as if it were the only course in
 * the whole request, handing every course the full ceiling instead of its
 * fair share (caught by adversarial review after the per-course harvesting
 * refactor first introduced this call shape).
 */
export function buildCourseInputs(courses: EligibleCourseRow[], budgetCourseCount: number = courses.length): ExamCourseInput[] {
  const perCourseCap = Math.max(500, Math.min(MAX_PER_COURSE_CHARS, Math.floor(MAX_TOTAL_EXAM_CHARS / Math.max(1, budgetCourseCount))));
  return courses.map((course) => ({
    title: course.title,
    text: (course.explication ?? course.raw_text).slice(0, perCourseCap),
  }));
}

/**
 * Generates ONE batch of exactly `questionsInThisBatch` questions, retrying
 * THAT batch alone (never the whole exam) up to MAX_BATCH_ATTEMPTS times on
 * a parse/validation failure. Only ever called now for the SHORTFALL — the
 * portion pooling (lib/exam-pooling.ts) couldn't cover — so
 * `questionsInThisBatch` is rarely the original fixed 8 anymore; the schema
 * is built to match whatever count was actually requested.
 *
 * `batchIndex`/`totalBatches` are passed purely to reuse
 * buildExamBatchInstruction's existing clinical/standard ratio framing
 * (clinicalCountForBatch returns 0 once batchIndex exceeds its internal
 * TOTAL_CLINICAL_QUESTIONS constant) — every shortfall chunk is deliberately
 * requested as "all standard" questions, since pooled questions already
 * supply most of the exam's real content and a partial top-up chunk doesn't
 * divide cleanly into the original 90/10 standard/clinical ratio.
 *
 * The system message is the STATIC half (persona + full course content, see
 * buildExamStaticSystemPrompt) — byte-identical across every shortfall chunk
 * for this exam. Sent as a plain string, NOT a `cache_control: ephemeral`
 * block: that Anthropic-specific breakpoint was previously applied here even
 * though CHEAP_MODEL has never been an Anthropic model, so it never actually
 * cached anything — see MAX_TOTAL_EXAM_CHARS' own comment for the full
 * history. The DYNAMIC per-batch instructions (previousTopics, variation
 * flag) go in the user message, which necessarily changes every call.
 */
export async function generateExamBatch(
  inputs: ExamCourseInput[],
  batchIndex: number,
  totalBatches: number,
  questionsInThisBatch: number,
  isVariation: boolean,
  previousTopics: string[],
  // Style-mimicry override (Examen Guidé par le Style Prof) — when set,
  // replaces the default persona/style prompt with
  // buildExamStyleAdaptedSystemPrompt's output. See generateShortfallQuestions
  // and this route's POST handler for the one call path that sets this.
  systemPromptOverride?: string,
  /** Epoch ms after which no new attempt starts (see EXAM_GENERATION_BUDGET_MS). */
  deadline?: number,
  /** Per-call ceiling (the client-orchestrated run gives a whole function invocation to one batch). */
  callTimeoutMs: number = BATCH_CALL_TIMEOUT_MS
): Promise<ExamQuestion[]> {
  const staticSystemPrompt = systemPromptOverride ?? buildExamStaticSystemPrompt(inputs);
  let lastError: unknown;
  // Tracks the most valid questions seen across every attempt — see this
  // function's own final comment for why the last attempt now returns this
  // instead of throwing.
  let bestPartial: ExamQuestion[] = [];
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
    const remainingMs = deadline ? deadline - Date.now() : Infinity;
    if (remainingMs < MIN_BATCH_WINDOW_MS) {
      lastError = lastError ?? new Error("Temps de génération épuisé pour ce lot.");
      break;
    }
    try {
      const batchInstruction = buildExamBatchInstruction(batchIndex, totalBatches, questionsInThisBatch, isVariation, previousTopics);
      const raw = await callOpenRouter(
        [
          { role: "system", content: staticSystemPrompt },
          { role: "user", content: batchInstruction },
        ],
        {
          // CHEAP_MODEL (DeepSeek v3.2) — see its own extensive comment
          // in lib/ai/openrouter.ts for the full history: this is an
          // EXPLICIT, KNOWINGLY-ACCEPTED accuracy tradeoff, not a blind cost
          // cut. Rigorously tested (2 rounds, 16 real trials, independent
          // adversarial re-verification): perfect structural reliability,
          // but a measured ~25% per-batch chance of a distractor explanation
          // containing a real, source-contradicting biochemistry claim
          // (mitigated somewhat, not eliminated, by EXAM_PERSONA_AND_STYLE's
          // "RIGUEUR ABSOLUE" hardening paragraph). HAIKU_MODEL tested
          // cleanly with no such failure and remains the technically safer
          // choice — the product owner explicitly chose to accept this
          // measured risk for the cost savings at this stage, intending to
          // revisit later. Made lower-stakes cost-wise by the pooling design
          // above (see poolExamQuestions): most of a well-established
          // course's exam comes from POOLED Studio QCMs (reused verbatim
          // from the Studio QCM tile, which stays on Flash) and never
          // touches this call at all — this function only ever generates
          // the SHORTFALL, a residual top-up, so this model choice only
          // affects a fraction of the exam.
          // EXAM_MODEL (qwen3-235b, see lib/ai/openrouter.ts): ~5x faster
          // and cheaper per batch than the old CHEAP_MODEL, same family.
          model: EXAM_MODEL,
          maxTokens: EXAM_BATCH_MAX_TOKENS,
          bypassMock: true,
          // Same model, fastest available providers first (output speed is
          // what bounds an 8-QCM batch).
          providerSort: "throughput",
          ...(Number.isFinite(remainingMs) ? { timeoutMs: Math.min(callTimeoutMs, remainingMs - 5_000) } : {}),
          ...(isVariation ? { temperature: VARIATION_TEMPERATURE } : {}),
        }
      );

      const parsed = parseJsonResponse(raw);
      const rawQuestions: unknown[] =
        parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)
          ? (parsed as { questions: unknown[] }).questions
          : [];

      // EXTRACT EVERY INDIVIDUALLY-VALID QUESTION regardless of whether the
      // raw response came back over, under, or exactly at
      // questionsInThisBatch — 2026-09-30, replacing the old rule that only
      // repaired a SURPLUS and hard-failed the WHOLE batch on any shortfall.
      // Real production report: a batch landing at, say, 6/8 valid questions
      // (one malformed option array, one under-length explanation) used to
      // be discarded ENTIRELY by an exact `.length(N)` check, throwing away 6
      // perfectly good, already-paid-for questions over the other 2 — which,
      // compounded across several courses' shortfalls, was enough to push
      // the WHOLE exam under ExamGenerationSchema's own floor and fail the
      // entire generation. No new fabrication risk either direction — this
      // only ever KEEPS a question that already independently passes
      // ExamQuestionSchema on its own merits; a malformed one is dropped, not
      // repaired or invented.
      const individuallyValid = rawQuestions
        .map((q) => ExamQuestionSchema.safeParse(q))
        .filter((r): r is z.SafeParseSuccess<ExamQuestion> => r.success)
        .map((r) => r.data);

      if (individuallyValid.length > bestPartial.length) bestPartial = individuallyValid;

      if (individuallyValid.length >= questionsInThisBatch) {
        return individuallyValid.slice(0, questionsInThisBatch);
      }

      console.error(
        `[exam/generate] Lot ${batchIndex}/${totalBatches} : ${individuallyValid.length}/${questionsInThisBatch} QCMs valides (tentative ${attempt}/${MAX_BATCH_ATTEMPTS}).`
      );
      lastError = new Error(`Le lot ${batchIndex} n'a produit que ${individuallyValid.length}/${questionsInThisBatch} QCMs valides.`);
      // Falls through to the next attempt — a fresh, independent generation,
      // never a repair of this same response — unless attempts are exhausted
      // (handled below, after the loop).
    } catch (error) {
      lastError = error;
      // Rate-limited: give the provider a moment instead of re-hitting it at once.
      if (error instanceof OpenRouterError && error.status === 429 && attempt < MAX_BATCH_ATTEMPTS) {
        const left = deadline ? deadline - Date.now() - MIN_BATCH_WINDOW_MS : Infinity;
        await delay(Math.min(4_000 * attempt, left));
      }
    }
  }
  // Every attempt exhausted. Previously this always threw here, discarding
  // whatever partial progress every single attempt made. Now returns the
  // BEST attempt's valid questions instead — real, individually-validated
  // content, just fewer than hoped, letting the caller (and ultimately
  // ExamGenerationSchema's own — now more forgiving — floor, see that
  // schema's own comment) decide whether the overall exam is still
  // acceptable. Only genuinely returns via the throw below when literally
  // nothing ever validated across every attempt (e.g. a network/parse
  // failure every single time) — functionally identical to the old
  // behavior for that specific worst case.
  if (bestPartial.length > 0) return bestPartial;
  throw lastError instanceof Error ? lastError : new Error(`Le lot ${batchIndex} a échoué après ${MAX_BATCH_ATTEMPTS} tentatives.`);
}

/**
 * Generates the SHORTFALL only — however many questions pooling couldn't
 * cover — in chunks of up to QUESTIONS_PER_BATCH, sequentially (each chunk
 * told every topic already covered by pooling AND by earlier chunks in this
 * same request, so "ensure new QCMs are completely distinct and
 * non-overlapping with the existing ones" is enforced for real). Every
 * chunk uses batchIndex/totalBatches values chosen so
 * buildExamBatchInstruction's clinical-ratio math always yields "all
 * standard" — see generateExamBatch's own comment for why.
 */
export async function generateShortfallQuestions(
  inputs: ExamCourseInput[],
  totalNeeded: number,
  isVariation: boolean,
  poolTopics: string[],
  systemPromptOverride?: string,
  deadline?: number
): Promise<ExamQuestion[]> {
  const generated: ExamQuestion[] = [];
  const topics = [...poolTopics];
  let remaining = totalNeeded;
  // ALL-STANDARD FRAMING: TOTAL_CLINICAL_QUESTIONS inside exam-prompts.ts is
  // 4 — any batchIndex/totalBatches pair above that always yields 0 clinical
  // questions for that chunk (see clinicalCountForBatch). Fixed at 5 for
  // every chunk deliberately, not incremented per-chunk — purely cosmetic
  // prompt framing, not a student-facing number.
  const ALL_STANDARD_BATCH_INDEX = 5;

  while (remaining > 0) {
    // Out of time: return what this request already has — the caller's floor decides.
    if (deadline && deadline - Date.now() < MIN_BATCH_WINDOW_MS) break;
    const count = Math.min(QUESTIONS_PER_BATCH, remaining);
    // ALWAYS request the full QUESTIONS_PER_BATCH, never the smaller
    // remainder `count` — confirmed live (real production failure, then
    // reproduced on demand) that a cheaper model tried for this call
    // reliably hit the STANDARD round batch size (8) but noticeably less
    // reliably hit an odd remainder count (e.g. exactly 6), even with
    // generateExamBatch's own over-generation repair and retries — a
    // model-agnostic precaution kept even after reverting to HAIKU_MODEL.
    // Asking for the size any model is most practiced at, then keeping only
    // the `count` this chunk still needs and discarding the (tiny,
    // ~fraction-of-a-cent) surplus, is more robust
    // than trying to make the model reliably hit an arbitrary exact number.
    const batchQuestions = await generateExamBatch(inputs, ALL_STANDARD_BATCH_INDEX, ALL_STANDARD_BATCH_INDEX, QUESTIONS_PER_BATCH, isVariation, topics, systemPromptOverride, deadline);
    const taken = batchQuestions.slice(0, count);
    generated.push(...taken);
    topics.push(...taken.map((q) => q.weakPointTag));
    remaining -= count;
  }
  return generated;
}

// Global, per-student regeneration ceiling — 5 ever, across every module
// (product direction). Hoisted to module scope (was previously a local
// const inside POST's `if (isVariation)` block) so GET can report the same
// live remaining-count the POST cap check itself enforces, instead of the
// two ever drifting apart.
export const MODULE_EXAM_REGENERATE_CAP = 5;


/**
 * Generate (and immediately, atomically persist) one "Semaine Bloquée"
 * exam. Body: { moduleId: number, courseIds: number[], variation?: boolean }.
 * Never returns success without the exam already durably saved — same
 * generate-then-save policy as every other real generation route in this
 * app (Studio, Workspace).
 */
/**
 * Turns OpenRouter's own raw error text into something a student can
 * actually act on. Two real, distinct upstream shapes this app has hit:
 *  - A genuine context-length rejection (status 400, message naming
 *    "context length"/"maximum context"/"context_length_exceeded") — this IS
 *    actionable by the student (select fewer courses), unlike most other
 *    OpenRouter failures.
 *  - The generic, unhelpful "Provider returned error" wrapper OpenRouter
 *    itself sometimes returns when the underlying provider rejects a request
 *    without surfacing a specific reason — real production symptom after the
 *    CHEAP_MODEL migration to a model with a much smaller context window (see
 *    MAX_TOTAL_EXAM_CHARS' own comment). Treated the same as a context error
 *    below rather than left as opaque raw text, since a 400 from this
 *    specific route overwhelmingly means the request was too large, not a
 *    malformed request on this app's own side.
 */
export function friendlyOpenRouterErrorMessage(error: OpenRouterError): string {
  const looksLikeContextOverflow =
    error.status === 400 && /context.length|context_length_exceeded|maximum context|too many tokens|provider returned error/i.test(error.message);
  if (looksLikeContextOverflow) {
    return "Le contenu sélectionné est trop volumineux pour être traité en une seule fois (trop de cours, ou des cours très longs). Réessaie avec moins de cours sélectionnés à la fois.";
  }
  return error.message;
}

/**
 * ONE exam job for the client-orchestrated run (app/api/exam/run): asks for
 * exactly `count` QCMs and returns as soon as a model delivers — EXAM_MODEL
 * first, EXAM_FALLBACK_MODEL only when the first produced nothing usable.
 * No in-request retry loop: a short answer is returned as-is and the
 * browser re-queues only the missing questions (re-sending a whole batch
 * for one missing QCM is what multiplied time and cost before).
 */
export async function generateExamJob(
  inputs: ExamCourseInput[],
  count: number,
  isVariation: boolean,
  systemPromptOverride?: string
): Promise<ExamQuestion[]> {
  const systemPrompt = systemPromptOverride ?? buildExamStaticSystemPrompt(inputs);
  const instruction = buildExamBatchInstruction(5, 5, count, isVariation, []);
  const chain: { model: string; timeoutMs: number }[] = [
    { model: EXAM_MODEL, timeoutMs: 110_000 },
    { model: EXAM_FALLBACK_MODEL, timeoutMs: 80_000 },
  ];
  let lastError: unknown = null;
  for (const step of chain) {
    try {
      const raw = await callOpenRouter(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: instruction },
        ],
        {
          model: step.model,
          // ~350 tokens per QCM measured; generous headroom, never the old 16k.
          maxTokens: 1_000 * count + 1_500,
          bypassMock: true,
          providerSort: "throughput",
          timeoutMs: step.timeoutMs,
          ...(isVariation ? { temperature: VARIATION_TEMPERATURE } : {}),
        }
      );
      const parsed = parseJsonResponse(raw);
      const rawQuestions: unknown[] =
        parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions) ? (parsed as { questions: unknown[] }).questions : [];
      const valid = rawQuestions
        .map((q) => ExamQuestionSchema.safeParse(q))
        .filter((r): r is z.SafeParseSuccess<ExamQuestion> => r.success)
        .map((r) => r.data);
      if (valid.length > 0) return valid.slice(0, count);
      lastError = new Error("Aucun QCM valide dans la réponse.");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Lot d'examen en échec.");
}
