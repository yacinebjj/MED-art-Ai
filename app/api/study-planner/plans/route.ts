import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { StudyPlan, CreateStudyPlanInput } from "@/types/study-planner";

export const runtime = "nodejs";

interface StudyPlanRow {
  id: number;
  module_ids: number[];
  hours_per_day: number;
  rest_days: number;
  exam_date: string;
  status: StudyPlan["status"];
  generated_plan: StudyPlan["generatedPlan"];
  refinement_chat: StudyPlan["refinementChat"];
  source_file_url: string | null;
  created_at: string;
}

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

const PLAN_COLUMNS = "id, module_ids, hours_per_day, rest_days, exam_date, status, generated_plan, refinement_chat, source_file_url, created_at";

/** GET — every plan for the student, newest first (the todo page resumes the most recent non-completed one). */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("study_plans")
    .select(PLAN_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[study-planner/plans:list] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, plans: ((data ?? []) as StudyPlanRow[]).map(toPlan) });
}

/** POST — creates a new draft plan from the wizard's Étape 2 config. Body: CreateStudyPlanInput. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`study-planner-create:${user.id}`, RATE_LIMITS.mutation);
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

  const input = (body ?? {}) as Partial<CreateStudyPlanInput>;
  const { moduleIds, hoursPerDay, restDays, examDate, sourceFileUrl } = input;

  if (!Array.isArray(moduleIds) || moduleIds.length === 0 || !moduleIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'moduleIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  if (typeof hoursPerDay !== "number" || !Number.isFinite(hoursPerDay) || hoursPerDay <= 0 || hoursPerDay > 16) {
    return NextResponse.json({ success: false, error: "'hoursPerDay' doit être un nombre entre 0 et 16." }, { status: 400 });
  }
  if (typeof restDays !== "number" || !Number.isInteger(restDays) || restDays < 0 || restDays > 6) {
    return NextResponse.json({ success: false, error: "'restDays' doit être un nombre entier entre 0 et 6." }, { status: 400 });
  }
  if (typeof examDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    return NextResponse.json({ success: false, error: "'examDate' est requis (format AAAA-MM-JJ)." }, { status: 400 });
  }
  if (new Date(examDate).getTime() <= Date.now()) {
    return NextResponse.json({ success: false, error: "La date de l'examen doit être dans le futur." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("study_plans")
    .insert({
      user_id: user.id,
      module_ids: moduleIds,
      hours_per_day: hoursPerDay,
      rest_days: restDays,
      exam_date: examDate,
      source_file_url: typeof sourceFileUrl === "string" ? sourceFileUrl : null,
    })
    .select(PLAN_COLUMNS)
    .single();

  if (error || !data) {
    // SECURITY: was echoing the raw Postgres/PostgREST error message + SQLSTATE
    // code straight to the client (missing table/column if a schema.sql
    // migration was never run live, a bad foreign key on moduleIds, a check
    // constraint, etc.) — internal schema details any authenticated student
    // could trigger and see. Full detail (code + message + hint) still goes
    // to the server console, where it's actually needed for diagnosis.
    console.error("[study-planner/plans:create] Échec insertion Supabase:", error);
    return NextResponse.json({ success: false, error: "La création du plan a échoué. Réessaie." }, { status: 500 });
  }

  return NextResponse.json({ success: true, plan: toPlan(data as StudyPlanRow) });
}
