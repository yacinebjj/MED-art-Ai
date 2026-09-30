import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError, CHEAP_MODEL } from "@/lib/ai/openrouter";
import { buildExamBatchInstruction, buildExamStaticSystemPrompt, buildExamStyleAdaptedSystemPrompt, type ExamCourseInput } from "@/lib/ai/exam-prompts";
import { ExamGenerationSchema, ExamQuestionSchema, ExamStyleProfileSchema, type ExamStyleProfile } from "@/lib/ai/exam-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";
import { computeExamContentHash, lookupExamCache, recordExamCacheHit, storeExamCache } from "@/lib/exam-content-cache";
import { lookupExamVariations, insertExamVariation, recordExamVariationHit } from "@/lib/exam-content-variations";
import { poolExamQuestions, convertExamQuestionToHarvestableQcm, type ExamQuestion } from "@/lib/exam-pooling";
import { lookupHarvestedQcms, storeHarvestedQcm } from "@/lib/exam-harvested-qcms";

export const runtime = "nodejs";
export const maxDuration = 300;

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
const EXAM_BATCH_MAX_TOKENS = 16_000;
const QUESTIONS_PER_BATCH = 8;
// 1 initial attempt + 2 retries — bounded so a persistently broken batch
// still fails (and refunds) the whole exam rather than looping indefinitely.
// Raised from 2 after a real production failure (a cheaper model of the day
// occasionally mis-hit an exact count) — kept at 3 as a general safety net
// even after reverting that model choice (see HAIKU_MODEL's call site
// below): the over-generation repair right above this loop already recovers
// a "1 too many" response for free, no retry needed, so this extra attempt
// is specifically for genuine under-generation or a malformed question.
const MAX_BATCH_ATTEMPTS = 3;

// SMART AGGREGATION (product direction): the exam total no longer comes
// exclusively from fresh generation. For each selected course, up to
// QUESTIONS_PER_COURSE_TARGET already-generated, EXAM-COMPATIBLE QCMs (see
// lib/exam-pooling.ts's own header comment for the exact compatibility
// rules — no fabrication) are pooled first; only the shortfall is generated
// fresh. Ceiling-divided so the total lands at/above EXAM_TARGET_TOTAL
// regardless of how many courses are selected.
const EXAM_TARGET_TOTAL = 40;
// Real "Régénérer" generations ever produced per course set — once this many
// exist, every future "Régénérer" click on this same set is served from them
// at $0, for ANY student, not just the one who triggered each generation.
// Same mechanism and cap as Studio's own "Régénérer" (see
// app/api/studio/regenerate/route.ts's MAX_VARIATIONS).
const MAX_EXAM_VARIATIONS = 20;
// Only applied when `variation: true` — forces creative divergence for a
// regenerated exam. Left unset (provider default) for a first generation,
// since a first exam should stay close to the source material, not roam.
const VARIATION_TEMPERATURE = 0.85;

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
const MAX_TOTAL_EXAM_CHARS = 40_000;
const MAX_PER_COURSE_CHARS = MAX_TOTAL_EXAM_CHARS;

