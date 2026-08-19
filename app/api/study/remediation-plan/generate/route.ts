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
export const maxDuration = 60;

/** Generous per-course cap (course_weak_qcms's own default is 8) — this feature wants enough real signal to synthesize genuine patterns across a course, not just its single worst question. */
const PER_COURSE_LIMIT = 15;
/** Hard ceiling on how many weak items get sent to the model at all, across every active course combined — bounds token cost regardless of how many modules are active. */
const MAX_TOTAL_ITEMS = 40;

interface StudioCourseRow {
  id: number;
  title: string;
  qcms: GastriteQcmsData | null;
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

  const activeModuleIds = profile?.weakness_active_module_ids ?? [];
  if (activeModuleIds.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun module actif." }, { status: 400 });
  }

  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, qcms")
    .eq("user_id", user.id)
    .in("curriculum_module_id", activeModuleIds)
    .not("qcms", "is", null);

  if (coursesError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = (courses ?? []) as StudioCourseRow[];
  if (eligibleCourses.length === 0) {
    return NextResponse.json(
      { success: false, error: "Aucun cours avec des QCM générés dans tes modules actifs." },
      { status: 400 }
    );
  }

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

    const items = perCourseWeakItems.flat().slice(0, MAX_TOTAL_ITEMS);

    if (items.length === 0) {
      // Modules ARE active and have QCMs, but the student has no recorded
      // wrong/fragile attempts yet — an honest "not enough data" outcome,
      // never a fabricated plan. Deliberately checked BEFORE the quota gate
      // below: a no-op response must never cost a Freemium student their
      // (0-cap) quota.
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
      { model: STUDIO_MODEL, maxTokens: 4000, bypassMock: true }
    );

    const parsed = parseJsonResponse(raw);
    const result = RemediationPlanSchema.safeParse(parsed);
    if (!result.success) {
      console.error("[remediation-plan/generate] Validation zod échouée :", result.error.flatten());
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
