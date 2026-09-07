import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import type { RemediationPlan } from "@/types/remediation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pure, free read of whatever remediation plan is already cached on
 * `profiles.weakness_remediation_plan` — never calls the AI itself (see
 * app/api/study/remediation-plan/generate/route.ts for that). Opening
 * /study must never silently re-spend tokens; only an explicit
 * "Générer"/"Régénérer" click does. `activeModuleCount` lets the frontend
 * tell "no modules activated" apart from "modules activated, but no plan
 * generated yet" — two different empty states.
 *
 * `hasExamAttempts` is a SEPARATE signal, deliberately not folded into
 * activeModuleCount: weakness_active_module_ids is an opt-in toggle built
 * for the Studio QCM-tab source only (see app/api/modules/[id]/weaknesses).
 * A student who has never toggled any module there, but who HAS taken a
 * Générateur d'Examen exam and gotten questions wrong (a real row in
 * user_exam_attempts), must still see the "Générer" button rather than
 * "no-modules-active" — taking an exam is itself already an explicit signal,
 * it doesn't need a second, unrelated opt-in on top. See
 * app/api/study/remediation-plan/generate/route.ts's own comment for the
 * matching fix on the generation side.
 */
export async function GET(_request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data, error }, { count: examAttemptCount, error: examAttemptError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("weakness_active_module_ids, weakness_remediation_plan, weakness_remediation_generated_at")
      .eq("id", user.id)
      .maybeSingle<{
        weakness_active_module_ids: number[] | null;
        weakness_remediation_plan: RemediationPlan["weakSpots"] | null;
        weakness_remediation_generated_at: string | null;
      }>(),
    supabase.from("user_exam_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id),
  ]);

  if (error) {
    console.error("[study/remediation-plan:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${errorMessage(error)}` }, { status: 500 });
  }
  if (examAttemptError) {
    // Fail-open — a broken count must never block the plan/module-count read
    // above; the student just falls back to activeModuleCount alone.
    console.error("[study/remediation-plan:get] Comptage des tentatives d'examen échoué (non bloquant):", examAttemptError.message);
  }

  const activeModuleCount = data?.weakness_active_module_ids?.length ?? 0;
  const hasExamAttempts = (examAttemptCount ?? 0) > 0;
  const plan: RemediationPlan | null =
    data?.weakness_remediation_plan && data?.weakness_remediation_generated_at
      ? { weakSpots: data.weakness_remediation_plan, generatedAt: data.weakness_remediation_generated_at }
      : null;

  return NextResponse.json({ success: true, activeModuleCount, hasExamAttempts, plan });
}