interface EligibleCourseRow {
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
const MAX_CONCURRENT_COURSE_GENERATIONS = 8;

/**
 * Runs `fn` over every item, at most `limit` in flight at once. Duplicated
 * (not imported) from lib/studio-explication-client.ts's own identical
 * helper: that file is "use client" (browser-only), this is a server route,
 * and this is the only other call site in the app that needs bounded
 * fan-out — not worth a shared module for two small, independent copies.
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
function buildCourseInputs(courses: EligibleCourseRow[], budgetCourseCount: number = courses.length): ExamCourseInput[] {
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
async function generateExamBatch(
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
  systemPromptOverride?: string
): Promise<ExamQuestion[]> {
  const staticSystemPrompt = systemPromptOverride ?? buildExamStaticSystemPrompt(inputs);
  const batchSchema = z.object({ questions: z.array(ExamQuestionSchema).length(questionsInThisBatch) });
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
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
          model: CHEAP_MODEL,
          maxTokens: EXAM_BATCH_MAX_TOKENS,
          bypassMock: true,
          ...(isVariation ? { temperature: VARIATION_TEMPERATURE } : {}),
        }
      );

      const parsed = parseJsonResponse(raw);

      // Repair over-generation: confirmed live (4 real test calls at a
      // non-round count of 6) that the model occasionally emits ONE extra
      // question despite the "EXACTLY N" instruction — every individual
      // question was still schema-valid on its own, just a surplus. Rather
      // than hard-failing (and burning a retry) over having MORE valid
      // content than needed, keep only the individually-valid questions and
      // take the first `questionsInThisBatch` of them. Under-generation
      // (fewer than needed) is NOT repaired this way — fabricating a
      // question is never acceptable — that still falls through to the
      // retry loop below exactly as before.
      let repaired: unknown = parsed;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { questions?: unknown }).questions)) {
        const rawQuestions = (parsed as { questions: unknown[] }).questions;
        if (rawQuestions.length > questionsInThisBatch) {
          const individuallyValid = rawQuestions.filter((q) => ExamQuestionSchema.safeParse(q).success);
          if (individuallyValid.length >= questionsInThisBatch) {
            repaired = { questions: individuallyValid.slice(0, questionsInThisBatch) };
          }
        }
      }

      const result = batchSchema.safeParse(repaired);
      if (!result.success) {
        console.error(`[exam/generate] Lot ${batchIndex}/${totalBatches} invalide (tentative ${attempt}/${MAX_BATCH_ATTEMPTS}):`, result.error.flatten());
        throw new Error(`Le lot ${batchIndex} n'a pas produit exactement ${questionsInThisBatch} QCMs valides.`);
      }
      return result.data.questions;
    } catch (error) {
      lastError = error;
    }
  }
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
async function generateShortfallQuestions(
  inputs: ExamCourseInput[],
  totalNeeded: number,
  isVariation: boolean,
  poolTopics: string[],
  systemPromptOverride?: string
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
    const batchQuestions = await generateExamBatch(inputs, ALL_STANDARD_BATCH_INDEX, ALL_STANDARD_BATCH_INDEX, QUESTIONS_PER_BATCH, isVariation, topics, systemPromptOverride);
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
const MODULE_EXAM_REGENERATE_CAP = 5;

/**
 * GET a student's saved exams for one module — the "Mes Examens" sidebar
 * history. Ordered ascending by created_at so the frontend can label them
 * "Examen 1", "Examen 2"... in the order they were actually generated.
 * Scoped to user_id + curriculum_module_id — this IS the fix for the
 * cross-module leakage bug: there was previously no real per-module fetch
 * at all (the sidebar showed a hardcoded MOCK_COURSES list identically on
 * every module), not a filter that forgot to apply.
 *
 * ALSO reports the student's live "Régénérer" quota (regenerationsUsed /
 * regenerationsRemaining, from profiles.module_exam_regenerations_used) so
 * the frontend can sync its attempts counter to server truth on mount
 * instead of trusting a client-local value that always resets to
 * MAX_ATTEMPTS on reload. This secondary read fails OPEN (0 used, full cap
 * remaining) on error — a profile-read hiccup shouldn't take down the whole
 * exam history fetch, and the real cap is still enforced authoritatively by
 * reserve_module_exam_regenerate in POST regardless of what this GET reports.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const moduleIdParam = request.nextUrl.searchParams.get("moduleId");
  const moduleId = moduleIdParam ? Number(moduleIdParam) : NaN;
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // PERFORMANCE: this read is fully independent of the exam-history query
  // just below (filtered only by user.id, no data dependency either way) —
  // wrapped in its own never-throwing IIFE (preserving the exact same
  // fail-open-to-0 behavior as before) so it can run CONCURRENTLY instead of
  // strictly after, shaving one avoidable round trip off every "Mes Examens"
  // sidebar load.
  const regenerationsUsedPromise = (async (): Promise<number> => {
    try {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("module_exam_regenerations_used")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) {
        console.warn("[exam/generate] Échec lecture quota régénération (fail-open à 0):", profileError.message);
        return 0;
      }
      return profile?.module_exam_regenerations_used ?? 0;
    } catch (profileReadError) {
      console.warn("[exam/generate] Erreur inattendue lecture quota régénération (fail-open à 0):", profileReadError);
      return 0;
    }
  })();

  const [{ data, error }, regenerationsUsed] = await Promise.all([
    supabase
      .from("module_generated_exams")
      .select("id, selected_courses, content, created_at")
      .eq("user_id", user.id)
      .eq("curriculum_module_id", moduleId)
      .order("created_at", { ascending: true }),
    regenerationsUsedPromise,
  ]);

  if (error) {
    console.error("[exam/generate] Échec lecture historique:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const regenerationsRemaining = Math.max(0, MODULE_EXAM_REGENERATE_CAP - regenerationsUsed);

  return NextResponse.json({
    success: true,
    exams: (data ?? []).map((row) => ({
      id: row.id,
      selectedCourses: row.selected_courses,
      content: row.content,
      createdAt: row.created_at,
    })),
    regenerationsUsed,
    regenerationsRemaining,
  });
}

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
function friendlyOpenRouterErrorMessage(error: OpenRouterError): string {
  const looksLikeContextOverflow =
    error.status === 400 && /context.length|context_length_exceeded|maximum context|too many tokens|provider returned error/i.test(error.message);
  if (looksLikeContextOverflow) {
    return "Le contenu sélectionné est trop volumineux pour être traité en une seule fois (trop de cours, ou des cours très longs). Réessaie avec moins de cours sélectionnés à la fois.";
  }
  return error.message;
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`exam-generate:${user.id}`, RATE_LIMITS.ai);
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

  const { moduleId, courseIds, variation, styleProfile: rawStyleProfile } = (body ?? {}) as {
    moduleId?: unknown;
    courseIds?: unknown;
    variation?: unknown;
    styleProfile?: unknown;
  };

  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'courseIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  const isVariation = variation === true;

  // Examen Guidé par le Style Prof — optional style profile extracted by
  // POST /api/exam/analyze-reference from a student-uploaded reference exam.
  // Kept entirely ephemeral (never persisted server-side): the client holds
  // it in React state and resends it verbatim with each generate/regenerate
  // call. Validated strictly here since it directly becomes prompt text.
  let styleProfile: ExamStyleProfile | undefined;
  if (rawStyleProfile !== undefined) {
    const styleParse = ExamStyleProfileSchema.safeParse(rawStyleProfile);
    if (!styleParse.success) {
      return NextResponse.json({ success: false, error: "'styleProfile' est invalide." }, { status: 400 });
    }
    styleProfile = styleParse.data;
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // Global, per-student regeneration ceiling — 5 ever, across every module
  // (product direction). Checked BEFORE anything else on a variation
  // request, so a capped-out student never even reaches the quota
  // reservation below. A first-ever generation (isVariation === false) never
  // counts against this — only explicit "Régénérer" clicks do.
  //
  // Captured outside the `if` so the final success response below can
  // report the SAME authoritative remaining-count the RPC just computed,
  // instead of the frontend having to guess or re-derive it separately.
  let regenerationsRemaining: number | undefined;
  if (isVariation) {
    const { data: regenCount, error: regenCapError } = await supabase.rpc("reserve_module_exam_regenerate", {
      p_user_id: user.id,
      p_cap: MODULE_EXAM_REGENERATE_CAP,
    });
    if (regenCapError) {
      console.error("[exam/generate] Échec réservation du plafond de régénération:", regenCapError.message);
      return NextResponse.json({ success: false, error: `Vérification du plafond échouée : ${regenCapError.message}` }, { status: 500 });
    }
    if (regenCount === null) {
      return NextResponse.json(
        {
          success: false,
          error: `Tu as atteint la limite de ${MODULE_EXAM_REGENERATE_CAP} régénérations pour l'Examen de Module.`,
          regenerationsRemaining: 0,
        },
        { status: 403 }
      );
    }
    // regenCount is the RPC's post-increment used-count for this student.
    regenerationsRemaining = Math.max(0, MODULE_EXAM_REGENERATE_CAP - regenCount);
  }

  // Captured here, not read as `user.id` inside the nested function below —
  // TS's control-flow narrowing from the `if (!user)` guard above doesn't
  // cross a nested function-declaration boundary (same gotcha hit earlier
  // in app/api/studio/regenerate/route.ts).
  const userId = user.id;

  /** Undoes the regeneration reservation above on a downstream failure — same "a failed attempt shouldn't cost you a unit" fairness as refundGeneration. No-op for a first-ever (non-variation) generation. */
  async function refundModuleExamRegenerateIfNeeded() {
    if (!isVariation) return;
    const { error } = await supabase.rpc("refund_module_exam_regenerate", { p_user_id: userId });
    if (error) console.warn("[exam/generate] Échec refund_module_exam_regenerate:", error.message);
  }

