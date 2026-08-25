import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PATCH — toggles one task's checkbox. Body: { isCompleted: boolean }.
 * Deliberately its own tiny route (not folded into PATCH /plans/[id]) so a
 * single checkbox click is one cheap, narrowly-scoped row UPDATE — the
 * frontend applies the checkbox optimistically and only needs to know
 * whether THIS write succeeded, not re-fetch the whole plan/task list.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-task-toggle:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const planId = Number(params.id);
  const taskId = Number(params.taskId);
  if (!Number.isFinite(planId) || !Number.isFinite(taskId)) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { isCompleted } = (body ?? {}) as { isCompleted?: unknown };
  if (typeof isCompleted !== "boolean") {
    return NextResponse.json({ success: false, error: "'isCompleted' est requis (booléen)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("study_plan_tasks")
    .update({ is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null }, { count: "exact" })
    .eq("id", taskId)
    .eq("plan_id", planId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[study-planner/tasks:toggle] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: `Mise à jour échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Tâche introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
