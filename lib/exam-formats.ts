/**
 * The three question formats of the Examen de Module, as in Algerian medical
 * faculties — shared by the generator (server), the schema, the scoring and
 * the exam page (client), so every one of them reads a question the same way.
 *
 *  - "qcs": ONE answer to tick among A–E — RJ (the only exact proposition) or
 *    RF (the only inexact one).
 *  - "qcm": SEVERAL answers to tick (2 to 4) — every exact (RJ) or every
 *    inexact (RF) proposition.
 *  - "combinaison": five numbered propositions (1–5); options A–E are
 *    combinations of their numbers ("1+3", "2+4+5"…), and exactly one of them
 *    lists every exact (RJ) / inexact (RF) proposition and nothing else.
 *
 * `isCorrect` always marks what the student must TICK (for an RF question,
 * the inexact proposition(s)), so scoring is one rule for every format: the
 * ticked set must equal the isCorrect set. A saved exam from before these
 * formats has no `format` field: it reads as a QCS (exactly one isCorrect),
 * with its answers stored as a single letter — unchanged.
 */

export const EXAM_FORMATS = ["qcs", "qcm", "combinaison"] as const;
export type ExamFormat = (typeof EXAM_FORMATS)[number];

export const EXAM_POLARITIES = ["rj", "rf"] as const;
export type ExamPolarity = (typeof EXAM_POLARITIES)[number];

export type FormatCounts = Record<ExamFormat, number>;

/** Default mix of an exam, when the professor's style does not set another one. */
export const EXAM_FORMAT_SHARES: FormatCounts = { qcs: 0.4, qcm: 0.35, combinaison: 0.25 };

/** A QCM has several answers to tick — never one (that is a QCS), never all five (no discrimination left). */
export const QCM_MIN_CORRECT = 2;
export const QCM_MAX_CORRECT = 4;

const EMPTY_COUNTS: FormatCounts = { qcs: 0, qcm: 0, combinaison: 0 };

function sumCounts(counts: FormatCounts): number {
  return EXAM_FORMATS.reduce((sum, format) => sum + counts[format], 0);
}

/** Largest-remainder split of `total` by `shares` — always sums to exactly `total`. */
export function splitByShares(total: number, shares: FormatCounts = EXAM_FORMAT_SHARES): FormatCounts {
  const count = Math.max(0, Math.floor(total));
  const weight = sumCounts(shares);
  if (count === 0 || weight <= 0) return { ...EMPTY_COUNTS, qcs: count };
  const exact = EXAM_FORMATS.map((format) => ({ format, value: (count * shares[format]) / weight }));
  const result: FormatCounts = { ...EMPTY_COUNTS };
  for (const { format, value } of exact) result[format] = Math.floor(value);
  let left = count - sumCounts(result);
  // Ties keep EXAM_FORMATS order (the sort is stable).
  for (const { format } of [...exact].sort((a, b) => (b.value % 1) - (a.value % 1))) {
    if (left <= 0) break;
    result[format]++;
    left--;
  }
  return result;
}

/**
 * One format per question, spread evenly (qcs, qcm, combinaison, qcs, …), so
 * that consecutive slices of the list — one slice per generation job — each
 * get a fair mix instead of one job receiving every combination question.
 */
export function buildFormatDeck(counts: FormatCounts): ExamFormat[] {
  const total = sumCounts(counts);
  const used: FormatCounts = { ...EMPTY_COUNTS };
  const deck: ExamFormat[] = [];
  for (let i = 0; i < total; i++) {
    let best: ExamFormat | null = null;
    let bestDeficit = -Infinity;
    for (const format of EXAM_FORMATS) {
      if (used[format] >= counts[format]) continue;
      const deficit = ((i + 1) * counts[format]) / total - used[format];
      if (deficit > bestDeficit) {
        best = format;
        bestDeficit = deficit;
      }
    }
    if (!best) break;
    used[best]++;
    deck.push(best);
  }
  return deck;
}

export function tallyFormats(formats: ExamFormat[]): FormatCounts {
  const counts: FormatCounts = { ...EMPTY_COUNTS };
  for (const format of formats) counts[format]++;
  return counts;
}

function readCounts(raw: unknown): FormatCounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const counts: FormatCounts = { ...EMPTY_COUNTS };
  for (const format of EXAM_FORMATS) {
    const value = record[format] ?? 0;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 60) return null;
    counts[format] = value;
  }
  return counts;
}

/**
 * The format tally a job asks for: `raw` when it is a valid tally of exactly
 * `count`; `raw` rescaled to `count` when the count changed (the browser
 * re-queues a job with only its missing questions); otherwise the default mix.
 */
