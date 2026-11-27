import { BLIDA_UNITS, blidaProgramme, expectedSlots, yearLabel, type BlidaExamUnit, type GenomeSitting } from "@/lib/exam-genome/blida-catalog";
import type { GenomeSession } from "@/lib/exam-genome/scope";

/**
 * EXAM GENOME — Blida Medicine coverage matrix: for every exam unit of years
 * 1-6, every academic year of the window and every expected paper (EMD1/EMD2
 * or the single paper, then the rattrapage), what the bank holds — and, from
 * the gaps, what students and ambassadors should bring first.
 */

export type CellState = "missing" | "questions_only" | "keyed" | "verified" | "not_applicable";

export interface CoveragePaper {
  unitCode: string;
  academicYear: string;
  session: GenomeSession;
  sitting: GenomeSitting;
  status: "needs_review" | "published" | "rejected" | "duplicate" | "taken_down";
  questionCount: number;
  /** Share of the paper's questions with a key of level ≥ 2 (community or better). */
  keyedShare: number;
  /** Share with a key of level ≥ 3 (expert or official). */
  verifiedShare: number;
}

export interface CoverageCell {
  unitCode: string;
  year: number;
  academicYear: string;
  session: GenomeSession;
  sitting: GenomeSitting;
  state: CellState;
  /** Papers held for this slot (clinical rotations can give several), reviewed or not. */
  papers: number;
  pendingReview: number;
}

export interface CoverageGap {
  cell: CoverageCell;
  unitTitle: string;
  priority: number;
  /** What to ask contributors for, in French. */
  ask: string;
}

export interface CoverageReport {
  academicYears: string[];
  cells: CoverageCell[];
  byYear: { year: number; expected: number; covered: number; verified: number; coverage: number }[];
  byUnit: { unitCode: string; year: number; title: string; expected: number; covered: number; verified: number }[];
  gaps: CoverageGap[];
  totals: { expected: number; covered: number; verified: number; pendingReview: number };
}

/** The academic year running on `today` (September opens one) and the `count` completed years before it, most recent first. */
export function completedAcademicYears(today: Date, count = 5): string[] {
  const y = today.getUTCFullYear();
  const currentStart = today.getUTCMonth() >= 8 ? y : y - 1;
  return Array.from({ length: count }, (_, i) => `${currentStart - 1 - i}/${currentStart - i}`);
}

/** Default weights: the first three years have the largest cohorts and the hardest pass rates; recent papers outrank old ones. */
export const YEAR_WEIGHT: Record<number, number> = { 1: 1, 2: 0.95, 3: 0.95, 4: 0.85, 5: 0.85, 6: 0.8 };
const RECENCY = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.25];
const STATE_WEIGHT: Record<CellState, number> = { missing: 1, questions_only: 0.45, keyed: 0.2, verified: 0, not_applicable: 0 };

const SITTING_LABEL: Record<GenomeSitting, string> = { emd1: "EMD 1", emd2: "EMD 2", unique: "épreuve", synthese: "synthèse" };

function cellState(papers: CoveragePaper[]): CellState {
  const usable = papers.filter((p) => p.status === "published" || p.status === "needs_review");
  if (!usable.length) return "missing";
  const best = usable.reduce((a, b) => (b.verifiedShare > a.verifiedShare || (b.verifiedShare === a.verifiedShare && b.keyedShare > a.keyedShare) ? b : a));
  if (best.verifiedShare >= 0.8) return "verified";
  if (best.keyedShare >= 0.5) return "keyed";
  return "questions_only";
}

function askFor(unit: BlidaExamUnit, cell: CoverageCell): string {
  const what = cell.session === "rattrapage" ? "rattrapage" : SITTING_LABEL[cell.sitting];
  const need =
    cell.state === "missing" ? "sujet manquant" : cell.state === "questions_only" ? "sujet présent, corrigé manquant" : "corrigé à faire vérifier";
  return `${yearLabel(unit.year)} — ${unit.title} — ${what} ${cell.academicYear} : ${need}`;
}

export function buildCoverage(papers: CoveragePaper[], academicYears: string[], yearWeight: Record<number, number> = YEAR_WEIGHT): CoverageReport {
  const index = new Map<string, CoveragePaper[]>();
  for (const p of papers) {
    const key = `${p.unitCode}|${p.academicYear}|${p.session}|${p.sitting}`;
    index.set(key, [...(index.get(key) ?? []), p]);
  }
  const cells: CoverageCell[] = [];
  const gaps: CoverageGap[] = [];
  for (const unit of BLIDA_UNITS) {
    const programme = blidaProgramme(unit.year);
    academicYears.forEach((academicYear, recencyRank) => {
      for (const slot of expectedSlots(unit)) {
        const held = index.get(`${unit.code}|${academicYear}|${slot.session}|${slot.sitting}`) ?? [];
        const applicable = !programme || academicYear >= programme.validFrom;
        const cell: CoverageCell = {
          unitCode: unit.code,
          year: unit.year,
          academicYear,
          session: slot.session,
          sitting: slot.sitting,
          state: applicable ? cellState(held) : "not_applicable",
          papers: held.filter((p) => p.status === "published" || p.status === "needs_review").length,
          pendingReview: held.filter((p) => p.status === "needs_review").length,
        };
        cells.push(cell);
        const stateWeight = STATE_WEIGHT[cell.state];
        if (stateWeight > 0) {
          const priority = (yearWeight[unit.year] ?? 0.8) * (RECENCY[recencyRank] ?? 0.2) * (slot.session === "normale" ? 1 : 0.55) * stateWeight;
          gaps.push({ cell, unitTitle: unit.title, priority: Math.round(priority * 1000) / 1000, ask: askFor(unit, cell) });
        }
      }
    });
  }
  gaps.sort((a, b) => b.priority - a.priority || a.cell.year - b.cell.year);

  const relevant = cells.filter((c) => c.state !== "not_applicable");
  const covered = (c: CoverageCell) => c.state !== "missing";
  const byYear = [1, 2, 3, 4, 5, 6].map((year) => {
    const ys = relevant.filter((c) => c.year === year);
    const cov = ys.filter(covered).length;
    return { year, expected: ys.length, covered: cov, verified: ys.filter((c) => c.state === "verified").length, coverage: ys.length ? Math.round((cov / ys.length) * 1000) / 10 : 0 };
  });
  const byUnit = BLIDA_UNITS.map((unit) => {
    const us = relevant.filter((c) => c.unitCode === unit.code);
    return { unitCode: unit.code, year: unit.year, title: unit.title, expected: us.length, covered: us.filter(covered).length, verified: us.filter((c) => c.state === "verified").length };
  });
  return {
    academicYears,
    cells,
    byYear,
    byUnit,
    gaps,
    totals: {
      expected: relevant.length,
      covered: relevant.filter(covered).length,
      verified: relevant.filter((c) => c.state === "verified").length,
      pendingReview: relevant.reduce((s, c) => s + c.pendingReview, 0),
    },
  };
}
