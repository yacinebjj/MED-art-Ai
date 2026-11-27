import { BLIDA_UNITS, blidaUnitsForYear, type BlidaExamUnit, type GenomeSitting } from "@/lib/exam-genome/blida-catalog";
import type { GenomeSession } from "@/lib/exam-genome/scope";

/**
 * EXAM GENOME — reading what a paper says about itself. Every label a student
 * or a scanned header writes ("3ème Année", "Rattrapage", "1er EMD",
 * "2023-2024", "UEI 03", "Cardio-pneumo") becomes the bank's canonical value,
 * and the header decides whether the paper is in scope at all: Blida 1,
 * Médecine. Pure text functions — no I/O.
 */

/** Lower-case, accents removed, every non-alphanumeric run collapsed to one space. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

const ORDINAL_WORDS: Record<string, number> = { premiere: 1, deuxieme: 2, troisieme: 3, quatrieme: 4, cinquieme: 5, sixieme: 6 };

/** "3ème année", "3eme annee médecine", "3A", "troisième année", "Med 3" → 3 (1-6 only), else null. */
export function normalizeYearLevel(label: string): number | null {
  const t = foldText(label);
  const word = t.match(/\b(premiere|deuxieme|troisieme|quatrieme|cinquieme|sixieme)\s+an+e+\b/);
  if (word) return ORDINAL_WORDS[word[1]];
  // "an+e+" also reads OCR slips such as "Annnée".
  const numbered = t.match(/\b([1-6])\s*(?:ere|er|eme|e|em|ieme)?\s*(?:an+e+|a)\b(?!\s*\d)/);
  if (numbered) return Number(numbered[1]);
  // "Médecine 3" — but not "Médecine 1ère EMD", where the ordinal belongs to the EMD.
  const med = t.match(/\bmed(?:ecine)?\s*([1-6])\b(?!\s*(?:ere|er|eme|e|em|ieme|re)\b)/);
  return med ? Number(med[1]) : null;
}

/** "2023-2024", "2023/24", "23/24", "Année universitaire 2023 2024" → "2023/2024". */
export function normalizeAcademicYear(label: string): string | null {
  const full = label.match(/\b(20\d{2})\s*[-/–_ ]\s*(20\d{2})\b/);
  if (full && Number(full[2]) === Number(full[1]) + 1) return `${full[1]}/${full[2]}`;
  const short = label.match(/\b(20\d{2})\s*[-/–]\s*(\d{2})\b/);
  if (short && Number(short[2]) === (Number(short[1]) + 1) % 100) return `${short[1]}/${Number(short[1]) + 1}`;
  const tiny = label.match(/(?:^|\D)(\d{2})\s*\/\s*(\d{2})(?:\D|$)/);
  if (tiny && Number(tiny[2]) === Number(tiny[1]) + 1 && Number(tiny[1]) >= 10) return `20${tiny[1]}/20${tiny[2]}`;
  return null;
}

