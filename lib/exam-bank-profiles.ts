import type { ExamStyleProfile } from "@/lib/ai/exam-schemas";
import type { FormatCounts } from "@/lib/exam-formats";

/**
 * BANK PROFILES — which shared question bank (exam_harvested_qcms, the tag
 * lives in qcm.exam.profile) an Examen de Module run reads from and files
 * into. A question is only ever reused by a run of the SAME profile, so an
 * exam always gets questions written for that profile (a "Régénérer" of the
 * canonical exam writes into the canonical bank too — same prompt, asked for
 * novelty):
 *  - CANONICAL_BANK_PROFILE: the default exam (DEFAULT_EXAM_PREFERENCES,
 *    "Examen facultaire · Équilibré · Approfondi"). Versioned: bump it when
 *    the canonical prompt changes, so questions written under the previous
 *    one are never served as the new exam (as the exam cache key is bumped in
 *    lib/exam-content-cache.ts).
 *  - one profile per reference-exam ARCHETYPE (classifyExamStyle): exams
 *    guided by different professors' reference exams of the same archetype
 *    share their questions; each professor's own profile still drives the
 *    generation of whatever the bank cannot cover, and its stated format split
 *    (styleFormatShares) sets the exam's QCS / QCM / combinaison mix. Only a
 *    profile sealed by the analysis for that student (lib/exam-style-seal.ts)
 *    may use an archetype bank.
 *  - custom preferences ("sur-mesure"): no bank — generated from scratch.
 */
export const CANONICAL_BANK_PROFILE = "faculte-v1";

export const EXAM_STYLE_ARCHETYPES = ["direct", "clinique", "pieges"] as const;
export type ExamStyleArchetype = (typeof EXAM_STYLE_ARCHETYPES)[number];

export const EXAM_STYLE_ARCHETYPE_LABELS: Record<ExamStyleArchetype, string> = {
  direct: "Direct / factuel",
  clinique: "Cas cliniques / vignettes",
  pieges: "Pièges / négations",
};

export function styleBankProfile(archetype: ExamStyleArchetype): string {
  return `style-${archetype}-v1`;
}