export function normalizeFormatCounts(raw: unknown, count: number): FormatCounts {
  const counts = readCounts(raw);
  if (counts && sumCounts(counts) === count) return counts;
  if (counts && sumCounts(counts) > 0) return splitByShares(count, counts);
  return splitByShares(count);
}

/** The format a question is shown and scored as: its own field when set, otherwise "qcs" — or "qcm" for a legacy question with several isCorrect options. */
export function questionFormat(question: { format?: unknown; options?: unknown }): ExamFormat {
  if (typeof question.format === "string" && (EXAM_FORMATS as readonly string[]).includes(question.format)) return question.format as ExamFormat;
  const options = Array.isArray(question.options) ? question.options : [];
  const correct = options.filter((option) => !!option && typeof option === "object" && (option as { isCorrect?: unknown }).isCorrect === true).length;
  return correct > 1 ? "qcm" : "qcs";
}

/**
 * What a re-queued job still needs: requested minus what already came back,
 * re-balanced to exactly `missing` — so a job whose combination question was
 * rejected asks for a combination again, not for one more QCS.
 */
export function remainingFormatCounts(requested: unknown, produced: unknown[], missing: number): FormatCounts {
  const asked = readCounts(requested);
  if (!asked) return splitByShares(missing);
  const got = tallyFormats(produced.filter((q): q is { format?: unknown; options?: unknown } => !!q && typeof q === "object").map(questionFormat));
  const left: FormatCounts = { ...EMPTY_COUNTS };
  for (const format of EXAM_FORMATS) left[format] = Math.max(0, asked[format] - got[format]);
  return normalizeFormatCounts(left, missing);
}

/** `target` minus what `formats` already covers, never below zero. */
export function subtractFormats(target: FormatCounts, formats: ExamFormat[]): FormatCounts {
  const have = tallyFormats(formats);
  const left: FormatCounts = { ...EMPTY_COUNTS };
  for (const format of EXAM_FORMATS) left[format] = Math.max(0, target[format] - have[format]);
  return left;
}

/**
 * Gives every generation unit (a job, a shortfall group) its share of the
 * formats still needed for the exam: one evenly spread deck over all the
 * units' questions, cut into consecutive slices. When the needs do not add
 * up to the units' total, they are rescaled to it (normalizeFormatCounts) —
 * every question is always assigned a format.
 */
export function assignFormats<T extends { count: number }>(units: T[], needs: FormatCounts): (T & { formats: FormatCounts })[] {
  const total = units.reduce((sum, unit) => sum + unit.count, 0);
  const deck = buildFormatDeck(normalizeFormatCounts(needs, total));
  let offset = 0;
  return units.map((unit) => {
    const slice = deck.slice(offset, offset + unit.count);
    offset += unit.count;
    return { ...unit, formats: tallyFormats(slice) };
  });
}

/**
 * Keeps `count` questions, preferring the formats that were asked for: a
 * model that wrote one QCS too many and one combination too few still gives
 * the exam its combination when it wrote a spare one.
 */
export function pickByFormats<Q extends { format?: unknown; options?: unknown }>(questions: Q[], wanted: FormatCounts | undefined, count: number): Q[] {
  if (!wanted) return questions.slice(0, count);
  const left = { ...wanted };
  const picked: Q[] = [];
  const spare: Q[] = [];
  for (const question of questions) {
    const format = questionFormat(question);
    if (picked.length < count && left[format] > 0) {
      left[format]--;
      picked.push(question);
    } else {
      spare.push(question);
    }
  }
  return [...picked, ...spare].slice(0, count);
}

/**
 * "1+3", "1 + 3", "(1+3)", "A(1+3)", "1, 3", "1 et 3" → [1, 3]: the ways a
 * model writes the same combination. Null when the text is not a set of
 * DISTINCT numbers between 1 and 5.
 */
export function parseCombination(text: string): number[] | null {
  const body = text
    .trim()
    .replace(/^[A-E]\s*[.:)-]?\s*(?=\()/i, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  if (!/^[1-5](?:\s*(?:\+|,|;|&|et|and)\s*[1-5])*$/i.test(body)) return null;
  const numbers = (body.match(/[1-5]/g) ?? []).map(Number);
  if (new Set(numbers).size !== numbers.length) return null;
  return numbers.sort((a, b) => a - b);
}

/** Canonical stored form of a combination: "1+3". */
export function formatCombination(numbers: number[]): string {
  return [...numbers].sort((a, b) => a - b).join("+");
}