/** "25/04/2024", "25.4.2024", "le 23/06/2024" → "2024-04-25" (the first plausible date), else null. */
export function findExamDate(text: string): string | null {
  for (const match of text.matchAll(/\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(20\d{2})\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

/** The academic year an exam date belongs to: September opens a new year. */
export function academicYearOfDate(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

export function normalizeSession(label: string): GenomeSession {
  const t = foldText(label);
  return /\brattrapage\b|\bratt\b|\b2(?:eme|e)? session\b|\bdeuxieme session\b/.test(t) ? "rattrapage" : "normale";
}

export function normalizeSitting(label: string): GenomeSitting {
  const t = foldText(label);
  // "EMD 1", "EMD N°1" (the ° folds away), "1er EMD", "premier EMD".
  if (/\bemd\s*(?:n\s*o?\s*)?0?1\b|\b1\s*(?:er|ere|re)\s*emd\b|\bpremiere?\s+emd\b/.test(t)) return "emd1";
  if (/\bemd\s*(?:n\s*o?\s*)?0?2\b|\b2\s*(?:eme|e|nd|nde)\s*emd\b|\bdeuxieme\s+emd\b/.test(t)) return "emd2";
  if (/\bsynthese\b/.test(t)) return "synthese";
  return "unique";
}

export interface UnitMatch {
  unit: BlidaExamUnit;
  alias: string;
  score: number;
}

/**
 * The exam unit a label names, within one year (aliases are year-specific:
 * "UEI 3" is the urinary UEI in 2nd year, the endocrine one in 3rd). The
 * longest alias found in the label wins; a code ("Y3-UEI3") is accepted too.
 */
export function resolveUnit(year: number, label: string): UnitMatch | null {
  const t = ` ${foldText(label)} `;
  const codeMatch = label.trim().toUpperCase();
  const byCode = BLIDA_UNITS.find((u) => u.code === codeMatch);
  if (byCode) return byCode.year === year ? { unit: byCode, alias: byCode.code, score: 100 } : null;
  let best: UnitMatch | null = null;
  for (const unit of blidaUnitsForYear(year)) {
    for (const alias of [...unit.aliases, foldText(unit.title)]) {
      const a = foldText(alias);
      if (!a || !t.includes(` ${a} `)) continue;
      const score = a.length;
      if (!best || score > best.score) best = { unit, alias: a, score };
    }
  }
  return best;
}

export type ScopeVerdict = "in_scope" | "out_of_scope" | "unverified";

export interface PaperScope {
  verdict: ScopeVerdict;
  faculty: "blida" | "other" | "unknown";
  track: "medecine" | "pharmacie" | "dentaire" | "veterinaire" | "unknown";
  reasons: string[];
  yearLevel: number | null;
  academicYear: string | null;
  examDate: string | null;
  session: GenomeSession;
  sitting: GenomeSitting;
}

const BLIDA = /\bblida\b|\bsaad\s+dahl[ae]?b\b|البليدة/;
// Another university named in the header. "alger" alone would catch "République Algérienne": only its university forms.
const OTHER_FACULTIES: [string, RegExp][] = [
  ["Alger", /universite (?:d )?alger\b|faculte de medecine (?:d )?alger\b|\balger\s*1\b|benyoucef|ben youcef/],
  ["Annaba", /\bannaba\b|badji mokhtar/],
  ["Oran", /\boran\b|ahmed ben bella/],
  ["Constantine", /\bconstantine\b|salah boubnider/],
  ["Sétif", /\bsetif\b|ferhat abbas/],
  ["Tlemcen", /\btlemcen\b|abou bekr belkaid/],
  ["Batna", /\bbatna\b|benboulaid|ben boulaid/],
  ["Biskra", /\bbiskra\b|mohamed kh[ia]i?der/],
  ["Tizi Ouzou", /tizi ouzou|mouloud mammeri/],
  ["Béjaïa", /\bbejaia\b|abderrahmane mira/],
  ["Sidi Bel Abbès", /sidi bel abbes|djillali liabes/],
  ["Mostaganem", /\bmostaganem\b/],
  ["Ouargla", /\bouargla\b|kasdi merbah/],
  ["Jijel", /\bjijel\b/],
  ["Laghouat", /\blaghouat\b/],
  ["Béchar", /\bbechar\b/],
  ["Djelfa", /\bdjelfa\b/],
  ["M'Sila", /\bm sila\b|\bmsila\b/],
  ["Tamanrasset", /\btamanrasset\b/],
  ["Adrar", /\badrar\b/],
];

/**
 * Whether a paper belongs in the bank, from its own header (the text before
 * the first question): Blida 1 and Médecine, never pharmacy, dentistry,
 * veterinary medicine or another faculty. A header that names nothing
 * ("unverified") can still be filed from a contributor's statement, as
 * needs_review — a reviewer confirms it before anything is published.
 */
export function detectPaperScope(headerText: string): PaperScope {
  const t = foldText(headerText);
  const reasons: string[] = [];
  let faculty: PaperScope["faculty"] = "unknown";
  if (BLIDA.test(t) || /البليدة/.test(headerText)) {
    faculty = "blida";
    reasons.push("en-tête : Blida");
  } else {
    const other = OTHER_FACULTIES.find(([, pattern]) => pattern.test(t));
    if (other) {
      faculty = "other";
      reasons.push(`en-tête : ${other[0]}`);
    }
  }

  let track: PaperScope["track"] = "unknown";
  if (/\bveterinaire\b|\bveterinaires\b/.test(t)) track = "veterinaire";
  else if (/medecine dentaire|chirurgie dentaire|departement de medecine dentaire|\bdentaire\b/.test(t)) track = "dentaire";
  // Before médecine: every department sits in a "Faculté de Médecine". Misspellings seen on real headers ("PHARMCIE") count.
  else if (/departement (?:de )?pharm[a-z]*|\bpharmacie\b|\bpharmcie\b/.test(t)) track = "pharmacie";
  else if (/departement de medecine|annee (?:de )?medecine|medecine\b|faculte de medecine/.test(t)) track = "medecine";
  if (track !== "unknown") reasons.push(`filière : ${track}`);

  const examDate = findExamDate(headerText);
  const academicYear = normalizeAcademicYear(headerText) ?? (examDate ? academicYearOfDate(examDate) : null);
  const scope: PaperScope = {
    verdict: "unverified",
    faculty,
    track,
    reasons,
    yearLevel: normalizeYearLevel(headerText),
    academicYear,
    examDate,
    session: normalizeSession(headerText),
    sitting: normalizeSitting(headerText),
  };
  if (faculty === "other" || (track !== "unknown" && track !== "medecine")) scope.verdict = "out_of_scope";
  else if (faculty === "blida" && track === "medecine") scope.verdict = "in_scope";
  return scope;
}
