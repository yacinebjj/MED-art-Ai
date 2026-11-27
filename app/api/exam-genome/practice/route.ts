import { NextRequest, NextResponse } from "next/server";
import { getBlidaUnit, yearLabel } from "@/lib/exam-genome/blida-catalog";
import { assemblePracticeExam, blueprintToStyleProfile, computeBlueprint, type PracticeCandidate } from "@/lib/exam-genome/blueprint";
import { loadPaperQuestions, loadUnitPapers, raiseDbError, type StoredPaperRow } from "@/lib/exam-genome/db";
import { fail, genomeContext, genomeErrorResponse, readJson } from "@/lib/exam-genome/http";
import { TRUST_LEVELS, type TrustLevel } from "@/lib/exam-genome/scope";
import { sealStyleProfile } from "@/lib/exam-style-seal";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * EXAM GENOME — Blida-style practice for one exam unit (years 1-6).
 *
 *   mode "real" (default): a paper assembled from the unit's real, published
 *   questions — in the unit's format mix and length, one question per family
 *   (a question asked again in another year counts once, recurring ones
 *   first), only keys of trust ≥ community and never a contested key. The
 *   answers stay on the server until POST /api/exam-genome/practice/submit.
 *
 *   mode "style": the unit's blueprint as a sealed ExamStyleProfile, for the
 *   existing generator (POST /api/exam/run with the student's own courses):
 *   new questions written the way Blida writes this unit's papers.
 *
 * Body: { unitCode, mode?, count? (10-120), seed? }
 */
export async function POST(request: NextRequest) {
  const ctx = await genomeContext();
  if (ctx instanceof NextResponse) return ctx;
  const rl = rateLimit(`exam-genome-practice:${ctx.user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) return NextResponse.json({ success: false, error: "Trop de requêtes — réessaie dans quelques minutes." }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });

  const body = await readJson(request);
  if (!body) return fail(400, "Corps de requête JSON invalide.");
  const unit = typeof body.unitCode === "string" ? getBlidaUnit(body.unitCode) : undefined;
  if (!unit) return fail(400, "'unitCode' doit être une unité du programme de Médecine de Blida (ex. Y3-UEI1).");
  const mode = body.mode === "style" ? "style" : "real";
  const count = typeof body.count === "number" && Number.isInteger(body.count) ? Math.min(120, Math.max(10, body.count)) : undefined;
  const seed = typeof body.seed === "number" && Number.isFinite(body.seed) ? Math.floor(body.seed) : Math.floor(Math.random() * 2 ** 31);

  try {
    // Style is learnt from every in-scope paper of the unit; real practice only uses published ones.
    const papers = await loadUnitPapers(ctx.supabase, unit.code, mode === "style" ? ["published", "needs_review"] : ["published"]);
    if (!papers.length) {
      return fail(404, `Aucun sujet ${mode === "style" ? "" : "publié "}pour « ${unit.title} » (${yearLabel(unit.year)}) pour l'instant. Tu as un ancien sujet ? Envoie-le : il aidera toute ta promo.`, { contribute: true });
    }
    const questions = await loadPaperQuestions(ctx.supabase, papers.map((p) => p.id));
    const blueprint = computeBlueprint(
      unit.code,
      papers.map((p) => ({ questionCount: p.question_count, durationMinutes: p.duration_minutes })),
      questions.map((q) => ({ format: q.format, polarity: q.polarity, optionCount: q.options.length, stem: q.stem }))
    );

    if (mode === "style") {
      const styleProfile = blueprintToStyleProfile(unit, blueprint);
      return NextResponse.json({ success: true, mode, unit: { code: unit.code, title: unit.title, year: unit.year }, blueprint, styleProfile, styleProfileSeal: sealStyleProfile(ctx.user.id, styleProfile) });
    }

    const paperById = new Map<string, StoredPaperRow>(papers.map((p) => [p.id, p]));
    const familyPapers = new Map<string, Set<string>>();
    for (const q of questions) {
      const family = q.family_id ?? q.id;
      familyPapers.set(family, (familyPapers.get(family) ?? new Set()).add(q.paper_id));
    }
    const candidates: PracticeCandidate[] = questions.map((q) => ({
      id: q.id,
      paperId: q.paper_id,
      academicYear: paperById.get(q.paper_id)?.academic_year ?? "",
      format: q.format,
      familyId: q.family_id,
      familySize: familyPapers.get(q.family_id ?? q.id)?.size ?? 1,
      keyLevel: q.effective_level as TrustLevel,
      keyContested: q.key_contested,
    }));
    const practice = assemblePracticeExam(candidates, blueprint, { count, seed, minKeyLevel: TRUST_LEVELS.community });
    if (!practice.questionIds.length) {
      return fail(404, `Les sujets de « ${unit.title} » n'ont pas encore de corrigé vérifié (≥ niveau communauté). Ils seront disponibles dès leur relecture.`);
    }

    const { data: attempt, error } = await ctx.supabase.from("eg_practice_attempts").insert({ user_id: ctx.user.id, unit_code: unit.code, question_ids: practice.questionIds }).select("id").single();
    if (error || !attempt) {
      if (error) raiseDbError(error, "création de l'entraînement");
      throw new Error("création de l'entraînement : réponse vide");
    }

    const byId = new Map(questions.map((q) => [q.id, q]));
    const minutesPerQuestion = blueprint.medianDurationMinutes && blueprint.medianQuestionsPerPaper ? blueprint.medianDurationMinutes / blueprint.medianQuestionsPerPaper : null;
    return NextResponse.json({
      success: true,
      mode,
      attemptId: attempt.id,
      seed,
      unit: { code: unit.code, title: unit.title, year: unit.year },
      // The real papers' pace, for this paper's length.
      durationMinutes: minutesPerQuestion ? Math.round(minutesPerQuestion * practice.questionIds.length) : null,
      composition: practice.composition,
      shortfall: practice.shortfall,
      questions: practice.questionIds.map((id, index) => {
        const q = byId.get(id)!;
        const paper = paperById.get(q.paper_id);
        return {
          id,
          number: index + 1,
          format: q.format,
          polarity: q.polarity,
          context: q.context,
          stem: q.stem,
          propositions: q.propositions,
          options: q.options,
          keyLevel: q.effective_level,
          source: paper ? { academicYear: paper.academic_year, session: paper.session, sitting: paper.sitting } : null,
        };
      }),
    });
  } catch (error) {
    return genomeErrorResponse(error, "practice");
  }
}
