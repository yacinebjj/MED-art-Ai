import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { chunks, raiseDbError, selectAll, type Admin } from "@/lib/exam-genome/db";
import { fail, genomeContext, genomeErrorResponse, readJson } from "@/lib/exam-genome/http";
import { AnswerSchema } from "@/lib/exam-genome/scope";
import { itemAnalysis, type ItemResponse } from "@/lib/exam-genome/trust";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** Item statistics are refreshed from at most this many recent submitted attempts per question. */
const ITEM_STATS_WINDOW = 2000;

/**
 * EXAM GENOME — scores a Blida-style practice paper (POST
 * /api/exam-genome/practice) and reveals its keys, each with its trust
 * level. A question is right when the letters given are exactly the key
 * (QCM: all and only the right propositions — all-or-nothing; Blida's own
 * partial-credit rule, if any, is not encoded yet). The
 * answers then feed each question's item analysis: when the strongest
 * students consistently reject the key, it is flagged for expert review.
 *
 * Body: { attemptId, answers: { [questionId]: "BD" } }
 */
export async function POST(request: NextRequest) {
  const ctx = await genomeContext();
  if (ctx instanceof NextResponse) return ctx;
  const rl = rateLimit(`exam-genome-submit:${ctx.user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop de requêtes — réessaie dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });

  const body = await readJson(request);
  if (!body || typeof body.attemptId !== "string") return fail(400, "'attemptId' est requis.");
  const rawAnswers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? (body.answers as Record<string, unknown>) : null;
  if (!rawAnswers) return fail(400, "'answers' est requis (objet question → lettres).");

  try {
    const { data: attempt, error } = await ctx.supabase.from("eg_practice_attempts").select("id, user_id, question_ids, submitted_at").eq("id", body.attemptId).maybeSingle();
    if (error) raiseDbError(error, "lecture de l'entraînement");
    if (!attempt || attempt.user_id !== ctx.user.id) return fail(404, "Entraînement introuvable.");
    if (attempt.submitted_at) return fail(409, "Cet entraînement a déjà été corrigé.");

    const questionIds: string[] = attempt.question_ids;
    const answers: Record<string, string> = {};
    for (const id of questionIds) {
      const given = rawAnswers[id];
      if (typeof given !== "string" || !given) continue;
      const letters = Array.from(new Set(given.toUpperCase().replace(/[^A-E]/g, "").split(""))).sort().join("");
      if (AnswerSchema.safeParse(letters).success) answers[id] = letters;
    }

    const keys = await selectAll<{ id: string; effective_answer: string | null; effective_level: number; key_contested: boolean }>(
      (from, to) => ctx.supabase.from("eg_questions").select("id, effective_answer, effective_level, key_contested").in("id", questionIds).range(from, to),
      "lecture des corrigés"
    );
    const keyById = new Map(keys.map((k) => [k.id, k]));
    const results = questionIds.map((id) => {
      const key = keyById.get(id);
      const given = answers[id] ?? null;
      return { questionId: id, given, key: key?.effective_answer ?? null, keyLevel: key?.effective_level ?? 0, keyContested: key?.key_contested ?? false, correct: Boolean(given && key?.effective_answer && given === key.effective_answer) };
    });
    const score = results.length ? results.filter((r) => r.correct).length / results.length : 0;

    // Only the first submission counts (a second one finds submitted_at set and changes nothing).
    const { data: saved, error: saveError } = await ctx.supabase
      .from("eg_practice_attempts")
      .update({ answers, score, submitted_at: new Date().toISOString() })
      .eq("id", attempt.id)
      .is("submitted_at", null)
      .select("id");
    if (saveError) raiseDbError(saveError, "enregistrement des réponses");
    if (!saved?.length) return fail(409, "Cet entraînement a déjà été corrigé.");

    waitUntil(refreshItemStats(ctx.supabase, Object.keys(answers)).catch((e) => console.warn("[exam-genome/submit] Statistiques non mises à jour :", e instanceof Error ? e.message : e)));
    return NextResponse.json({ success: true, score: Math.round(score * 1000) / 10, correct: results.filter((r) => r.correct).length, total: results.length, results });
  } catch (error) {
    return genomeErrorResponse(error, "practice/submit");
  }
}

/** Recomputes the item analysis of these questions from the recent submitted attempts that contain them. */
async function refreshItemStats(supabase: Admin, questionIds: string[]): Promise<void> {
  for (const ids of chunks(questionIds, 20)) {
    for (const id of ids) {
      const attempts = await selectAll<{ answers: Record<string, string>; score: number | null }>(
        (from, to) =>
          supabase.from("eg_practice_attempts").select("answers, score").contains("question_ids", [id]).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).range(from, to),
        "lecture des réponses",
        ITEM_STATS_WINDOW
      );
      const { data: question } = await supabase.from("eg_questions").select("effective_answer").eq("id", id).maybeSingle();
      if (!question?.effective_answer) continue;
      const responses: ItemResponse[] = attempts.filter((a) => a.answers?.[id] && a.score !== null).map((a) => ({ answer: a.answers[id], paperScore: a.score as number }));
      const stats = itemAnalysis(question.effective_answer, responses);
      await supabase.from("eg_item_stats").upsert({
        question_id: id,
        responses: stats.n,
        p_value: stats.pValue,
        discrimination: stats.discrimination,
        strong_alternative: stats.strongAlternative,
        suspected_key_error: stats.suspectedKeyError,
        updated_at: new Date().toISOString(),
      });
    }
  }
}
