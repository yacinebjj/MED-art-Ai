import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { GeneratedPlanDay, StudyPlan, StudyPlanChatMessage, StudyPlanTask } from "@/types/study-planner";

export const runtime = "nodejs";

interface StudyPlanRow {
  id: number;
  module_ids: number[];
  hours_per_day: number;
  rest_days: number;
  exam_date: string;
  status: StudyPlan["status"];
  generated_plan: GeneratedPlanDay[] | null;
  refinement_chat: StudyPlanChatMessage[];
  source_file_url: string | null;
  created_at: string;
}

interface StudyPlanTaskRow {
  id: number;
  plan_id: number;
  module_id: number | null;
  title: string;
  date_scheduled: string;
  hours: number | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
}

const PLAN_COLUMNS = "id, module_ids, hours_per_day, rest_days, exam_date, status, generated_plan, refinement_chat, source_file_url, created_at";
const TASK_COLUMNS = "id, plan_id, module_id, title, date_scheduled, hours, is_completed, completed_at, sort_order";

function toPlan(row: StudyPlanRow): StudyPlan {
  return {
    id: row.id,
    moduleIds: row.module_ids ?? [],
    hoursPerDay: row.hours_per_day,
    restDays: row.rest_days,
    examDate: row.exam_date,
    status: row.status,
    generatedPlan: row.generated_plan,
    refinementChat: row.refinement_chat ?? [],
    sourceFileUrl: row.source_file_url,
    createdAt: row.created_at,
  };
}

function toTask(row: StudyPlanTaskRow): StudyPlanTask {
  return {
    id: row.id,
    planId: row.plan_id,
    moduleId: row.module_id,
    title: row.title,
    dateScheduled: row.date_scheduled,
    hours: row.hours,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
    sortOrder: row.sort_order,
  };
}

function parsePlanId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

/** GET — one plan plus its exploded to-do tasks (empty until the plan is 'active'). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const id = parsePlanId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de plan invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: planRow, error: planError } = await supabase
    .from("study_plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (planError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${planError.message}` }, { status: 500 });
  }
  if (!planRow) {
    return NextResponse.json({ success: false, error: "Plan introuvable." }, { status: 404 });
  }

  const { data: taskRows, error: tasksError } = await supabase
    .from("study_plan_tasks")
    .select(TASK_COLUMNS)
    .eq("plan_id", id)
    .eq("user_id", user.id)
    .order("date_scheduled", { ascending: true })
    .order("sort_order", { ascending: true });

  if (tasksError) {
    return NextResponse.json({ success: false, error: `Lecture des tâches échouée : ${tasksError.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    plan: toPlan(planRow as StudyPlanRow),
    tasks: ((taskRows ?? []) as StudyPlanTaskRow[]).map(toTask),
  });
}

/**
 * PATCH — updates a draft/active plan. Body (all optional, at least one required):
 * { generatedPlan?, refinementChat?, status? }.
 * Transitioning `status` to "active" is the "START" action — it explodes
 * `generatedPlan` (already-saved or included in this same call) into real
 * `study_plan_tasks` rows, exactly once (a second Start on an already-active
 * plan is a no-op on the tasks, never a duplicate batch).
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-update:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const id = parsePlanId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de plan invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { generatedPlan, refinementChat, status } = (body ?? {}) as {
    generatedPlan?: unknown;
    refinementChat?: unknown;
    status?: unknown;
  };

  if (generatedPlan === undefined && refinementChat === undefined && status === undefined) {
    return NextResponse.json({ success: false, error: "Aucun champ à mettre à jour." }, { status: 400 });
  }
  if (status !== undefined && !["draft", "active", "completed"].includes(status as string)) {
    return NextResponse.json({ success: false, error: "'status' invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (generatedPlan !== undefined) updates.generated_plan = sanitizeForPostgres(generatedPlan);
  if (refinementChat !== undefined) updates.refinement_chat = sanitizeForPostgres(refinementChat);
  if (status !== undefined) updates.status = status;

  const { data: updated, error: updateError } = await supabase
    .from("study_plans")
    .update(updates, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id)
    .select(PLAN_COLUMNS)
    .maybeSingle();

  if (updateError) {
    console.error("[study-planner/plans/[id]:update] Échec update Supabase:", updateError);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${updateError.message}` }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ success: false, error: "Plan introuvable." }, { status: 404 });
  }

  const plan = toPlan(updated as StudyPlanRow);

  // "Start" — explode generatedPlan into real, checkable tasks. Guarded by a
  // count check so re-sending status:"active" (a retried request, a second
  // tab) never inserts a duplicate batch.
  if (status === "active" && plan.generatedPlan) {
    const { count: existingCount, error: countError } = await supabase
      .from("study_plan_tasks")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", id)
      .eq("user_id", user.id);

    if (countError) {
      console.error("[study-planner/plans/[id]:start] Échec vérification tâches existantes:", countError);
      return NextResponse.json({ success: false, error: "Impossible de vérifier l'état des tâches." }, { status: 500 });
    }

    if (!existingCount) {
      const rows = plan.generatedPlan.flatMap((day, dayIndex) =>
        day.items.map((item, itemIndex) => ({
          plan_id: id,
          user_id: user.id,
          module_id: item.moduleId,
          title: sanitizeForPostgres(item.title),
          date_scheduled: day.date,
          hours: item.hours,
          sort_order: dayIndex * 1000 + itemIndex,
        }))
      );

      const { error: insertTasksError } = await supabase.from("study_plan_tasks").insert(rows);
      if (insertTasksError) {
        console.error("[study-planner/plans/[id]:start] Échec insertion des tâches:", insertTasksError);
        return NextResponse.json({ success: false, error: "Le plan a été activé mais ses tâches n'ont pas pu être créées. Réessaie." }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ success: true, plan });
}

/** DELETE — abandons a plan (and, via ON DELETE CASCADE, its tasks). */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const id = parsePlanId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant de plan invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase.from("study_plans").delete({ count: "exact" }).eq("id", id).eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Plan introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
