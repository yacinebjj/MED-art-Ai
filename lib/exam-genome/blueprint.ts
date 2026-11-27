import { ExamStyleProfileSchema, type ExamStyleProfile } from "@/lib/ai/exam-schemas";
import { splitByShares, type FormatCounts } from "@/lib/exam-formats";
import { yearLabel, type BlidaExamUnit } from "@/lib/exam-genome/blida-catalog";
import { TRUST_LEVELS, type GenomeFormat, type TrustLevel } from "@/lib/exam-genome/scope";

/**
 * EXAM GENOME — Blida-style practice. From the real papers of one exam unit:
 *  - the unit's BLUEPRINT (length, duration, format mix, RF share, options),
 *    turned into the ExamStyleProfile the existing generator already takes
 *    (POST /api/exam/generate's `styleProfile`): new questions written the
 *    way Blida writes this unit's papers;
 *  - a PRACTICE EXAM assembled from the real questions themselves, in the
 *    unit's format mix, one question per family (a question asked again in
 *    another year counts once), keys of trust ≥ community by default.
 */

export interface BlueprintQuestion {
  format: GenomeFormat;
  polarity: "rj" | "rf" | null;
  optionCount: number;
  stem: string;
}

export interface BlidaBlueprint {
  unitCode: string;
  papers: number;
  questions: number;
  medianQuestionsPerPaper: number | null;
  medianDurationMinutes: number | null;
  formatShares: Record<"qcs" | "qcm" | "combinaison" | "qroc", number>;
  rfShare: number;
  usualOptionCount: 4 | 5;
  medianStemWords: number;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computeBlueprint(unitCode: string, papers: { questionCount: number; durationMinutes: number | null }[], questions: BlueprintQuestion[]): BlidaBlueprint {
  const n = questions.length || 1;
  const share = (format: GenomeFormat) => Math.round((questions.filter((q) => q.format === format).length / n) * 100) / 100;
  const choice = questions.filter((q) => q.format !== "qroc");
  const fourOptions = choice.filter((q) => q.optionCount === 4).length;
  return {
    unitCode,
    papers: papers.length,
    questions: questions.length,
    medianQuestionsPerPaper: median(papers.map((p) => p.questionCount).filter((c) => c > 0)),
    medianDurationMinutes: median(papers.map((p) => p.durationMinutes ?? 0).filter((d) => d > 0)),
    formatShares: { qcs: share("qcs"), qcm: share("qcm"), combinaison: share("combinaison"), qroc: share("qroc") },
    rfShare: choice.length ? Math.round((choice.filter((q) => q.polarity === "rf").length / choice.length) * 100) / 100 : 0,
    usualOptionCount: fourOptions > choice.length / 2 ? 4 : 5,
    medianStemWords: median(questions.map((q) => q.stem.split(/\s+/).filter(Boolean).length)) ?? 0,
  };
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** The blueprint as the generator's style contract — validated by its own schema. */
export function blueprintToStyleProfile(unit: BlidaExamUnit, bp: BlidaBlueprint): ExamStyleProfile {
  const f = bp.formatShares;
  const length = bp.medianQuestionsPerPaper ? `${bp.medianQuestionsPerPaper} questions` : "Questions";
  const duration = bp.medianDurationMinutes ? ` en ${bp.medianDurationMinutes} minutes` : "";
  const traps: string[] = [];
  if (bp.rfShare >= 0.15) traps.push(`Environ ${pct(bp.rfShare)} des questions en réponse fausse (RF) : repérer la proposition inexacte au milieu de propositions exactes.`);
  if (f.combinaison > 0) traps.push("Combinaisons de type K : une proposition de trop ou de moins rend la combinaison fausse.");
  if (f.qcm > 0) traps.push("QCM à réponses multiples : chaque proposition se juge seule, sans nombre de réponses imposé.");
  traps.push(`Énoncés courts et factuels (${bp.medianStemWords} mots en moyenne) tirés du programme officiel de ${yearLabel(unit.year)}.`);
  const profile = {
    questionTypeDistribution: `${length}${duration} : ${pct(f.qcs)} QCS (une seule réponse), ${pct(f.qcm)} QCM (plusieurs réponses), ${pct(f.combinaison)} combinaisons de type K, ${pct(f.qroc)} questions rédactionnelles ; ${pct(bp.rfShare)} en réponse fausse.`,
    trapPatterns: traps.slice(0, 8),
    optionFormatConventions: `${bp.usualOptionCount} propositions (${bp.usualOptionCount === 4 ? "A à D" : "A à E"}), polarité indiquée dans l'énoncé (réponse juste / réponse fausse)${f.combinaison > 0 ? ", combinaisons écrites en numéros 1 à 5 (ex. 1+3)" : ""}.`,
    difficultyAndVocabulary: `Niveau d'examen de la Faculté de Médecine de Blida, ${yearLabel(unit.year)}, unité « ${unit.title} » : vocabulaire médical exact, une notion du cours par question, pièges sur les détails chiffrés et les exceptions.`,
    summary: `Style des épreuves réelles de Blida — ${unit.title} (${yearLabel(unit.year)}), calculé sur ${bp.papers} sujet(s) et ${bp.questions} questions.`,
  };
  return ExamStyleProfileSchema.parse(profile);
}

export interface PracticeCandidate {
  id: string;
  paperId: string;
  academicYear: string;
  format: GenomeFormat;
  familyId: string | null;
  /** How many papers asked this question family — recurring questions come first. */
  familySize: number;
  keyLevel: TrustLevel;
  keyContested: boolean;
}

export interface PracticeExam {
  questionIds: string[];
  composition: FormatCounts;
  shortfall: number;
}

/** Small deterministic generator: the same seed gives the same exam (a student can retake it). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function assemblePracticeExam(candidates: PracticeCandidate[], bp: BlidaBlueprint, options: { count?: number; minKeyLevel?: TrustLevel; seed?: number } = {}): PracticeExam {
  const minKey = options.minKeyLevel ?? TRUST_LEVELS.community;
  const count = options.count ?? bp.medianQuestionsPerPaper ?? 40;
  const random = mulberry32(options.seed ?? 1);
  // One question per family: the best-keyed, then the most recent.
  const byFamily = new Map<string, PracticeCandidate>();
  for (const c of candidates) {
    if (c.keyLevel < minKey || c.keyContested || c.format === "qroc") continue;
    const family = c.familyId ?? c.id;
    const held = byFamily.get(family);
    if (!held || c.keyLevel > held.keyLevel || (c.keyLevel === held.keyLevel && c.academicYear > held.academicYear)) byFamily.set(family, c);
  }
  // Recurring families first, then a seeded shuffle.
  const pool = Array.from(byFamily.values())
    .filter((c) => c.format === "qcs" || c.format === "qcm" || c.format === "combinaison")
    .map((c) => ({ c, r: random() }))
    .sort((a, b) => b.c.familySize - a.c.familySize || a.r - b.r)
    .map((x) => x.c);
  // splitByShares normalises the shares (and puts everything in QCS when they are all zero).
  const wanted = splitByShares(count, { qcs: bp.formatShares.qcs, qcm: bp.formatShares.qcm, combinaison: bp.formatShares.combinaison });
  const picked = new Set<PracticeCandidate>();
  for (const format of ["qcs", "qcm", "combinaison"] as const) {
    for (const c of pool.filter((x) => x.format === format).slice(0, wanted[format])) picked.add(c);
  }
  // A format the bank is short of is made up from the others: a full-length paper beats an exact mix.
  for (const c of pool) {
    if (picked.size >= count) break;
    picked.add(c);
  }
  const composition: FormatCounts = { qcs: 0, qcm: 0, combinaison: 0 };
  for (const c of picked) if (c.format === "qcs" || c.format === "qcm" || c.format === "combinaison") composition[c.format] += 1;
  return { questionIds: Array.from(picked, (c) => c.id), composition, shortfall: Math.max(0, count - picked.size) };
}
