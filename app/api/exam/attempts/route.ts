import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { scoreExamAttempt, type ExamQuestion } from "@/lib/exam-scoring";

export const runtime = "nodejs";

interface ExamRow {
  id: string;
  curriculum_module_id: number;
  content: { questions: ExamQuestion[] } | null;
}

interface ExamAttemptRow {
  id: string;
  exam_id: string;
  answers: Record<string, string | null>;
  score: number;
  total_questions: number;
  created_at: string;
}

function toAttempt(row: ExamAttemptRow) {
  return {
    id: row.id,
    examId: row.exam_id,
    answers: row.answers,
    score: row.score,
    totalQuestions: row.total_questions,
    createdAt: row.created_at,
  };
}

/**
 * GET ?moduleId=... — every saved attempt for this student's exams in one
 * module, oldest first (mirrors GET /api/exam/generate's own ordering). The
 * exam page takes the LAST attempt per examId to resume "did I already
 * answer this, and how" when reopening a saved exam.
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
  const { data, error } = await supabase
    .from("user_exam_attempts")
    .select("id, exam_id, answers, score, total_questions, created_at")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[exam/attempts GET] Échec lecture:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, attempts: (data ?? []).map((row) => toAttempt(row as ExamAttemptRow)) });
}

/**
 * POST — persists one completed attempt at an already-generated exam. Body:
 * { examId: string, answers: Record<string, string | null> }. Score and the
 * wrong-question list are ALWAYS recomputed server-side from the exam's own
 * canonical content (scoreExamAttempt) — a client-supplied score is never
 * trusted, same principle as every other graded/billed action in this app.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`exam-attempts:${user.id}`, RATE_LIMITS.mutation);
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

  const { examId, answers } = (body ?? {}) as { examId?: unknown; answers?: unknown };
  if (typeof examId !== "string" || !examId.trim()) {
    return NextResponse.json({ success: false, error: "'examId' est requis." }, { status: 400 });
  }
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return NextResponse.json({ success: false, error: "'answers' est requis (objet questionId -> option)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }
  const supabase = getSupabaseAdmin();

  // Ownership check — .eq("user_id", user.id) is what stops one student from
  // saving an "attempt" against another student's generated exam by
  // guessing its id.
  const { data: examRow, error: examError } = await supabase
    .from("module_generated_exams")
    .select("id, curriculum_module_id, content")
    .eq("id", examId)
    .eq("user_id", user.id)
    .maybeSingle<ExamRow>();

  if (examError) {
    console.error("[exam/attempts POST] Échec lecture examen:", examError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${examError.message}` }, { status: 500 });
  }
  if (!examRow) {
    return NextResponse.json({ success: false, error: "Examen introuvable." }, { status: 404 });
  }

  const questions = examRow.content?.questions ?? [];
  const { score, totalQuestions, wrongQuestions } = scoreExamAttempt(questions, answers as Record<string, string | null>);

  const { data: inserted, error: insertError } = await supabase
    .from("user_exam_attempts")
    .insert({
      user_id: user.id,
      curriculum_module_id: examRow.curriculum_module_id,
      exam_id: examRow.id,
      answers,
      score,
      total_questions: totalQuestions,
      wrong_questions: wrongQuestions,
    })
    .select("id, exam_id, answers, score, total_questions, created_at")
    .single();

  if (insertError || !inserted) {
    console.error("[exam/attempts POST] Échec sauvegarde:", insertError);
    return NextResponse.json({ success: false, error: "La sauvegarde de la tentative a échoué." }, { status: 500 });
  }

  return NextResponse.json({ success: true, attempt: toAttempt(inserted as ExamAttemptRow) });
}
