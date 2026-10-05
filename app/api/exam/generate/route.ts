import { NextRequest, NextResponse } from "next/server";
import { requirePaidPlan } from "@/lib/subscription";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { OpenRouterError } from "@/lib/ai/openrouter";
import { buildExamStaticSystemPrompt, buildExamStyleAdaptedSystemPrompt } from "@/lib/ai/exam-prompts";
import { ExamGenerationSchema, ExamStyleProfileSchema, type ExamStyleProfile } from "@/lib/ai/exam-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveExam, refundExam } from "@/lib/subscription";
import { quotaBlockedResponse } from "@/lib/quota-response";
import { ExamPreferencesSchema, buildExamPreferenceDirective, isDefaultExamPreferences, type ExamPreferences } from "@/lib/exam-preferences";

import { computeExamContentHash, lookupExamCache, recordExamCacheHit, storeExamCache } from "@/lib/exam-content-cache";
import { lookupExamVariations, insertExamVariation, recordExamVariationHit } from "@/lib/exam-content-variations";
import { poolExamQuestions, convertExamQuestionToHarvestableQcm } from "@/lib/exam-pooling";
import {
  EXAM_GENERATION_BUDGET_MS,
  EXAM_TARGET_TOTAL,
  MAX_CONCURRENT_COURSE_GENERATIONS,
  MAX_EXAM_VARIATIONS,
  MODULE_EXAM_REGENERATE_CAP,
  buildCourseInputs,
  friendlyOpenRouterErrorMessage,
  generateShortfallQuestions,
  isMissingRpcError,
  mapWithConcurrencyLimit,
  planShortfallUnits,
  refundRegenerationFallback,
  reserveRegenerationFallback,
  type EligibleCourseRow,
} from "@/lib/exam-generation";
import { lookupHarvestedQcms, storeHarvestedQcm } from "@/lib/exam-harvested-qcms";

