import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { callOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { STUDIO_MODEL } from "@/lib/ai/studio-prompts";
import { buildExamBatchPrompt, type ExamCourseInput } from "@/lib/ai/exam-prompts";
import { ExamGenerationSchema, ExamBatchSchema } from "@/lib/ai/exam-schemas";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage, parseJsonResponse, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
export const maxDuration = 300;

// SEQUENTIAL BATCHING: the 40-question exam used to be requested in ONE call
// (32000 max tokens, relying on the model not stopping early before 40),
// then 4 batches of 10 — which still occasionally truncated (JSON.parse
// failure on a cut-off response) because 8000 tokens for 10 fully-explained
// QCMs, some of which drifted into verbose paragraph-length explanations,
// wasn't always enough. Now 5 batches of 8: smaller per-call output, a
// prompt instruction capping explanations at ~40 words each (the actual
// token-count driver, not just the question count), AND a generous 8192
// max_tokens per batch — for 8 short-explanation QCMs this is enough
// headroom that hitting the ceiling should no longer happen in practice.
const EXAM_BATCH_MAX_TOKENS = 8_192;
const QUESTIONS_PER_BATCH = 8;
const TOTAL_BATCHES = 5;
// 1 initial attempt + 1 retry — bounded so a persistently broken batch fails
// (and refunds) the whole exam rather than looping indefinitely.
const MAX_BATCH_ATTEMPTS = 2;
// Only applied when `variation: true` — forces creative divergence for a
// regenerated exam. Left unset (provider default) for a first generation,
// since a first exam should stay close to the source material, not roam.
const VARIATION_TEMPERATURE = 0.85;

const MAX_PER_COURSE_CHARS = 8_000;
const MAX_TOTAL_EXAM_CHARS = 60_000;

interface EligibleCourseRow {
  id: number;
  title: string;
  explication: string | null;
  raw_text: string;
}

/** Same Explication-preferred, combined-budget-aware per-course cap used by the Workspace synthesis route — see that route's own comment for why. */
function buildCourseInputs(courses: EligibleCourseRow[]): ExamCourseInput[] {
  const perCourseCap = Math.max(500, Math.min(MAX_PER_COURSE_CHARS, Math.floor(MAX_TOTAL_EXAM_CHARS / Math.max(1, courses.length))));
  return courses.map((course) => ({
    title: course.title,
    text: (course.explication ?? course.raw_text).slice(0, perCourseCap),
  }));
}

type ExamQuestion = ReturnType<typeof ExamBatchSchema.parse>["questions"][number];

/**
 * Generates ONE QUESTIONS_PER_BATCH-question batch, retrying THAT batch
 * alone (never the whole exam) up to MAX_BATCH_ATTEMPTS times on a parse/
 * validation failure. Course inputs are resent in full on every batch — the
 * model needs the full source text each time since it has no memory of
 * earlier calls; this is the real cost tradeoff of sequential batching
 * (roughly TOTAL_BATCHES× the course input tokens of the old single-call
 * approach, in exchange for a per-call output small enough to never
 * truncate).
 */
async function generateExamBatch(
  inputs: ExamCourseInput[],
  batchIndex: number,
  isVariation: boolean,
  previousTopics: string[]
): Promise<ExamQuestion[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt++) {
    try {
      const prompt = buildExamBatchPrompt(inputs, batchIndex, TOTAL_BATCHES, QUESTIONS_PER_BATCH, isVariation, previousTopics);
      const raw = await callOpenRouter(
        [
          { role: "system", content: prompt },
          { role: "user", content: `Génère le lot ${batchIndex} sur ${TOTAL_BATCHES} (${QUESTIONS_PER_BATCH} QCMs).` },
        ],
        {
          model: STUDIO_MODEL,
          maxTokens: EXAM_BATCH_MAX_TOKENS,
          bypassMock: true,
          ...(isVariation ? { temperature: VARIATION_TEMPERATURE } : {}),
        }
      );

      const parsed = parseJsonResponse(raw);
      const result = ExamBatchSchema.safeParse(parsed);
      if (!result.success) {
        console.error(`[exam/generate] Lot ${batchIndex}/${TOTAL_BATCHES} invalide (tentative ${attempt}/${MAX_BATCH_ATTEMPTS}):`, result.error.flatten());
        throw new Error(`Le lot ${batchIndex} n'a pas produit exactement ${QUESTIONS_PER_BATCH} QCMs valides.`);
      }
      return result.data.questions;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Le lot ${batchIndex} a échoué après ${MAX_BATCH_ATTEMPTS} tentatives.`);
}

/**
 * GET a student's saved exams for one module — the "Mes Examens" sidebar
 * history. Ordered ascending by created_at so the frontend can label them
 * "Examen 1", "Examen 2"... in the order they were actually generated.
 * Scoped to user_id + curriculum_module_id — this IS the fix for the
 * cross-module leakage bug: there was previously no real per-module fetch
 * at all (the sidebar showed a hardcoded MOCK_COURSES list identically on
 * every module), not a filter that forgot to apply.
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
    .from("module_generated_exams")
    .select("id, selected_courses, content, created_at")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[exam/generate] Échec lecture historique:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    exams: (data ?? []).map((row) => ({
      id: row.id,
      selectedCourses: row.selected_courses,
      content: row.content,
      createdAt: row.created_at,
    })),
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

  const { moduleId, courseIds, variation } = (body ?? {}) as { moduleId?: unknown; courseIds?: unknown; variation?: unknown };

  if (typeof moduleId !== "number" || !Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }
  if (!Array.isArray(courseIds) || courseIds.length === 0 || !courseIds.every((id) => typeof id === "number")) {
    return NextResponse.json({ success: false, error: "'courseIds' est requis (tableau d'identifiants non vide)." }, { status: 400 });
  }
  const isVariation = variation === true;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // Scoped to THIS user AND THIS module — a courseId the student doesn't
  // own, or one that belongs to a different module, is silently excluded.
  const { data: courses, error: coursesError } = await supabase
    .from("studio_courses")
    .select("id, title, explication, raw_text")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .in("id", courseIds)
    .order("id", { ascending: true });

  if (coursesError) {
    console.error("[exam/generate] Échec lecture Supabase:", coursesError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const eligibleCourses = (courses ?? []) as EligibleCourseRow[];
  if (eligibleCourses.length === 0) {
    return NextResponse.json({ success: false, error: "Aucun cours sélectionné trouvé dans ce module." }, { status: 400 });
  }

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  let validated: ReturnType<typeof ExamGenerationSchema.parse>;
  try {
    const inputs = buildCourseInputs(eligibleCourses);

    // SEQUENTIAL BATCHING: 4 calls of 10 questions each, awaited one after
    // another (not in parallel) — each subsequent call is told exactly which
    // weakPointTags the earlier batches already covered, so "logical flow
    // and topic distribution" is enforced for real rather than left to 4
    // independently-guessing calls. The whole exam only ever succeeds as a
    // single atomic unit: if a batch exhausts its own retries, the entire
    // request fails and refunds — no partial exam is ever saved.
    const allQuestions: ExamQuestion[] = [];
    for (let batchIndex = 1; batchIndex <= TOTAL_BATCHES; batchIndex++) {
      const previousTopics = allQuestions.map((q) => q.weakPointTag);
      const batchQuestions = await generateExamBatch(inputs, batchIndex, isVariation, previousTopics);
      allQuestions.push(...batchQuestions);
    }

    const result = ExamGenerationSchema.safeParse({ questions: allQuestions });
    if (!result.success) {
      // Should be unreachable in practice — each batch is already validated
      // to exactly 10 well-formed questions, and 4×10=40 satisfies
      // ExamGenerationSchema's own min(40).max(60). Kept as a final
      // backstop rather than trusting the arithmetic blindly.
      console.error("[exam/generate] Examen final invalide malgré des lots valides:", result.error.flatten());
      throw new Error("L'IA n'a pas produit un examen valide (nombre de questions ou format incorrect). Réessaie.");
    }
    validated = result.data;
  } catch (error) {
    await refundGeneration(user.id);
    if (error instanceof OpenRouterError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error("[exam/generate] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 502 });
  }

  const content = sanitizeForPostgres({
    questions: validated.questions.map((question, index) => ({ id: `q${index + 1}`, ...question })),
  });
  const selectedCourses = eligibleCourses.map((course) => ({ id: course.id, title: course.title }));

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
    // atomic generate-then-save policy.
    await refundGeneration(user.id);
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
  });
}
