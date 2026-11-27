import { foldText } from "@/lib/exam-genome/normalize";

/**
 * EXAM GENOME — duplicate detection. The same paper reaches the bank many
 * times (an official scan, a student's photos, a retyped copy, an OCR'd
 * copy), and the same QUESTION comes back from one year to the next — often
 * rewritten from QCM to type K or the reverse. Questions are compared on
 * their content only: accents, case, punctuation, option letters, French stop
 * words and answer instructions ("cochez la ou les réponses exactes", "(RJ)")
 * removed, then cut into character 4-grams, which a few OCR typos barely
 * move (Jaccard similarity).
 *
 * Calibrated on real papers (Algiers parasitology 2022-2023 vs 2024, Algiers
 * biochemistry/imaging, microbiology, orthopaedics, Batna, Biskra):
 *  - unrelated questions (30 733 cross-module pairs) never exceed 0.18, and
 *    none is judged the same;
 *  - a question asked again the next year scores 0.54-0.98, QCM vs type K
 *    included (9 found between the two parasitology papers);
 *  - a retyped copy and the original two-column PDF of one exam are
 *    recognised as one paper;
 *  - OCR-noisy copies stay matched: 100 % at 2 % damaged characters, 97-100 %
 *    at 5 %, 87-95 % at 10 %.
 * SAME_QUESTION_JACCARD sits between the first two; the sibling and opposite
 * guards below keep "same options, another organ" and "hypo-/hyper-" apart.
 */

const STOPWORDS = new Set(
  "le la les l un une des de du d et ou en a au aux est sont qui que quel quelle quels quelles dans par pour sur avec se sa son ses ce cette ces il elle ils elles on ne pas plus tres peut peuvent etre cas tout toute tous toutes".split(" ")
);

/** How a paper asks for the answer — never part of what the question is about. */
const INSTRUCTIONS =
  /\(\s*r[jf]\s*\)|\br[jf]\b|coche[rz]?\s+(?:la\s+(?:ou|au)\s+les|la|les|une\s+seule)\s+r[ée]ponses?\s*(?:\(\s*s\s*\))?\s*(?:justes?|exactes?|fausses?|correctes?)?\s*(?:\(\s*s\s*\))?|r[ée]ponses?\s*\(?\s*s?\s*\)?\s*(?:justes?|exactes?|fausses?)\s*(?:\(\s*s\s*\))?|quel(?:le)?\s*\(\s*s\s*\)\s*est\s*\(\s*sont\s*\)|la\s*\(\s*les\s*\)|le\s*\(\s*s\s*\)/gi;

/** Options that only cite propositions ("1+3", "4") say nothing about the question. */
const PROPOSITION_REFERENCE = /^[1-5](?:\s*[+.,\-/]\s*[1-5])*\.?$/;

