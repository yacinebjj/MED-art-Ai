import { TRUST_LEVELS, type GenomeFormat, type KeySource, type TrustLevel } from "@/lib/exam-genome/scope";

/**
 * EXAM GENOME — which answer a question shows, and how far to trust it.
 * Claims accumulate (an official grid, a teacher, reviewers, students, an AI)
 * and one effective key is resolved from them: the highest level wins, a
 * disagreement at that level marks the key "contested", and usage itself can
 * contest a key — when the strongest students consistently choose another
 * answer, the key is probably wrong (itemAnalysis below).
 */

export interface KeyClaim {
  answer: string;
  level: TrustLevel;
  source: KeySource;
  /** Who stated it — community agreement counts distinct people, never repeated votes. */
  contributorId?: string | null;
}

export interface EffectiveKey {
  answer: string | null;
  level: TrustLevel;
  contested: boolean;
  /** How many independent claims back the shown answer. */
  support: number;
  reasons: string[];
}

export const COMMUNITY_MIN_VOTERS = 3;
export const COMMUNITY_MIN_AGREEMENT = 0.75;

function tally(claims: KeyClaim[]): { answer: string; count: number }[] {
  const counts = new Map<string, Set<string>>();
  claims.forEach((claim, i) => {
    const voters = counts.get(claim.answer) ?? new Set<string>();
    voters.add(claim.contributorId ?? `anonymous-${i}`);
    counts.set(claim.answer, voters);
  });
  return Array.from(counts, ([answer, voters]) => ({ answer, count: voters.size })).sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer));
}

export function resolveEffectiveKey(claims: KeyClaim[]): EffectiveKey {
  const reasons: string[] = [];
  const official = claims.filter((c) => c.level === TRUST_LEVELS.official);
  const expert = claims.filter((c) => c.level === TRUST_LEVELS.expert);
  if (official.length) {
    const votes = tally(official);
    const contestedByExperts = tally(expert).some((e) => e.answer !== votes[0].answer && e.count >= 2);
    if (votes.length > 1) reasons.push("corrigés officiels divergents");
    if (contestedByExperts) reasons.push("au moins deux relecteurs contestent le corrigé officiel");
    return { answer: votes[0].answer, level: TRUST_LEVELS.official, contested: votes.length > 1 || contestedByExperts, support: votes[0].count, reasons };
  }
  if (expert.length) {
    const votes = tally(expert);
    if (votes.length > 1) reasons.push("relecteurs en désaccord");
    return { answer: votes[0].answer, level: TRUST_LEVELS.expert, contested: votes.length > 1, support: votes[0].count, reasons };
  }
  const human = claims.filter((c) => c.source !== "ai" && c.level >= TRUST_LEVELS.proposed);
  if (human.length) {
    const votes = tally(human);
    const voters = votes.reduce((s, v) => s + v.count, 0);
    const share = votes[0].count / voters;
    if (votes[0].count >= COMMUNITY_MIN_VOTERS && share >= COMMUNITY_MIN_AGREEMENT) {
      return { answer: votes[0].answer, level: TRUST_LEVELS.community, contested: false, support: votes[0].count, reasons: [`${votes[0].count} étudiants d'accord (${Math.round(share * 100)} %)`] };
    }
    if (voters >= 2 && share < 0.5) reasons.push("propositions des étudiants divergentes");
    return { answer: votes[0].answer, level: TRUST_LEVELS.proposed, contested: voters >= 2 && share < 0.5, support: votes[0].count, reasons };
  }
  const ai = claims.filter((c) => c.source === "ai");
  if (ai.length) return { answer: tally(ai)[0].answer, level: TRUST_LEVELS.proposed, contested: false, support: 0, reasons: ["proposé par l'IA"] };
  return { answer: null, level: TRUST_LEVELS.none, contested: false, support: 0, reasons: [] };
}

/** Whether an answer can be the key of a question of this format: one letter (QCS, type K), one or more for a QCM (real papers allow 1 to all). */
export function isAnswerValidForFormat(answer: string, format: GenomeFormat, optionCount: number): boolean {
  if (!/^(?=[A-E]{1,5}$)A?B?C?D?E?$/.test(answer)) return false;
  const lastAllowed = String.fromCharCode(64 + Math.min(5, Math.max(1, optionCount)));
  if (answer.split("").some((l) => l > lastAllowed)) return false;
  if (format === "qcs" || format === "combinaison") return answer.length === 1;
  if (format === "qcm") return answer.length >= 1;
  return false;
}

export interface ItemResponse {
  /** The answer the student gave to this question ("BD"). */
  answer: string;
  /** The student's score on the whole paper, 0 to 1. */
  paperScore: number;
}

export interface ItemAnalysis {
  n: number;
  /** Share of students who gave the key. */
  pValue: number;
  /** Upper 27 % minus lower 27 % rate of giving the key: negative = the better students avoid it. */
  discrimination: number;
  /** The answer the strongest students prefer, when it is not the key. */
  strongAlternative: string | null;
  suspectedKeyError: boolean;
}

/** Classical item analysis: a key the best students reject while they agree on another answer is flagged for expert review. */
export function itemAnalysis(key: string, responses: ItemResponse[]): ItemAnalysis {
  const n = responses.length;
  if (!n) return { n: 0, pValue: 0, discrimination: 0, strongAlternative: null, suspectedKeyError: false };
  const sorted = [...responses].sort((a, b) => b.paperScore - a.paperScore);
  const k = Math.max(1, Math.round(n * 0.27));
  const upper = sorted.slice(0, k);
  const lower = sorted.slice(-k);
  const rate = (group: ItemResponse[], answer: string) => group.filter((r) => r.answer === answer).length / group.length;
  const discrimination = rate(upper, key) - rate(lower, key);
  const upperTally = new Map<string, number>();
  for (const r of upper) upperTally.set(r.answer, (upperTally.get(r.answer) ?? 0) + 1);
  const [topAnswer, topCount] = Array.from(upperTally).sort((a, b) => b[1] - a[1])[0];
  const strongAlternative = topAnswer !== key && topCount / upper.length >= 0.4 ? topAnswer : null;
  const altDiscrimination = strongAlternative ? rate(upper, strongAlternative) - rate(lower, strongAlternative) : 0;
  return {
    n,
    pValue: rate(responses, key),
    discrimination: Math.round(discrimination * 100) / 100,
    strongAlternative,
    suspectedKeyError: n >= 30 && discrimination < 0 && altDiscrimination > 0.2,
  };
}
