import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildRemediationPrompt, type RemediationSourceItem } from "@/lib/ai/remediation-prompts";
import { RemediationPlanSchema } from "@/lib/ai/remediation-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { reserveRemediation, refundRemediation } from "@/lib/subscription";
import { errorMessage, parseJsonResponse } from "@/lib/course-generation-shared";
import type { GastriteQcmsData } from "@/lib/course-slug-content";
import type { RemediationPlan } from "@/types/remediation";

export const runtime = "nodejs";
// Bumped from 60s alongside maxTokens below (4000 -> 8000) — up to
// MAX_TOTAL_ITEMS=40 weak points synthesized into real patterns is a
// meaningfully sized structured output, and this was tight enough to risk
// the same truncation failure mode as the exam/study-planner routes.
export const maxDuration = 120;

/** Generous per-course cap (course_weak_qcms's own default is 8) — this feature wants enough real signal to synthesize genuine patterns across a course, not just its single worst question. */
const PER_COURSE_LIMIT = 15;
/** Hard ceiling on how many weak items get sent to the model at all, across BOTH sources (per-course QCM tab attempts + Générateur d'Examen attempts) combined — bounds token cost regardless of how many modules are active or how large a student's exam history is. */
const MAX_TOTAL_ITEMS = 40;
/** Most recent exam sittings considered, across every active module — an exam attempt has no per-item cap the way PER_COURSE_LIMIT does for the QCM-tab source, so this is what bounds that source's own token cost independently of MAX_TOTAL_ITEMS. */
const MAX_EXAM_ATTEMPTS_CONSIDERED = 5;

interface StudioCourseRow {
  id: number;
  title: string;
  qcms: GastriteQcmsData | null;
}

/** Shape of one user_exam_attempts row as fetched here — wrong_questions already denormalized at save time (see lib/exam-scoring.ts), selected_courses pulled in via the exam_id FK relation purely for a display label. */
interface ExamAttemptForRemediationRow {
  wrong_questions: { vignette: string; correctAnswerText: string; weakPointTag: string }[];
  module_generated_exams: { selected_courses: { id: number; title: string }[] } | null;
}

interface WeakQcmRow {
  qcm_id: string;
  is_correct: boolean;
  leitner_box: number;
  attempted_at: string;
}

/** Resolves one "qcm-3" / "qroc-2" id back into its real question + correct-answer text from the course's own qcms JSON — same convention as lib/weak-points.ts's resolveWeakChapters, just extracting different fields (the raw content, not a chapter label). */
function resolveWeakItem(row: WeakQcmRow, courseTitle: string, qcms: GastriteQcmsData | null): RemediationSourceItem | null {
  const match = row.qcm_id.match(/^(qcm|qroc)-(\d+)$/);
  if (!match || !qcms) return null;
  const [, kind, idStr] = match;
  const id = Number(idStr);

  if (kind === "qcm") {
    const item = qcms.qcms?.find((q) => q.id === id);
    if (!item) return null;
    const correctLabels = item.reponsesCorrectes ?? [];
    const correctOptions = item.options?.filter((opt) => correctLabels.includes(opt.label)).map((opt) => `${opt.label}. ${opt.text}`);
    const correctAnswer = [correctOptions?.join(" ; "), item.explication?.globale].filter(Boolean).join(" — ");
    return { courseTitle, question: item.question, correctAnswer: correctAnswer || "(explication non disponible)", wasCorrect: row.is_correct };
  }

  const item = qcms.qrocs?.find((q) => q.id === id);
  if (!item) return null;
  return { courseTitle, question: item.question, correctAnswer: item.reponseOfficielle, wasCorrect: row.is_correct };
}

/**
 * Generates (and persists) a fresh remediation plan from the student's own
 * real wrong/fragile QCM attempts, aggregated across every course in their
 * active modules. Deliberately does NOT reuse the existing `weakness_radar`
 * SQL function (see supabase/schema.sql's comment on
 * weakness_active_module_ids for why: it structurally excludes every Studio
 * course). Instead reuses `course_weak_qcms` per course — a pure
 * qcm_attempts filter with no join, already proven to work correctly for
 * "studio-course-{id}" slugs (see CourseStatsModal's existing usage).
 */
