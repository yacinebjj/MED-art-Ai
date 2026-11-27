import type { getSupabaseAdmin } from "@/lib/supabase/server";
import type { GenomeFormat, KeySource, TrustLevel } from "@/lib/exam-genome/scope";
import { resolveEffectiveKey, type KeyClaim } from "@/lib/exam-genome/trust";

/**
 * EXAM GENOME — data access shared by the app/api/exam-genome routes
 * (service role; tables of supabase/migrations/20261127_exam_genome_blida.sql).
 */

export type Admin = ReturnType<typeof getSupabaseAdmin>;

/** The migration has not been run: the Exam Genome routes answer 503, nothing else in the app is affected. */
export class GenomeUnavailableError extends Error {
  constructor() {
    super("La banque d'examens n'est pas encore activée sur ce serveur (migration 20261127_exam_genome_blida.sql non appliquée).");
  }
}

export function isMissingGenomeSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return ["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code ?? "") || /does not exist|could not find the (?:table|function)|schema cache/i.test(error.message ?? "");
}

/** Throws GenomeUnavailableError for a missing table/function, the error itself otherwise. */
export function raiseDbError(error: { code?: string; message?: string }, context: string): never {
  if (isMissingGenomeSchema(error)) throw new GenomeUnavailableError();
  throw new Error(`[exam-genome] ${context} : ${error.message ?? "erreur inconnue"}`);
}

const PAGE = 1000;

/** Every row of a query, page by page (PostgREST returns at most 1 000 rows per request). */
export async function selectAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>, context: string, max = 20_000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) raiseDbError(error, context);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** `.in()` with a long list is cut in chunks: a URL has a length limit. */
export function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface StoredQuestionRow {
  id: string;
  paper_id: string;
  position: number;
  format: GenomeFormat;
  polarity: "rj" | "rf" | null;
  context: string | null;
  stem: string;
  propositions: string[];
  options: { label: string; text: string }[];
  family_id: string | null;
  effective_answer: string | null;
  effective_level: number;
  key_contested: boolean;
  parse_issues: string[];
}

export interface StoredPaperRow {
  id: string;
  unit_code: string;
  year_level: number;
  academic_year: string;
  session: "normale" | "rattrapage";
  sitting: "emd1" | "emd2" | "unique" | "synthese";
  rotation: number | null;
  variant: string | null;
  status: "needs_review" | "published" | "rejected" | "duplicate" | "taken_down";
  provenance: string;
  question_count: number;
  duration_minutes: number | null;
}

const PAPER_COLUMNS = "id, unit_code, year_level, academic_year, session, sitting, rotation, variant, status, provenance, question_count, duration_minutes";
const QUESTION_COLUMNS = "id, paper_id, position, format, polarity, context, stem, propositions, options, family_id, effective_answer, effective_level, key_contested, parse_issues";

export async function loadUnitPapers(supabase: Admin, unitCode: string, statuses: StoredPaperRow["status"][]): Promise<StoredPaperRow[]> {
  return selectAll<StoredPaperRow>(
    (from, to) => supabase.from("eg_papers").select(PAPER_COLUMNS).eq("unit_code", unitCode).in("status", statuses).order("created_at").range(from, to),
    "lecture des sujets de l'unité"
  );
}

export async function loadPaperQuestions(supabase: Admin, paperIds: string[]): Promise<StoredQuestionRow[]> {
  const rows: StoredQuestionRow[] = [];
  for (const ids of chunks(paperIds)) {
    rows.push(
      ...(await selectAll<StoredQuestionRow>(
        (from, to) => supabase.from("eg_questions").select(QUESTION_COLUMNS).in("paper_id", ids).order("paper_id").order("position").range(from, to),
        "lecture des questions"
      ))
    );
  }
  return rows;
}

/**
 * Re-resolves the shown key of these questions from all their claims
 * (lib/exam-genome/trust.ts) and stores it on eg_questions. Returns how many
 * questions changed.
 */
export async function recomputeEffectiveKeys(supabase: Admin, questionIds: string[]): Promise<number> {
  let changed = 0;
  for (const ids of chunks(questionIds)) {
    const claims = await selectAll<{ question_id: string; answer: string; level: TrustLevel; source: KeySource; contributor_id: string | null }>(
      (from, to) => supabase.from("eg_answer_keys").select("question_id, answer, level, source, contributor_id").in("question_id", ids).range(from, to),
      "lecture des corrigés"
    );
    const byQuestion = new Map<string, KeyClaim[]>();
    for (const c of claims) byQuestion.set(c.question_id, [...(byQuestion.get(c.question_id) ?? []), { answer: c.answer, level: c.level, source: c.source, contributorId: c.contributor_id }]);
    for (const id of ids) {
      const key = resolveEffectiveKey(byQuestion.get(id) ?? []);
      const { error } = await supabase
        .from("eg_questions")
        .update({ effective_answer: key.answer, effective_level: key.answer ? key.level : 0, key_contested: key.contested })
        .eq("id", id);
      if (error) raiseDbError(error, "mise à jour du corrigé");
      changed += 1;
    }
  }
  return changed;
}