/** Lower case, accents removed: "Cas Cliniques" and "cas cliniques" read the same. */
function plain(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * A description cut into clauses ("78 % QCM directs, 22 % cas cliniques" →
 * two clauses), so a number is only ever read with the words of its own
 * clause — never attached to a term from the next one. A label keeps its
 * value ("Cas cliniques : 45 %" is one clause), and a decimal ("22,5 %") is
 * read as its whole part instead of being cut in two at its comma.
 */
function clauses(text: string): string[] {
  return plain(text)
    .replace(/(\d+)[.,]\d+/g, "$1")
    .replace(/[()[\]«»"]/g, " ")
    .split(/[,;.\n/]+|\s+(?:et|mais|dont|avec)\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** A clause that says something is absent or rare ("aucun cas clinique", "très peu de vignettes", "sans RF"). */
const NEGATED = /\b(aucune?s?|sans|pas de|pas d|peu de|tres peu|rares?|rarement|absente?s?|absence|exclue?s?|jamais|zero)\b|(^|\D)0\s*%/;
const PERCENT = /(\d{1,3})(?:[.,]\d+)?\s*%/;
const CLINICAL = /\b(cas cliniques?|vignettes?|dossiers? cliniques?|situations? cliniques?)\b/;
/** Other question types: a clause naming one of them besides clinical cases is ambiguous, so its number is not read as the clinical share. */
const OTHER_TYPES = /\b(qcs|qcm|qroc|questions? directes?|directs?|connaissances?|combinaisons?|propositions numerotees)\b/;
const MAJORITY = /\b(majoritairement|principalement|essentiellement|surtout|en majorite|majorite|predominance|la plupart)\b/;
/** A clinical-case share of the exam at or above this makes it a "clinique" exam. */
const CLINICAL_SHARE_THRESHOLD = 40;

/** Negative formulations the "pieges" archetype is made of (RF, "sauf", "inexacte", négations…). */
const NEGATIVE_FORMULATION = /(negation|negati(?:f|fs|ve|ves)|forme negative|\bsauf\b|inexacte?s?|\bfausses?\b|\bfaux\b|exceptions?|\brf\b)/;
const FREQUENT = /\b(majoritairement|beaucoup|nombreuses?|frequente?s?|frequemment|souvent|surtout|systematiquement|la plupart)\b/;
/** An RF share at or above this, stated in the description, counts as an overall negative style. */
const RF_SHARE_THRESHOLD = 30;

/** The clinical-case share stated in the profile (a clause naming clinical cases and a number, nothing negated), null when none. */
function clinicalShare(description: string): number | null {
  let best: number | null = null;
  for (const clause of clauses(description)) {
    if (!CLINICAL.test(clause) || NEGATED.test(clause) || OTHER_TYPES.test(clause)) continue;
    const match = clause.match(PERCENT);
    if (match) best = Math.max(best ?? 0, Number(match[1]));
  }
  return best;
}

/** The description says, in one clause, that negative formulations are frequent (a stated RF share, or frequency wording) — a bare "RJ ou RF" does not count. */
function negativeOverall(description: string): boolean {
  return clauses(description).some((clause) => {
    if (NEGATED.test(clause) || !NEGATIVE_FORMULATION.test(clause)) return false;
    const share = clause.match(PERCENT);
    return (share !== null && /\brf\b/.test(clause) && Number(share[1]) >= RF_SHARE_THRESHOLD) || FREQUENT.test(clause) || /pieges?/.test(clause);
  });
}

/**
 * The archetype of a reference exam's style profile — deterministic, no model
 * call, read clause by clause from the profile's own descriptions:
 *  - "clinique": a stated clinical-case share of at least 40 %, or — when no
 *    share is stated — a clause saying clinical cases are the majority;
 *  - "pieges": at least two observed traps built on negative formulations, or
 *    one plus a description saying they are frequent;
 *  - "direct": everything else (direct knowledge questions).
 * Anything negated ("aucun cas clinique", "très peu de vignettes", "aucune
 * RF") never counts. A borderline profile only changes which archetype bank
 * it shares; its own profile still drives the generation.
 */
export function classifyExamStyle(profile: ExamStyleProfile): ExamStyleArchetype {
  const description = `${profile.questionTypeDistribution}. ${profile.summary}`;
  const share = clinicalShare(description);
  const majorityClinical = clauses(description).some((clause) => MAJORITY.test(clause) && CLINICAL.test(clause) && !NEGATED.test(clause) && !OTHER_TYPES.test(clause));
  if (share !== null ? share >= CLINICAL_SHARE_THRESHOLD : majorityClinical) return "clinique";

  // Traps the model actually observed — its "none observed" placeholder (and any negated trap) does not count.
  const negativeTraps = profile.trapPatterns.map(plain).filter((trap) => !NEGATED.test(trap.slice(0, 12)) && NEGATIVE_FORMULATION.test(trap)).length;
  const negativeDescription = negativeOverall(`${profile.questionTypeDistribution}. ${profile.optionFormatConventions}. ${profile.summary}`);
  if (negativeTraps >= 2 || (negativeTraps >= 1 && negativeDescription)) return "pieges";
  return "direct";
}

/** Explicit format terms only: a bare "QCM" is ambiguous in French usage (any multiple-choice question), so it is not read as a multi-answer share. */
const FORMAT_TERMS: [format: keyof FormatCounts, pattern: RegExp][] = [
  ["combinaison", /\b(combinaisons?|propositions numerotees|questions? a combinaisons?)\b/],
  ["qcs", /\b(qcs|choix simple|choix unique|reponse unique|une seule reponse|single)\b/],
  ["qcm", /\b(reponses multiples|choix multiples?|plusieurs reponses|qcm multiples?|qcm a reponses multiples)\b/],
];
const EXCLUSIVE = /\b(uniquement|exclusivement|seulement|que des|tous|toutes)\b/;

/**
 * The QCS / QCM / combinaison split the reference exam's profile states, as
 * relative weights (lib/exam-formats.ts splitByShares) — null when it states
 * none, then the exam keeps the default mix. Read clause by clause: a clause
 * naming exactly one format with a percentage (or "uniquement…") gives that
 * format's share; negated or ambiguous clauses are ignored.
 */
export function styleFormatShares(profile: ExamStyleProfile): FormatCounts | null {
  const shares: FormatCounts = { qcs: 0, qcm: 0, combinaison: 0 };
  for (const clause of clauses(profile.questionTypeDistribution)) {
    if (NEGATED.test(clause)) continue;
    const named = FORMAT_TERMS.filter(([, pattern]) => pattern.test(clause)).map(([format]) => format);
    if (named.length !== 1) continue;
    const percent = clause.match(PERCENT);
    const share = percent ? Number(percent[1]) : EXCLUSIVE.test(clause) ? 100 : 0;
    shares[named[0]] += Math.min(100, share);
  }
  return shares.qcs + shares.qcm + shares.combinaison > 0 ? shares : null;
}

/**
 * The bank a run uses: none for custom preferences (sur-mesure), the
 * archetype's for a reference-exam run, the canonical one otherwise.
 */
export function bankProfileFor(run: { styleProfile?: ExamStyleProfile; hasCustomPreferences: boolean }): string | null {
  if (run.hasCustomPreferences) return null;
  return run.styleProfile ? styleBankProfile(classifyExamStyle(run.styleProfile)) : CANONICAL_BANK_PROFILE;
}