export async function POST(_request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`remediation-plan-generate:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("weakness_active_module_ids")
    .eq("id", user.id)
    .maybeSingle<{ weakness_active_module_ids: number[] | null }>();

  if (profileError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${profileError.message}` }, { status: 500 });
  }

  // weakness_active_module_ids is a SEPARATE, explicit opt-in list — "which
  // modules should the Studio QCM-tab source (course_weak_qcms below)
  // consider", toggled via app/api/modules/[id]/weaknesses. It has NOTHING
  // to do with the Générateur d'Examen: taking an exam is already an
  // explicit, deliberate action (the student picked courses and clicked
  // "Générer l'examen"), so it needs no separate activation flag layered on
  // top. This used to gate BOTH sources — a student who never toggled a
  // module "active" here (or whose exam happened to be in a module that
  // isn't in this list) got `activeModuleIds.length === 0` or an empty
  // studio_courses/user_exam_attempts result and saw "Pas encore assez de
  // données" EVEN THOUGH their user_exam_attempts rows were sitting right
  // there in the table. Fixed below: activeModuleIds now scopes ONLY the
  // Studio QCM-tab query; the exam-attempts query further down is
  // deliberately unscoped by it.
  const activeModuleIds = profile?.weakness_active_module_ids ?? [];
  console.log(`[remediation-plan/generate] user=${user.id} activeModuleIds=${JSON.stringify(activeModuleIds)}`);

  let eligibleCourses: StudioCourseRow[] = [];
  if (activeModuleIds.length > 0) {
    const { data: courses, error: coursesError } = await supabase
      .from("studio_courses")
      .select("id, title, qcms")
      .eq("user_id", user.id)
      .in("curriculum_module_id", activeModuleIds)
      .not("qcms", "is", null);

    if (coursesError) {
      return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
    }
    eligibleCourses = (courses ?? []) as StudioCourseRow[];
  }
  console.log(`[remediation-plan/generate] eligibleCourses (Studio QCM tab, scoped to activeModuleIds)=${eligibleCourses.length}`);

  // Tracks whether reserveRemediation() below actually succeeded, so the
  // catch block at the end of this one big try — which handles errors from
  // BEFORE and AFTER the reservation alike — only refunds when a unit was
  // genuinely reserved (an error while fetching weak QCMs, before any
  // reservation, must never trigger a refund of nothing).
  let reserved = false;

  try {
    const perCourseWeakItems = await Promise.all(
      eligibleCourses.map(async (course) => {
        const { data: weakRows, error: weakError } = await supabase.rpc("course_weak_qcms", {
          p_user_id: user.id,
          p_course_slug: `studio-course-${course.id}`,
          p_limit: PER_COURSE_LIMIT,
        });
        if (weakError) {
          console.error(`[remediation-plan/generate] course_weak_qcms a échoué pour le cours ${course.id}:`, weakError.message);
          return [];
        }
        return ((weakRows ?? []) as WeakQcmRow[])
          .map((row) => resolveWeakItem(row, course.title, course.qcms))
          .filter((item): item is RemediationSourceItem => item !== null);
      })
    );

    // SECOND SOURCE — the standalone Générateur d'Examen (user_exam_attempts,
    // see app/api/exam/attempts/route.ts). Its wrong_questions are already
    // denormalized at save time (vignette/correct-answer text/weakPointTag),
    // so no join back through module_generated_exams.content is needed here
    // — only its `selected_courses` label, fetched via the FK relation, to
    // give the model a "which course(s) this exam covered" hint.
    //
    // Deliberately scoped ONLY by user_id — NOT by activeModuleIds. Taking
    // an exam and getting a question wrong is itself already the explicit
    // signal that matters; requiring the same module to ALSO be separately
    // "activated" via weakness_active_module_ids (a toggle that predates
    // this exam-attempts source and was built for the Studio QCM tab) was
    // exactly what made real, present rows in user_exam_attempts invisible
    // here whenever that toggle hadn't been flipped for that module. Capped
    // to the MOST RECENT MAX_EXAM_ATTEMPTS_CONSIDERED sittings across every
    // module the student has ever taken an exam in — an exam attempt has no
    // per-item cap the way PER_COURSE_LIMIT does, so this is what bounds
    // token cost regardless of how large a student's exam history is.
    const { data: examAttempts, error: examAttemptsError } = await supabase
      .from("user_exam_attempts")
      .select("wrong_questions, module_generated_exams(selected_courses)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_EXAM_ATTEMPTS_CONSIDERED);

    if (examAttemptsError) {
      // Fail-open, like course_weak_qcms's own per-course error handling
      // above — a broken second source must never block the first one.
      console.error("[remediation-plan/generate] Lecture des tentatives d'examen échouée (non bloquant):", examAttemptsError.message);
    }
    console.log(
      `[remediation-plan/generate] user_exam_attempts trouvées=${examAttempts?.length ?? 0}` +
        (examAttemptsError ? ` (erreur: ${examAttemptsError.message})` : "")
    );

    const examDerivedItems: RemediationSourceItem[] = ((examAttempts ?? []) as unknown as ExamAttemptForRemediationRow[]).flatMap(
      (attempt) => {
        const coursesLabel = attempt.module_generated_exams?.selected_courses?.map((c) => c.title).join(", ") || "cours du module";
        return (attempt.wrong_questions ?? []).map((wq) => ({
          courseTitle: `Examen (${coursesLabel})`,
          question: wq.vignette,
          correctAnswer: wq.correctAnswerText,
          wasCorrect: false,
        }));
      }
    );
    console.log(
      `[remediation-plan/generate] perCourseWeakItems=${perCourseWeakItems.flat().length} examDerivedItems=${examDerivedItems.length}`
    );

    const items = [...perCourseWeakItems.flat(), ...examDerivedItems].slice(0, MAX_TOTAL_ITEMS);

    if (items.length === 0) {
      // Genuinely no usable data from EITHER source — an honest "not enough
      // data" outcome, never a fabricated plan. Deliberately checked BEFORE
      // the quota gate below: a no-op response must never cost a Freemium
      // student their (0-cap) quota.
      console.log(`[remediation-plan/generate] user=${user.id} -> noData: true (0 items depuis les deux sources)`);
      return NextResponse.json({ success: true, noData: true });
    }

    // Plan quota RESERVATION — atomic check-and-increment (see
    // reserveRemediation's own comment — closes a TOCTOU race the old
    // check-then-record split had). Only reached once there's real data to
    // build a plan from, i.e. only right before the real OpenRouter call.
    const quotaGate = await reserveRemediation(user);
    if (!quotaGate.allowed) {
      return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
    }
    reserved = true;

    const prompt = buildRemediationPrompt(items);
    const raw = await callOpenRouter(
      [
        { role: "system", content: prompt },
        { role: "user", content: "Génère le plan de remédiation demandé." },
      ],
      { model: STUDIO_MODEL, maxTokens: 8000, bypassMock: true, timeoutMs: 110_000 } // route's own maxDuration is 120s — fail cleanly before the platform kills it
    );

    // parseJsonResponse itself already logs the raw response + attempts a
    // truncation repair on failure (see its own comment in
    // lib/course-generation-shared.ts) — nothing to add for THAT failure
    // mode here. What was missing: when JSON.parse succeeds but zod rejects
    // the shape (schema.strict() means even one extra/missing/mistyped
    // field fails everything), only the ZodError was logged, with no
    // visibility into what the model actually returned — indistinguishable
    // from a truncation in the logs. Now logs both, so a real schema drift
    // is immediately diagnosable instead of looking identical to every other
    // failure.
    const parsed = parseJsonResponse(raw);
    const result = RemediationPlanSchema.safeParse(parsed);
    if (!result.success) {
      console.error(
        "[remediation-plan/generate] JSON valide mais hors-schéma — détail zod:",
        JSON.stringify(result.error.flatten(), null, 2),
        "\nObjet reçu du modèle (2000 premiers caractères):",
        JSON.stringify(parsed).slice(0, 2000)
      );
      throw new Error("La réponse de l'IA ne respecte pas le schéma attendu.");
    }

    const generatedAt = new Date().toISOString();
    const { error: saveError } = await supabase
      .from("profiles")
      .update({ weakness_remediation_plan: result.data.weakSpots, weakness_remediation_generated_at: generatedAt })
      .eq("id", user.id);

    if (saveError) {
      console.error("[remediation-plan/generate] Échec sauvegarde:", saveError);
      // Fail-open on persistence: the plan was generated successfully —
      // still return it even if it won't survive a reload.
    }

    const plan: RemediationPlan = { weakSpots: result.data.weakSpots, generatedAt };
    return NextResponse.json({ success: true, plan });
  } catch (error) {
    if (reserved) await refundRemediation(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[remediation-plan/generate] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }
}
