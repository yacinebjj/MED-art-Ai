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
// Safe to raise without a proportional cost increase: generateExamBatch
// below now sends this text inside a cache_control-marked system block, so
// only the FIRST of the 5 sequential batches pays full price for it —
// batches 2-5 read it from Anthropic's prompt cache instead of repricing it
// from scratch every time.
const MAX_TOTAL_EXAM_CHARS = 60_000;
const MAX_PER_COURSE_CHARS = MAX_TOTAL_EXAM_CHARS;

interface EligibleCourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string;
  qcms: unknown;
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
 * buildExamStaticSystemPrompt) marked `cache_control: ephemeral` — byte-
 * identical across every shortfall chunk for this exam, so only the first
 * chunk pays full price for it; later chunks hit Anthropic's prompt cache
 * instead (roughly a 90% discount, per Anthropic's published cache-read
 * pricing) rather than repricing the same course text from scratch — this
 * is what makes MAX_PER_COURSE_CHARS above safe to raise without a
 * proportional cost blowup. The DYNAMIC per-batch instructions (previousTopics,
 * variation flag) go in the user message, which necessarily changes every
 * call and was never a caching candidate.
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
          { role: "system", content: [{ type: "text", text: staticSystemPrompt, cache_control: { type: "ephemeral" } }] },
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
export async function POST(request: NextRequest) {
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
        // is unchanged, just called once per under-covered course instead of
        // once for all of them combined) — budgetCourseCount is passed
        // explicitly as the FULL eligible-course count (not the narrowed
        // 1-course array's own length) so this loop keeps sharing
        // MAX_TOTAL_EXAM_CHARS the same way the old combined call did, instead
        // of silently handing every course the full ceiling.
        //
        // previousTopics accumulates ACROSS courses in this loop (seeded with
        // every pooled question's weakPointTag, then growing with each
        // course's own freshly-generated tags before the NEXT course's call)
        // so "ensure new QCMs are completely distinct and non-overlapping"
        // still holds cross-course, not just within one course's own batches —
        // a combined single call used to get this for free from one shared,
        // continuously-growing topics array; the per-course split needs it
        // threaded through explicitly instead.
        const generatedQuestions: ExamQuestion[] = [];
        const allTopicsSoFar = pooled.map((q) => q.weakPointTag);
        for (const shortfall of shortfallByCourse) {
          const course = eligibleCourses.find((c) => c.id === shortfall.id);
          if (!course) continue; // unreachable — shortfallByCourse is derived from eligibleCourses itself
          const courseInputs = buildCourseInputs([course], eligibleCourses.length);
          const courseQuestions = await generateShortfallQuestions(courseInputs, shortfall.shortfall, isVariation, allTopicsSoFar);
          generatedQuestions.push(...courseQuestions);
          for (const question of courseQuestions) {
            allTopicsSoFar.push(question.weakPointTag);
            // Sanitized the same way the exam's own canonical save is below —
            // a stray control character in raw LLM output would otherwise fail
            // this jsonb insert silently (caught by storeHarvestedQcm's own
            // fail-open catch), permanently losing an already-paid-for
            // generation that should have become poolable.
            void storeHarvestedQcm(shortfall.id, sanitizeForPostgres(convertExamQuestionToHarvestableQcm(question, 0)));
          }
        }

        // Upper-bound safety net: targetPerCourse is ceiling-divided, so for an
        // unusually large course count the combined total could land just
        // above ExamGenerationSchema's own max(60) — trimmed here rather than
        // failing the whole request over an edge case that never loses the
        // required 40-question floor (targetPerCourse*courses.length is
        // always >= EXAM_TARGET_TOTAL by construction).
        const allQuestions = [...pooled, ...generatedQuestions].slice(0, 60);

        const result = ExamGenerationSchema.safeParse({ questions: allQuestions });
        if (!result.success) {
          // Should be unreachable in practice — pooled questions are already
          // validated by poolExamQuestions, generated ones by
          // generateShortfallQuestions, and the combined count is
          // constructed to satisfy ExamGenerationSchema's min(40).max(60).
          // Kept as a final backstop rather than trusting the arithmetic
          // blindly.
          console.error("[exam/generate] Examen final invalide malgré des lots valides:", result.error.flatten());
          throw new Error("L'IA n'a pas produit un examen valide (nombre de questions ou format incorrect). Réessaie.");
        }
        validated = result.data;
      }
    } catch (error) {
      await refundGeneration(user.id);
      await refundModuleExamRegenerateIfNeeded();
      if (error instanceof OpenRouterError) {
        return NextResponse.json({ success: false, error: error.message }, { status: error.status });
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