export function contentTokens(text: string): string[] {
  return foldText(text.replace(INSTRUCTIONS, " "))
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const GRAM = 4;

export function charGrams(normText: string, size = GRAM): Set<string> {
  const out = new Set<string>();
  if (normText.length <= size) {
    if (normText) out.add(normText);
    return out;
  }
  for (let i = 0; i + size <= normText.length; i += 1) out.add(normText.slice(i, i + size));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** 64-bit FNV-1a of a string, as 16 hex digits: equal texts, equal hashes (exact re-uploads). */
export function contentHash(text: string): string {
  let hash = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = (BigInt(1) << BigInt(64)) - BigInt(1);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface QuestionPrint {
  /** Content words, space-joined: what the database stores (eg_questions.norm_text). */
  normText: string;
  /** contentHash(normText) (eg_questions.content_hash). */
  hash: string;
  grams: Set<string>;
  /** The stem's own content words (framing words such as "concernant" left out), for the sibling check. */
  stemWords: string[];
  words: Set<string>;
}

/** Words that frame a stem without saying what it asks: "Concernant les leishmanioses" asks what "Les leishmanioses" asks. */
const STEM_FILLERS = new Set(
  "concernant propos parmi suivant suivante suivants suivantes proposition propositions laquelle lequel lesquelles lesquels indiquez choisissez cochez cocher celle celles celui ceux correspond correspondent".split(" ")
);

/** Stem + propositions + option texts. The shared statement of an exercise or clinical case is left out: it would make every question of the case look alike. */
export function questionPrint(q: { stem: string; propositions?: string[] | null; options?: { text: string }[] | null }): QuestionPrint {
  const stemTokens = contentTokens(q.stem);
  const bodyTokens = contentTokens([...(q.propositions ?? []), ...(q.options ?? []).map((o) => o.text).filter((t) => !PROPOSITION_REFERENCE.test(t.trim()))].join(" "));
  const normText = [...stemTokens, ...bodyTokens].join(" ");
  return {
    normText,
    hash: contentHash(normText),
    grams: charGrams(normText),
    stemWords: stemTokens.filter((t) => t.length >= 4 && !STEM_FILLERS.has(t)),
    words: new Set([...stemTokens, ...bodyTokens]),
  };
}

/** Opposite prefixes: "hypokaliémie" and "hyperkaliémie" are near-identical strings and opposite questions. */
const OPPOSITES: [string, string][] = [
  ["hypo", "hyper"],
  ["brady", "tachy"],
  ["micro", "macro"],
  ["mono", "poly"],
  ["intra", "extra"],
  ["endo", "exo"],
  ["hyper", "hypo"],
  ["tachy", "brady"],
  ["macro", "micro"],
  ["poly", "mono"],
  ["extra", "intra"],
  ["exo", "endo"],
];

function oppositeTerms(a: QuestionPrint, b: QuestionPrint): boolean {
  for (const [prefix, opposite] of OPPOSITES) {
    for (const word of a.words) {
      if (!word.startsWith(prefix) || word.length < prefix.length + 3) continue;
      const twin = opposite + word.slice(prefix.length);
      if (b.words.has(twin) && !a.words.has(twin) && !b.words.has(word)) return true;
    }
  }
  return false;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

/** Share of a word that differs from another (0 = same, 1 = nothing in common). */
function wordDistance(a: string, b: string): number {
  return editDistance(a, b) / Math.max(a.length, b.length);
}

function isOpposite(a: string, b: string): boolean {
  return OPPOSITES.some(([x, y]) => a.startsWith(x) && b.startsWith(y) && a.slice(x.length) === b.slice(y.length));
}

/** The same word, up to what OCR does to words: a slip or two, a word cut in two ("patho logies") or two glued together. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (isOpposite(a, b)) return false;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return wordDistance(a, b) <= 0.34;
}

/**
 * Sibling questions: one frame, the same options, another subject ("…pour
 * explorer les pathologies testiculaires ?" / "…pour explorer le cancer de la
 * prostate ?"). Each stem then holds a word the other lacks — and the two
 * words are not one word damaged by OCR. A question merely rephrased
 * ("Concernant X" / "X") holds no such pair.
 */
function siblings(a: QuestionPrint, b: QuestionPrint): boolean {
  const onlyA = a.stemWords.filter((t) => !b.stemWords.some((u) => sameWord(t, u)));
  const onlyB = b.stemWords.filter((u) => !a.stemWords.some((t) => sameWord(t, u)));
  const distinct = (x: string[], y: string[]) => x.some((t) => t.length >= 5 && y.every((u) => isOpposite(t, u) || wordDistance(t, u) > 0.5));
  return onlyA.length > 0 && onlyB.length > 0 && distinct(onlyA, onlyB) && distinct(onlyB, onlyA);
}

export const SAME_QUESTION_JACCARD = 0.35;
/** Short questions ("A. 125 B. 20 …") share grams by chance: they need more. */
export const SHORT_TEXT_CHARS = 40;
export const SAME_SHORT_QUESTION_JACCARD = 0.6;
/** Above this, two texts are one even when their stems differ a little. */
export const NEAR_IDENTICAL_JACCARD = 0.9;
/** Two papers are one when this share of the smaller paper's questions match. */
export const SAME_PAPER_RATIO = 0.6;

export function questionSimilarity(a: QuestionPrint, b: QuestionPrint): number {
  if (a.hash === b.hash && a.normText === b.normText) return 1;
  return jaccard(a.grams, b.grams);
}

export function isSameQuestion(a: QuestionPrint, b: QuestionPrint): boolean {
  if (!a.normText || !b.normText) return false;
  const similarity = questionSimilarity(a, b);
  const short = Math.min(a.normText.length, b.normText.length) < SHORT_TEXT_CHARS;
  if (similarity < (short ? SAME_SHORT_QUESTION_JACCARD : SAME_QUESTION_JACCARD)) return false;
  if (oppositeTerms(a, b)) return false;
  return similarity >= NEAR_IDENTICAL_JACCARD || !siblings(a, b);
}

export interface QuestionMatch {
  index: number;
  id: string;
  similarity: number;
}

/** For each incoming question, its best existing match above the threshold (at most one per incoming question). */
export function matchQuestions(incoming: QuestionPrint[], existing: { id: string; print: QuestionPrint }[]): QuestionMatch[] {
  const matches: QuestionMatch[] = [];
  incoming.forEach((print, index) => {
    let best: QuestionMatch | null = null;
    for (const candidate of existing) {
      if (!isSameQuestion(print, candidate.print)) continue;
      const similarity = questionSimilarity(print, candidate.print);
      if (!best || similarity > best.similarity) best = { index, id: candidate.id, similarity };
    }
    if (best) matches.push(best);
  });
  return matches;
}

/** How much of the smaller paper the larger one contains (each question used once): two copies of one exam score near 1. */
export function paperOverlap(a: QuestionPrint[], b: QuestionPrint[]): { matched: number; ratio: number } {
  const [small, large] = a.length <= b.length ? [a, b] : [b, a];
  if (!small.length) return { matched: 0, ratio: 0 };
  const used = new Set<number>();
  let matched = 0;
  for (const q of small) {
    let best = -1;
    let bestSim = 0;
    large.forEach((candidate, i) => {
      if (used.has(i) || !isSameQuestion(q, candidate)) return;
      const sim = questionSimilarity(q, candidate);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched += 1;
    }
  }
  return { matched, ratio: matched / small.length };
}