export const runtime = "nodejs";
export const maxDuration = 300;

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

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }
  const paidGate = await requirePaidPlan(user.id);
  if (!paidGate.allowed) return quotaBlockedResponse(paidGate);

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

  const { moduleId, courseIds, variation, styleProfile: rawStyleProfile, preferences: rawPreferences } = (body ?? {}) as {
    moduleId?: unknown;
    courseIds?: unknown;
    variation?: unknown;
    styleProfile?: unknown;
    preferences?: unknown;
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

  // Student customization (difficulty, question focus, explanation depth).
  // Defaults = the canonical exam (cache + pooling unchanged); anything else
  // is generated fresh with an extra directive, exactly like a style-guided
  // exam — never served from or written to the cross-student caches.
  let customPreferences: ExamPreferences | undefined;
  if (rawPreferences !== undefined) {
    const preferencesParse = ExamPreferencesSchema.safeParse(rawPreferences);
    if (!preferencesParse.success) {
      return NextResponse.json({ success: false, error: "'preferences' est invalide." }, { status: 400 });
    }
    if (!isDefaultExamPreferences(preferencesParse.data)) customPreferences = preferencesParse.data;
  }
  const isPersonalizedExam = Boolean(styleProfile || customPreferences);

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
    const rpcResult = await supabase.rpc("reserve_module_exam_regenerate", {
      p_user_id: user.id,
      p_cap: MODULE_EXAM_REGENERATE_CAP,
    });
    let regenCount: number | null = rpcResult.data as number | null;
    let regenCapError = rpcResult.error;
    if (isMissingRpcError(regenCapError)) {
      console.warn("[exam/generate] reserve_module_exam_regenerate absent — repli sur la réservation directe (migration 20261004 à exécuter).");
      const fallback = await reserveRegenerationFallback(supabase, user.id, MODULE_EXAM_REGENERATE_CAP);
      if (fallback === "unavailable") {
        return NextResponse.json(
          { success: false, error: "La régénération est momentanément indisponible (mise à jour du serveur en cours). Ton examen actuel est conservé : réessaie dans quelques minutes." },
          { status: 503 }
        );
      }
      regenCount = fallback;
      regenCapError = null;
    }
    if (regenCapError) {
      console.error("[exam/generate] Échec réservation du plafond de régénération:", regenCapError.message);
      return NextResponse.json({ success: false, error: "Impossible de vérifier ton quota de régénérations pour le moment. Réessaie dans quelques minutes." }, { status: 500 });
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
    if (isMissingRpcError(error)) await refundRegenerationFallback(supabase, userId);
    else if (error) console.warn("[exam/generate] Échec refund_module_exam_regenerate:", error.message);
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
  if (!isVariation && !isPersonalizedExam) {
    cachedContent = await lookupExamCache(contentHash);
    if (cachedContent) void recordExamCacheHit(contentHash);
  }

  // MAX_EXAM_VARIATIONS real generations are ever produced per course set on
  // "Régénérer" — past that cap, every further click is served from the pool
  // below at $0, shared across every student who regenerates this same set.
  let variationContent: unknown | null = null;
  let existingVariations: { id: string; content: unknown; variation_index: number }[] = [];
  if (isVariation && !isPersonalizedExam) {
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
    const quotaGate = await reserveExam(user);
    if (!quotaGate.allowed) {
      await refundModuleExamRegenerateIfNeeded();
      return quotaBlockedResponse(quotaGate);
    }
    reservedGeneration = true;

    const generationDeadline = Date.now() + EXAM_GENERATION_BUDGET_MS;
    try {
      if (isPersonalizedExam) {
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
        const baseSystemPrompt = styleProfile ? buildExamStyleAdaptedSystemPrompt(courseInputs, styleProfile) : buildExamStaticSystemPrompt(courseInputs);
        const preferenceDirective = customPreferences ? buildExamPreferenceDirective(customPreferences) : "";
        const styleSystemPrompt = preferenceDirective ? `${baseSystemPrompt}\n\n${preferenceDirective}` : baseSystemPrompt;
        const generatedQuestions = await generateShortfallQuestions(courseInputs, EXAM_TARGET_TOTAL, isVariation, [], styleSystemPrompt, generationDeadline);
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
        // MAP-REDUCE GROUPING — see EXAM_GENERATION_BUDGET_MS' comment: at most
        // one concurrent wave of calls, whatever the number of courses.
        const shortfallUnits = planShortfallUnits(shortfallByCourse, eligibleCourses);
        const shortfallResults = await mapWithConcurrencyLimit(shortfallUnits, MAX_CONCURRENT_COURSE_GENERATIONS, async (unit) => {
          // Single course: its share of the whole selection's budget (unchanged).
          // Group: the 40k budget is shared inside the group only.
          const courseInputs = unit.harvestCourseId !== null ? buildCourseInputs(unit.courses, eligibleCourses.length) : buildCourseInputs(unit.courses, unit.courses.length);
          const shortfall = { id: unit.harvestCourseId ?? unit.courses[0].id, title: unit.courses.map((c) => c.title).join(" + ") };
          try {
            const courseQuestions = await generateShortfallQuestions(courseInputs, unit.count, isVariation, allTopicsSoFar, undefined, generationDeadline);
            // A grouped call cannot say which question belongs to which
            // course, so only single-course units feed the harvested pool.
            if (unit.harvestCourseId === null) return courseQuestions;
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
        // required question floor (targetPerCourse*courses.length is always
        // >= EXAM_TARGET_TOTAL by construction).
        let allQuestions = [...pooled, ...generatedQuestions].slice(0, 60);

        // GAP FILLER, 2026-09-30: per-course shortfall generation is now both
        // concurrent AND partial-tolerant (see the fan-out's own comment and
        // generateExamBatch's own final comment) — both changes make the
        // remaining shortfall, if any, typically small (a handful of
        // questions) rather than the dozens a fully-failed course used to
        // lose. Rather than accepting that small gap immediately or failing
        // the whole exam over it, ONE extra fast top-up call tries to close
        // it: a single combined-courses request (budget-shared exactly like
        // buildCourseInputs' own division above) for just the missing count.
        // Reuses generateShortfallQuestions unchanged — for a gap this size
        // (almost always <= QUESTIONS_PER_BATCH) that's exactly ONE
        // additional OpenRouter call, not a new batching architecture.
        // Best-effort: a failure here is caught and logged, never thrown —
        // the exam is still served with whatever it already had going in,
        // exactly as if this top-up attempt had never run.
        // Only when time remains: the route must always answer before maxDuration.
        if (allQuestions.length < EXAM_TARGET_TOTAL && generationDeadline - Date.now() > 60_000) {
          const gapCount = EXAM_TARGET_TOTAL - allQuestions.length;
          try {
            const topUpInputs = buildCourseInputs(eligibleCourses, eligibleCourses.length);
            const topUpTopics = [...allTopicsSoFar, ...generatedQuestions.map((q) => q.weakPointTag)];
            const topUpQuestions = await generateShortfallQuestions(topUpInputs, gapCount, isVariation, topUpTopics, undefined, generationDeadline);
            allQuestions = [...allQuestions, ...topUpQuestions].slice(0, 60);
          } catch (error) {
            console.warn("[exam/generate] Top-up de comblement échoué — examen servi avec le compte actuel:", errorMessage(error));
          }
        }

        const result = ExamGenerationSchema.safeParse({ questions: allQuestions });
        if (!result.success) {
          // Still reachable, deliberately: even with concurrent + partial-
          // tolerant shortfall generation AND the gap-filler top-up above,
          // a request where MOST selected courses' shortfalls fail outright
          // (a genuine, sustained upstream outage, not an occasional
          // malformed question) can still land under ExamGenerationSchema's
          // own floor. That floor was RELAXED, not removed (see its own
          // comment in lib/ai/exam-schemas.ts) — this path is now a real,
          // meaningfully rarer last resort, still a clean, reported error
          // (with quota refunded below) rather than a broken exam saved.
          console.error("[exam/generate] Examen final invalide malgré des lots valides:", result.error.flatten());
          throw new Error("L'IA n'a pas produit un examen valide (nombre de questions ou format incorrect). Réessaie.");
        }
        validated = result.data;
      }
    } catch (error) {
      await refundExam(user.id);
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

  if (!cachedContent && !isVariation && !isPersonalizedExam) {
    void storeExamCache(contentHash, content, selectedCourses);
  }
  // Personalized exams never enter the shared variation pool either.
  if (isVariation && !servedFromVariationPool && !isPersonalizedExam) {
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
    if (reservedGeneration) await refundExam(user.id);
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