  // Scoped to THIS user AND THIS module — a courseId the student doesn't
  // own, or one that belongs to a different module, is silently excluded.
  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, explication, raw_text, qcms")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .in("id", courseIds)
    .order("id", { ascending: true });

  if (coursesError) {
    console.error("[exam/generate] Échec lecture Supabase:", coursesError);
    await refundModuleExamRegenerateIfNeeded();
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = (courses ?? []) as EligibleCourseRow[];
  if (eligibleCourses.length === 0) {
    await refundModuleExamRegenerateIfNeeded();
    return NextResponse.json({ success: false, error: "Aucun cours sélectionné trouvé dans ce module." }, { status: 400 });
  }

  // Cross-student cache, keyed on the SET of selected courses' content — see
  // exam_content_cache's comment in supabase/schema.sql. Skipped entirely for
  // variation:true requests: that flag IS this route's own "Régénérer",
  // which must always produce a DIFFERENT exam than the canonical cached one
  // — see lib/exam-content-cache.ts's own doc comment. "Régénérer" has its
  // own separate, bounded variation pool instead (exam_content_variations,
  // just below), so a LATER student's "Régénérer" on this same course set
  // can still land on $0 once that pool fills up.
  const contentHash = computeExamContentHash(eligibleCourses);
  let cachedContent: unknown | null = null;
  // A style-mimicry exam is inherently per-student (it clones THEIR uploaded
  // reference exam) — never served from, or written to, the cross-student
  // cache that assumes any two students selecting the same course set want
  // the identical canonical exam.
  if (!isVariation && !styleProfile) {
    cachedContent = await lookupExamCache(contentHash);
    if (cachedContent) void recordExamCacheHit(contentHash);
  }

  // MAX_EXAM_VARIATIONS real generations are ever produced per course set on
  // "Régénérer" — past that cap, every further click is served from the pool
  // below at $0, shared across every student who regenerates this same set.
  let variationContent: unknown | null = null;
  let existingVariations: { id: string; content: unknown; variation_index: number }[] = [];
  if (isVariation && !styleProfile) {
    const { existing } = await lookupExamVariations(contentHash);
    existingVariations = existing;
    if (existing.length >= MAX_EXAM_VARIATIONS) {
      const picked = existing[Math.floor(Math.random() * existing.length)];
      void recordExamVariationHit(picked.id);
      variationContent = picked.content;
    }
  }
  const servedFromVariationPool = variationContent !== null;

  let validated: ReturnType<typeof ExamGenerationSchema.parse> | null = null;
  // Quota reserved only right before the one branch that actually makes a
  // real OpenRouter call — a cache hit or a variation-pool hit above never
  // reaches this line, so neither ever consumes courseCap (same "cache hits
  // don't count" rule as everywhere else in this app; previously this
  // reservation ran unconditionally, even on what turned out to be a free
  // cache hit).
  let reservedGeneration = false;
  if (!cachedContent && !servedFromVariationPool) {
    const quotaGate = await reserveGeneration(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }
    reservedGeneration = true;

    try {
      if (styleProfile) {
        // STYLE-MIMICRY BRANCH (Examen Guidé par le Style Prof): pooling and
        // harvesting are bypassed entirely — reusing an already-generated
        // Studio QCM would silently dilute the "clone chirurgical" the
        // student asked for, since that pooled question was never written in
        // the uploaded reference exam's style. Every question is freshly
        // generated against buildExamStyleAdaptedSystemPrompt, treating the
        // whole EXAM_TARGET_TOTAL as one big "shortfall" so the existing
        // batching/retry machinery (generateShortfallQuestions) can be reused
        // unchanged rather than duplicated. This does mean a style-mimicry
        // exam costs meaningfully more real generation calls than a normal
        // one — accepted per product direction (v1 has no separate quota for
        // this, it's gated by the same reserveGeneration check above).
        const courseInputs = buildCourseInputs(eligibleCourses, eligibleCourses.length);
        const styleSystemPrompt = buildExamStyleAdaptedSystemPrompt(courseInputs, styleProfile);
        const generatedQuestions = await generateShortfallQuestions(courseInputs, EXAM_TARGET_TOTAL, isVariation, [], styleSystemPrompt);
        const allQuestions = generatedQuestions.slice(0, 60);

        const result = ExamGenerationSchema.safeParse({ questions: allQuestions });
        if (!result.success) {
          console.error("[exam/generate] Examen style-adapté invalide malgré des lots valides:", result.error.flatten());
          throw new Error("L'IA n'a pas produit un examen valide (nombre de questions ou format incorrect). Réessaie.");
        }
        validated = result.data;
      } else {
        // Previously-harvested QCMs (see lib/exam-harvested-qcms.ts) — each
        // one started life as a shortfall question generated for SOME past
        // exam, on SOME course-set combination, and is now reusable pool
        // material for THIS exam too, regardless of which courses it's
        // combined with this time. Fetched once for every selected course;
        // fail-open (a lookup error just yields an empty map, same as no
        // harvested supply existing yet).
        const harvestedByCourseId = await lookupHarvestedQcms(eligibleCourses.map((c) => c.id));

        // SMART AGGREGATION (see lib/exam-pooling.ts's own header comment for
        // the exact compatibility rules) — pool each course's own already-
        // generated, exam-compatible QCMs (from its Studio QCM tile AND its
        // harvested supply) FIRST, ceiling-divided so the target total lands
        // at/above EXAM_TARGET_TOTAL regardless of course count. Applied
        // identically on a first-ever generation AND on `variation: true`
        // (Régénérer) — a regeneration naturally draws a different random
        // subset whenever a course's compatible pool is larger than its
        // target (see poolExamQuestions' own shuffle comment), satisfying
        // "shuffle and pull a different subset" without any separate
        // "already shown" tracking.
        const targetPerCourse = Math.max(1, Math.ceil(EXAM_TARGET_TOTAL / eligibleCourses.length));
        const { pooled, shortfallByCourse } = poolExamQuestions(
          eligibleCourses.map((c) => ({ id: c.id, title: c.title, qcms: c.qcms, harvestedQcms: harvestedByCourseId.get(c.id) })),
          targetPerCourse
        );
        if (shortfallByCourse.length > 0) {
          console.log(`[exam/generate] Pool insuffisant pour ${shortfallByCourse.length} cours (fallback génération) :`, shortfallByCourse);
        }

        // The AI is invoked ONLY for the shortfall, and PER COURSE (not one
        // combined multi-course call like before) — this is what makes
        // per-course harvesting possible at all: a combined call has no way
        // to know which generated question was "about" which course, so
        // nothing from it could ever be attributed back to a course's own
        // harvested pool. Each course's own shortfall is still generated in
        // batches of up to QUESTIONS_PER_BATCH internally (generateShortfallQuestions
        // is unchanged) — budgetCourseCount is passed explicitly as the FULL
        // eligible-course count (not the narrowed 1-course array's own
        // length) so this loop keeps sharing MAX_TOTAL_EXAM_CHARS the same
        // way the old combined call did, instead of silently handing every
        // course the full ceiling.
        //
        // CONCURRENT (bounded — see MAX_CONCURRENT_COURSE_GENERATIONS' own
        // comment), NOT sequential, fixed 2026-09-30 after a real, confirmed
        // scalability bug: a plain `for...of` awaiting one course at a time
        // here meant total wall-clock scaled LINEARLY with how many selected
        // courses lacked a sufficient pooled QCM supply — and most do, since
        // convertIfCompatible (lib/exam-pooling.ts) requires a Studio QCM to
        // already have exactly 5 options / exactly 1 correct answer / a full
        // per-option explanation, a shape most existing Studio QCMs were
        // never generated to match. A 30-40+ course "Semaine Bloquée"
        // selection where most courses needed even their 1-question
        // shortfall could require 30-40 SEQUENTIAL OpenRouter calls — each a
        // full QUESTIONS_PER_BATCH generation (see generateShortfallQuestions'
        // own "ALWAYS request the full batch size" comment) — comfortably
        // exceeding this route's maxDuration=300 long before the last course.
        // This is the actual, evidenced root cause of "Échec de la
        // génération" scaling with course count: each call here already
        // sends only ONE course's own capped text (buildCourseInputs), so
        // context-length overflow was never the real risk for this path —
        // only wall-clock, and only because of the sequential await.
        //
        // TRADE-OFF, same shape already accepted for Explication's own
        // concurrent part-generation (see stitchSeams' comment in
        // lib/studio-explication-client.ts): `allTopicsSoFar` can no longer
        // grow LIVE across this loop — each course's call only sees topics
        // known BEFORE the fan-out starts (every pooled question's tag), not
        // topics another course's concurrently-running shortfall is
        // generating right now. Accepted without an Explication-style repair
        // pass: unlike Explication's within-course continuity (adjacent
        // parts of the SAME subject), cross-course topic overlap between
        // independently-selected courses (different subjects) was never a
        // meaningful risk — buildExamBatchInstruction's topic list exists to
        // stop the SAME course re-testing the same notion, which stays fully
        // enforced within each course's own (still-sequential) internal
        // batch loop.
        //
        // RESILIENCE: one course's shortfall failing outright (after its own
        // MAX_BATCH_ATTEMPTS retries) no longer aborts the whole exam — caught
        // per-course below and logged, contributing 0 questions from that one
        // course instead of throwing. The final ExamGenerationSchema.safeParse
        // below (min 40 questions) is the single, already-existing arbiter of
        // whether the resulting exam is still acceptable overall — the
        // student gets a real, usable exam built from every course that DID
        // succeed instead of a blanket "Échec de la génération" over one
        // course's failure, with no new fabrication risk (a short-changed
        // course just contributes fewer real questions, never an invented one).
        const allTopicsSoFar = pooled.map((q) => q.weakPointTag);
        const shortfallResults = await mapWithConcurrencyLimit(shortfallByCourse, MAX_CONCURRENT_COURSE_GENERATIONS, async (shortfall) => {
          const course = eligibleCourses.find((c) => c.id === shortfall.id);
          if (!course) return []; // unreachable — shortfallByCourse is derived from eligibleCourses itself
          const courseInputs = buildCourseInputs([course], eligibleCourses.length);
          try {
            const courseQuestions = await generateShortfallQuestions(courseInputs, shortfall.shortfall, isVariation, allTopicsSoFar);
            for (const question of courseQuestions) {
              // Sanitized the same way the exam's own canonical save is below —
              // a stray control character in raw LLM output would otherwise fail
              // this jsonb insert silently (caught by storeHarvestedQcm's own
              // fail-open catch), permanently losing an already-paid-for
              // generation that should have become poolable.
              void storeHarvestedQcm(shortfall.id, sanitizeForPostgres(convertExamQuestionToHarvestableQcm(question, 0)));
            }
            return courseQuestions;
          } catch (error) {
            console.warn(
              `[exam/generate] Shortfall échoué pour le cours ${shortfall.id} ("${shortfall.title}") — exam continue sans ses questions:`,
              errorMessage(error)
            );
            return [];
          }
        });
        const generatedQuestions = shortfallResults.flat();

        // Upper-bound safety net: targetPerCourse is ceiling-divided, so for an
        // unusually large course count the combined total could land just
        // above ExamGenerationSchema's own max(60) — trimmed here rather than
        // failing the whole request over an edge case that never loses the
        // required 40-question floor (targetPerCourse*courses.length is
        // always >= EXAM_TARGET_TOTAL by construction).
        const allQuestions = [...pooled, ...generatedQuestions].slice(0, 60);

        const result = ExamGenerationSchema.safeParse({ questions: allQuestions });
        if (!result.success) {
          // NO LONGER unreachable-in-practice, 2026-09-30: pooled and
          // successfully-generated questions are each individually valid by
          // construction, but the per-course shortfall fan-out above now
          // tolerates individual course failures (see its own comment) rather
          // than throwing — so the combined count can genuinely fall short of
          // ExamGenerationSchema's min(40) if enough courses' shortfalls fail
          // in the same request. This is the real, intended failure mode for
          // that case: still a clean, reported error (with quota refunded
          // below) rather than a partial/broken exam silently saved.
          console.error("[exam/generate] Examen final invalide malgré des lots valides:", result.error.flatten());
          throw new Error("L'IA n'a pas produit un examen valide (nombre de questions ou format incorrect). Réessaie.");
        }
        validated = result.data;
      }
    } catch (error) {
      await refundGeneration(user.id);
      await refundModuleExamRegenerateIfNeeded();
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: friendlyOpenRouterErrorMessage(error) }, { status: error.status });
      }
      console.error("[exam/generate] Erreur non gérée:", error);
      return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
    }
  }

  const content = cachedContent
    ? cachedContent
    : servedFromVariationPool
      ? variationContent
      : sanitizeForPostgres({
          questions: validated!.questions.map((question, index) => ({ id: `q${index + 1}`, ...question })),
        });
  const selectedCourses = eligibleCourses.map((course) => ({ id: course.id, title: course.title }));

  if (!cachedContent && !isVariation && !styleProfile) {
    void storeExamCache(contentHash, content, selectedCourses);
  }
  if (isVariation && !servedFromVariationPool) {
    const variationInsert = await insertExamVariation(contentHash, existingVariations.length + 1, content);
    if (variationInsert.conflict) {
      console.warn("[exam/generate] Conflit d'insertion de variation (course concurrent) — contenu propre servi quand même.");
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("module_generated_exams")
    .insert({
      user_id: user.id,
      curriculum_module_id: moduleId,
      selected_courses: selectedCourses,
      content,
    })
    .select("id, selected_courses, content, created_at")
    .single();

  if (insertError || !inserted) {
    // The exam was generated but never durably saved — treated as a full
    // failure (refunded), not a partial success, per this route's
    // atomic generate-then-save policy. Guarded on reservedGeneration: a
    // cache hit or variation-pool hit never reserved courseCap in the first
    // place, so there is nothing to refund on that path.
    if (reservedGeneration) await refundGeneration(user.id);
    await refundModuleExamRegenerateIfNeeded();
    console.error("[exam/generate] Échec sauvegarde:", insertError);
    return NextResponse.json({ success: false, error: "L'examen a été généré mais n'a pas pu être sauvegardé. Réessaie." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    exam: {
      id: inserted.id,
      selectedCourses: inserted.selected_courses,
      content: inserted.content,
      createdAt: inserted.created_at,
    },
    // Only set for isVariation:true requests (see above) — a first-ever
    // generation doesn't touch the regeneration cap, so there's nothing new
    // to report here; the frontend's GET-history sync already covers that case.
    ...(regenerationsRemaining !== undefined ? { regenerationsRemaining } : {}),
  });
}

/**
 * Defensive top-level backstop — handlePost already has its own targeted
 * try/catch around the AI generation step (with quota refunds attached), but
 * an unexpected exception anywhere ELSE in that function (a DB read, a
 * schema check, anything not anticipated) would otherwise escape as an
 * unhandled rejection and surface to the student as an opaque framework
 * crash/generic connection failure instead of this app's own
 * `{success:false, error}` JSON shape the frontend knows how to render. Never
 * masks a real, already-handled error response — only ever catches what
 * handlePost itself did not.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[exam/generate] Exception non interceptée:", error);
    return NextResponse.json({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }, { status: 500 });
  }
}
