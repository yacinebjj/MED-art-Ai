import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PATCH — updates one task's checkbox and/or its manual sort position.
 * Body: { isCompleted?: boolean, sortOrder?: number } (at least one of the
 * two). Deliberately its own tiny route (not folded into PATCH /plans/[id])
 * so a single checkbox click or drag-reorder drop is one cheap, narrowly-
 * scoped row UPDATE — the frontend applies both optimistically and only
 * needs to know whether THIS write succeeded, not re-fetch the whole
 * plan/task list. sortOrder was added alongside the God-Tier redesign's
 * drag-to-reorder — purely additive, the isCompleted-only shape every
 * existing caller already sends keeps working unchanged.
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

  const { isCompleted, sortOrder } = (body ?? {}) as { isCompleted?: unknown; sortOrder?: unknown };
  if (isCompleted === undefined && sortOrder === undefined) {
    return NextResponse.json({ success: false, error: "'isCompleted' ou 'sortOrder' est requis." }, { status: 400 });
  }
  if (isCompleted !== undefined && typeof isCompleted !== "boolean") {
    return NextResponse.json({ success: false, error: "'isCompleted' doit être un booléen." }, { status: 400 });
  }
  if (sortOrder !== undefined && (typeof sortOrder !== "number" || !Number.isFinite(sortOrder))) {
    return NextResponse.json({ success: false, error: "'sortOrder' doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const updates: Record<string, unknown> = {};
  if (isCompleted !== undefined) {
    updates.is_completed = isCompleted;
    updates.completed_at = isCompleted ? new Date().toISOString() : null;
  }
  if (sortOrder !== undefined) {
    updates.sort_order = sortOrder;
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("study_plan_tasks")
    .update(updates, { count: "exact" })
    .eq("id", taskId)
    .eq("plan_id", planId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[study-planner/tasks:update] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: `Mise à jour échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Tâche introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE — removes one task. Added alongside the God-Tier redesign's
 * swipe-to-delete gesture; the frontend always pairs this with a client-side
 * "Annuler" undo-toast window before the fetch actually fires, since this
 * has no server-side recovery. Same auth/rate-limit/ownership chain as PATCH
 * above, just a delete instead of an update.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string; taskId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-task-delete:${user.id}`, RATE_LIMITS.mutation);
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

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("study_plan_tasks")
    .delete({ count: "exact" })
    .eq("id", taskId)
    .eq("plan_id", planId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[study-planner/tasks:delete] Échec suppression Supabase:", error);
    return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Tâche introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
