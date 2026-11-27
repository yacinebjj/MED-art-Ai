import { NextRequest, NextResponse } from "next/server";
import { questionPrint } from "@/lib/exam-genome/fingerprint";
import { loadPaperQuestions, raiseDbError, recomputeEffectiveKeys, selectAll } from "@/lib/exam-genome/db";
import { fail, genomeContext, genomeErrorResponse, readJson } from "@/lib/exam-genome/http";
import {
  AnswerSchema,
  GENOME_PROVENANCES,
  GENOME_SESSIONS,
  GENOME_SITTINGS,
  GenomePaperMetaSchema,
  GenomeQuestionSchema,
  isLegacyProgramme,
  maxTrustForSource,
  type GenomeProvenance,
} from "@/lib/exam-genome/scope";
import { GENOME_BUCKET } from "@/lib/exam-genome/storage";
import { isAnswerValidForFormat } from "@/lib/exam-genome/trust";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEW_KEY_SOURCES = ["official_grid", "teacher", "expert_review"] as const;
const ACTIONS = { publish: "published", reject: "rejected", take_down: "taken_down", reopen: "needs_review", duplicate: "duplicate" } as const;

/** EXAM GENOME — one paper for review: its file (signed link), questions, every key claim, item statistics. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await genomeContext({ adminOnly: true });
  if (ctx instanceof NextResponse) return ctx;
  if (!UUID.test(params.id)) return fail(400, "Identifiant invalide.");
  try {
    const { data: paper, error } = await ctx.supabase.from("eg_papers").select("*").eq("id", params.id).maybeSingle();
    if (error) raiseDbError(error, "lecture du sujet");
    if (!paper) return fail(404, "Sujet introuvable.");
    const [{ data: sources }, questions] = await Promise.all([
      ctx.supabase.from("eg_sources").select("storage_path, mime_type, byte_size, page_count, extraction, created_at").eq("paper_id", params.id),
      loadPaperQuestions(ctx.supabase, [params.id]),
    ]);
    const ids = questions.map((q) => q.id);
    const [claims, stats] = ids.length
      ? await Promise.all([
          selectAll<Record<string, unknown>>((from, to) => ctx.supabase.from("eg_answer_keys").select("question_id, answer, level, source, contributor_id, created_at").in("question_id", ids).range(from, to), "lecture des corrigés"),
          selectAll<Record<string, unknown>>((from, to) => ctx.supabase.from("eg_item_stats").select("*").in("question_id", ids).range(from, to), "lecture des statistiques"),
        ])
      : [[], []];
    const files = await Promise.all(
      (sources ?? []).map(async (s: { storage_path: string }) => {
        const { data } = await ctx.supabase.storage.from(GENOME_BUCKET).createSignedUrl(s.storage_path, 600);
        return { ...s, url: data?.signedUrl ?? null };
      })
    );
    return NextResponse.json({ success: true, paper, files, questions, claims, itemStats: stats });
  } catch (error) {
    return genomeErrorResponse(error, "papers/[id]");
  }
}

/**
 * EXAM GENOME — review of one paper (team only), in this order:
 *   meta       corrected metadata, re-validated by the strict scope schema;
 *   questions  corrected questions [{ position, format?, polarity?, context?,
 *              stem?, propositions?, options? }], re-validated, re-fingerprinted;
 *   keys       key claims [{ position, answer, source: official_grid | teacher
 *              | expert_review }] at the trust their source allows — an
 *              official grid is level 4 only on a paper of official provenance;
 *   action     publish | reject | take_down | reopen | duplicate (+ duplicateOf).
 * Publishing needs every question readable, and one published paper per exam slot.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await genomeContext({ adminOnly: true });
  if (ctx instanceof NextResponse) return ctx;
  if (!UUID.test(params.id)) return fail(400, "Identifiant invalide.");
  const body = await readJson(request);
  if (!body) return fail(400, "Corps de requête JSON invalide.");

  try {
    const { data: paper, error } = await ctx.supabase.from("eg_papers").select("*").eq("id", params.id).maybeSingle();
    if (error) raiseDbError(error, "lecture du sujet");
    if (!paper) return fail(404, "Sujet introuvable.");
    const notes: string[] = [];

    // 1. Metadata.
    let provenance: GenomeProvenance = paper.provenance;
    if (body.meta && typeof body.meta === "object") {
      const m = body.meta as Record<string, unknown>;
      const merged = {
        faculty: "blida1_medecine",
        track: "medecine",
        yearLevel: typeof m.unitCode === "string" ? Number(m.unitCode.slice(1, 2)) : paper.year_level,
        unitCode: typeof m.unitCode === "string" ? m.unitCode : paper.unit_code,
        academicYear: typeof m.academicYear === "string" ? m.academicYear : paper.academic_year,
        session: (GENOME_SESSIONS as readonly unknown[]).includes(m.session) ? m.session : paper.session,
        sitting: (GENOME_SITTINGS as readonly unknown[]).includes(m.sitting) ? m.sitting : paper.sitting,
        rotation: m.rotation === null || typeof m.rotation === "number" ? m.rotation : paper.rotation,
        variant: m.variant === null || typeof m.variant === "string" ? m.variant : paper.variant,
        examDate: m.examDate === null || typeof m.examDate === "string" ? m.examDate : paper.exam_date,
        durationMinutes: m.durationMinutes === null || typeof m.durationMinutes === "number" ? m.durationMinutes : paper.duration_minutes,
        provenance: (GENOME_PROVENANCES as readonly unknown[]).includes(m.provenance) ? m.provenance : paper.provenance,
      };
      const parsed = GenomePaperMetaSchema.safeParse(merged);
      if (!parsed.success) return fail(422, parsed.error.issues.map((i) => i.message).join(" "));
      const meta = parsed.data;
      provenance = meta.provenance;
      const { error: updateError } = await ctx.supabase
        .from("eg_papers")
        .update({
          year_level: meta.yearLevel,
          unit_code: meta.unitCode,
          academic_year: meta.academicYear,
          session: meta.session,
          sitting: meta.sitting,
          rotation: meta.rotation,
          variant: meta.variant,
          exam_date: meta.examDate,
          duration_minutes: meta.durationMinutes,
          provenance: meta.provenance,
          legacy_programme: isLegacyProgramme(meta),
        })
        .eq("id", params.id);
      if (updateError) return fail(422, `Métadonnées refusées : ${updateError.message}`);
      notes.push("métadonnées mises à jour");
    }

    // 2. Question corrections.
    let questions = await loadPaperQuestions(ctx.supabase, [params.id]);
    if (Array.isArray(body.questions)) {
      for (const raw of body.questions as Record<string, unknown>[]) {
        const current = questions.find((q) => q.position === raw?.position);
        if (!current) return fail(422, `Question ${String(raw?.position)} introuvable dans ce sujet.`);
        const next = {
          position: current.position,
          format: raw.format ?? current.format,
          polarity: raw.polarity === undefined ? current.polarity : raw.polarity,
          context: raw.context === undefined ? current.context : raw.context,
          stem: raw.stem ?? current.stem,
          propositions: raw.propositions ?? current.propositions,
          options: raw.options ?? current.options,
          parseConfidence: 1,
        };
        const checked = GenomeQuestionSchema.safeParse(next);
        if (!checked.success) return fail(422, checked.error.issues.map((i) => i.message).join(" "));
        const q = checked.data;
        const print = questionPrint(q);
        const { error: qError } = await ctx.supabase
          .from("eg_questions")
          .update({ format: q.format, polarity: q.polarity, context: q.context, stem: q.stem, propositions: q.propositions, options: q.options, norm_text: print.normText, content_hash: print.hash, parse_confidence: 1, parse_issues: [] })
          .eq("id", current.id);
        if (qError) return fail(422, `Question ${q.position} refusée : ${qError.message}`);
      }
      notes.push(`${(body.questions as unknown[]).length} question(s) corrigée(s)`);
      questions = await loadPaperQuestions(ctx.supabase, [params.id]);
    }

    // 3. Key claims.
    if (Array.isArray(body.keys)) {
      const rows = [];
      for (const raw of body.keys as Record<string, unknown>[]) {
        const q = questions.find((x) => x.position === raw?.position);
        const source = REVIEW_KEY_SOURCES.find((s) => s === raw?.source);
        const answer = typeof raw?.answer === "string" ? raw.answer.toUpperCase() : "";
        if (!q || !source || !AnswerSchema.safeParse(answer).success || !isAnswerValidForFormat(answer, q.format, q.options.length)) {
          return fail(422, `Corrigé refusé pour la question ${String(raw?.position)} : réponse, source ou format invalide.`);
        }
        rows.push({ question_id: q.id, answer, level: maxTrustForSource(source, provenance), source, contributor_id: ctx.user.id });
      }
      if (rows.length) {
        const { error: keyError } = await ctx.supabase.from("eg_answer_keys").upsert(rows, { onConflict: "question_id,source,contributor_id" });
        if (keyError) return fail(422, `Corrigé refusé : ${keyError.message}`);
        await recomputeEffectiveKeys(ctx.supabase, rows.map((r) => r.question_id));
        notes.push(`${rows.length} corrigé(s) enregistré(s)`);
      }
    }

    // 4. Status.
    const action = typeof body.action === "string" && body.action in ACTIONS ? (body.action as keyof typeof ACTIONS) : null;
    if (action) {
      if (action === "publish") {
        // Questions the parser could only keep as "à relire" (lib/exam-genome/ingest.ts) must be corrected first.
        const unreadable = questions.filter((q) => (q.parse_issues ?? []).some((issue) => issue.startsWith("à relire")));
        if (unreadable.length) return fail(422, `Avant publication, corrige les questions illisibles : ${unreadable.map((q) => q.position).join(", ")}.`);
      }
      const duplicateOf = action === "duplicate" && typeof body.duplicateOf === "string" && UUID.test(body.duplicateOf) ? body.duplicateOf : null;
      if (action === "duplicate" && !duplicateOf) return fail(400, "'duplicateOf' est requis pour classer un doublon.");
      const { error: statusError } = await ctx.supabase
        .from("eg_papers")
        .update({ status: ACTIONS[action], duplicate_of: duplicateOf, reviewed_by: ctx.user.id, reviewed_at: new Date().toISOString() })
        .eq("id", params.id);
      if (statusError) {
        if (statusError.code === "23505") return fail(409, "Un sujet est déjà publié pour cette épreuve (même unité, année, session, épreuve, rotation et variante).");
        return fail(422, `Statut refusé : ${statusError.message}`);
      }
      notes.push(`statut : ${ACTIONS[action]}`);
    }

    return NextResponse.json({ success: true, done: notes });
  } catch (error) {
    return genomeErrorResponse(error, "papers/[id] review");
  }
}
