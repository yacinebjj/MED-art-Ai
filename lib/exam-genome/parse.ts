import type { GenomeFormat, GenomeOptionLabel } from "@/lib/exam-genome/scope";

/**
 * EXAM GENOME — exam text → questions, deterministically (no AI): the text
 * of a paper (its PDF text layer, or OCR of a scan) becomes numbered
 * questions in the three formats of Algerian medical exams — QCS (one answer),
 * QCM (several), combinaison / type K (numbered propositions 1-5, options
 * "A: 1.3") — with RJ/RF polarity, plus the answer key when the document
 * carries one (a grid "1 AD 2 A …", "1- C", "1. ABDE", a two-row table,
 * "Réponse : BD" lines, or the points a "corrigé type" writes next to the
 * right options).
 *
 * Built on the layouts of real papers (Alger, Batna, Biskra, Béjaïa, retyped
 * and OCR'd copies): "1-", "1/", "1.", "Q1.", "QCM 1-1,5 pt :" numbering;
 * A–E or a–e options on their own lines, inline, without punctuation
 * ("A Sont…", "D Enzymes"), with a comma ("A,L'apparition"), out of order or
 * interleaved by a two-column layout ("B. x D- y" / "C. z E- w"); type K
 * combinations as "A:1.3", "A=1+2+3", "A (1+4+3)", over one or two lines, in
 * any order; running page headers repeated on every page. Every question
 * carries a confidence and its issues: anything uncertain goes to human
 * review, never straight to students.
 */

export interface ParsedOption {
  label: GenomeOptionLabel;
  text: string;
}

export interface ParsedQuestion {
  position: number;
  /** The shared statement of an "Exercice" or a "Cas clinique" the question belongs to (null for a standalone question). */
  context: string | null;
  stem: string;
  propositions: string[];
  options: ParsedOption[];
  format: GenomeFormat;
  polarity: "rj" | "rf" | null;
  confidence: number;
  issues: string[];
}

export interface ParsedExam {
  header: string;
  questions: ParsedQuestion[];
  /** Question number → answer letters ("BD"), from the document itself. Empty when it carries none. */
  answerGrid: Record<number, string>;
  /** Where the answers came from: a grid or table, marks under/next to the options, both, or nowhere. */
  answerSource: "grid" | "inline" | "mixed" | null;
  warnings: string[];
  stats: {
    questions: number;
    complete: number;
    qcs: number;
    qcm: number;
    combinaison: number;
    qroc: number;
    meanConfidence: number;
    gridEntries: number;
    /** Numbering holes or many unreadable questions — typical of a two-column page read line by line: re-read it with OCR. */
    layoutSuspect: boolean;
    /** At least five questions, most with options — or an answer grid: worth reviewing as an exam. */
    looksLikeExam: boolean;
  };
}

const LETTERS: GenomeOptionLabel[] = ["A", "B", "C", "D", "E"];

/** "1-", "1/", "1)", "1.", "1:", "Q1.", "Question 1 :", "Question n° 1", "N°1-", "QCM 1-1,5 pt :", "QCS 3)". */
const Q_START = /^(?:(?:q(?:uestion|cm|cs|st)?)\s*)?(?:n\s*[°o]\s*)?(\d{1,3})\s*(?:[-–—/)]|\.(?!\d)|:)\s*(.*)$/i;
/** With a "Q" / "Question" / "QCM" prefix the number needs no punctuation: "Q12 La fracture…", "Q24,Le traitement…". */
const Q_PREFIXED = /^(?:q(?:uestion|cm|cs|st)?)\s*(?:n\s*[°o]\s*)?(\d{1,3})\s*(?:[-–—/).:,]\s*|\s+)(\S.*)$/i;
const LONE_NUMBER = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[-.)/:]?$/i;
const LEADING_POINTS = /^\(?\s*\d+(?:[.,]\d+)?\s*(?:pts?|points?)\s*\)?\s*[:.\-–]?\s*/i;
const OPTION_START = /^([A-Ea-e])\s*[-–—.):/,=]\s*(.*)$/;
/** "D Enzymes de type B-lactamase": a capital letter, a space, a capitalised word — only as the expected next option. */
const OPTION_LOOSE = /^([A-E])\s+([A-ZÀ-Ý"'(«].*)$/;
/** OCR reads "B." as "8.": taken as B only where B is the expected next option. */
const OPTION_OCR_B = /^8\s*[.)\-]\s*(.*)$/;
const COMBO_ITEM = /\b([A-E8])\s*(?:[:.)\-–=]\s*)?\(?\s*([1-5](?:\s*[.,+\-/]\s*[1-5])+)\s*\)?/g;
const GRID_PAIR = /(?:^|[\s|])(\d{1,3})\s*[-.:)/]?\s*([A-E]{1,5})(?=$|[\s|,;.])/g;
/** The same pattern without the global flag: `.test()` on a /g regex carries lastIndex from call to call. */
const GRID_PAIR_ONCE = new RegExp(GRID_PAIR.source);
/** A line made only of grid pairs ("1- C", "12. ABDE", "3 A 4 BD 5 E"). */
const GRID_LINE = /^(?:\s*\d{1,3}\s*[-.:)/]?\s*[A-E]{1,5}\s*[.,;|]?)+$/;
/** "Réponse : BD", "Rép juste = A,C" under a question. */
const ANSWER_LINE = /^(?:r[ée]p(?:onses?)?|r)\s*(?:justes?|exactes?|correctes?)?\s*[:=]\s*([A-E](?:\s*[,+\-/ ]?\s*[A-E]){0,4})\s*\.?$/i;
/** The points a "corrigé type" writes next to a right option: "(0,5)", "(1 pt)". */
const POINTS_MARK = /\s*\(\s*(?:0[.,]\d{1,2}|[1-4](?:[.,]\d{1,2})?)\s*(?:pts?|points?)?\s*\)\s*[.…]*\s*$/i;
const FOOTER = /^(?:page\s*\d+(?:\s*(?:\/|sur|de)\s*\d+)?|\d+\s*\/\s*\d+|scann?[ée]e?\s+avec\s+\w+|-\s*\d+\s*-)$/i;
const RUNNING_HEADER = /universit|facult|d[ée]partement|\bnom\b|pr[ée]nom|matricule|\bgroupe\b|\bnote\b|dur[ée]e|corrig|examen|\bemd\b|\bpage\b|ann[ée]e\s+universitaire/i;
const IDENTITY_LINE = /universit|facult|d[ée]partement|\bnom\s*:|pr[ée]nom|matricule/i;
/** Answers under a "Corrigé" heading: three pairs are enough evidence (a document that is only a grid needs as many). */
const MIN_GRID_ENTRIES = 3;
// (?![a-z]) rather than \b: JavaScript's \b sees "é" as a non-word character, so /corrigé\b/ never matches "Corrigé type".
const GRID_HEADING = /\bcorrig[ée]e?s?(?![a-z])|\br[ée]ponses?\s*(?:justes?)?\s*:|\bgrille\b|\bcl[ée]\s+de\s+correction\b/i;
const ORDINAL_SUFFIX = /^(?:[èe]re|[èe]me|ieme|e|er|re)\b/i;
/** A statement shared by the questions that follow: "Exercice 2 :", "Cas clinique n° 1", "Dossier clinique". */
const CONTEXT_START = /^(?:exercice|cas\s+cliniques?|dossier(?:\s+clinique)?|vignette(?:\s+clinique)?|situation\s+clinique|[ée]nonc[ée]\s+commun)\s*(?:n\s*[°o]\s*)?(?:\d{1,2}|[IVX]{1,4})?\s*(?:suite)?\s*(?:\([^)]*\))?\s*[:.\-–]?\s*(.*)$/i;
const CONTEXT_END = /questions?\s+ind[ée]pendantes?|qcm\s+ind[ée]pendants?|hors\s+cas\s+clinique/i;

const RF_CUES = /\(\s*rf\s*\)|\brf\b|r\.\s*fausse|r[ée]ponses?\s+fausses?|propositions?\s+fausses?|\binexactes?\b|\best\s+fausse\b|\bsont\s+fausses\b|\bsauf\b|\bn['’]est\s+pas\b|\bne\s+sont\s+pas\b/i;
const RJ_CUES = /\(\s*rj\s*\)|\brj\b|r\.\s*juste|r[ée]ponses?\s+(?:justes?|exactes?)|propositions?\s+(?:justes?|exactes?)|\best\s+exacte\b|\bsont\s+exactes\b|\best\s+juste\b|\bsont\s+justes\b|\bvraies?\b/i;
const PLURAL_CUES = /la\s+(?:ou|au)\s+les|quel(?:le)?\s*\(\s*s\s*\)|est\s*\(\s*sont\s*\)|\(\s*s\s*\)\s*(?:juste|exacte|fausse|correcte)|r[ée]ponses\s+(?:justes|exactes|fausses)|juste\s*\(\s*s\s*\)|plusieurs\s+r[ée]ponses|cochez\s+(?:la\s+ou\s+)?les\b|toutes?\s+les\s+r[ée]ponses/i;
const SINGLE_CUES = /une\s+seule\s+(?:r[ée]ponse|proposition)|la\s+r[ée]ponse\s+(?:juste|exacte|fausse)|coche[rz]\s+(?:la|une\s+seule)\s+r[ée]ponse|\bqcs\b|association\s+juste/i;
const COMBO_TEXT = /^[1-5](?:\s*[.,+\-/]\s*[1-5])+\.?$/;
/** An option that only cites propositions: "1+3", or a single "4". */
const PROPOSITION_REFERENCE = /^[1-5](?:\s*[.,+\-/]\s*[1-5])*\.?$/;

interface Draft {
  position: number;
  context: string | null;
  stem: string;
  propositions: string[];
  options: ParsedOption[];
  combos: Map<GenomeOptionLabel, number[]> | null;
  last: "stem" | "prop" | "option";
  /** Every line the question was built from, for the out-of-order repair. */
  raw: string[];
  /** "Réponse : BD" written under the question. */
  key: string | null;
  /** Unmarked lines appended to the last option: one of them may be an option whose letter the scan lost. */
  tail: string[];
  /** Letters given to unmarked lines ("B. x" / "Métronidazole" / "D. y" → C = "Métronidazole"). */
  rebuilt: GenomeOptionLabel[];
}

const normalizeLine = (line: string) => line.replace(/\s+/g, " ").trim();

function clean(raw: string): string[] {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u2002\u2003\u2009\u202f\t]/g, " ")
    .replace(/[\u200b\u200e\u200f\ufeff]/g, "")
    // Check boxes printed before options (Wingdings/Symbol glyphs in the private-use area, and the Unicode boxes).
    .replace(/[\ue000-\uf8ff\u2610-\u2612\u25a1\u25a2\u25fb\u25fd\u274f-\u2752]/g, " ")
    // Every dash and minus sign reads as a hyphen.
    .replace(/[\u2010-\u2015\u2212\u23bc\ufe63\uff0d]/g, "-")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, '"')
    .replace(/[\u2018\u2019`\u00b4]/g, "'")
    // A word cut by a line-end hyphen: "mito-\nchondrie".
    .replace(/([a-zà-ÿ])-\n([a-zà-ÿ])/g, "$1$2");
  const lines = text
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line && !FOOTER.test(line));
  // Running page headers: the same header line on every page, kept once (the first, which the scope check reads).
  const seen = new Map<string, number>();
  for (const line of lines) seen.set(line, (seen.get(line) ?? 0) + 1);
  const kept = new Set<string>();
  return lines.filter((line) => {
    if ((seen.get(line) ?? 0) < 2 || !RUNNING_HEADER.test(line) || Q_START.test(line) || OPTION_START.test(line)) return true;
    if (kept.has(line)) return false;
    kept.add(line);
    return true;
  });
}

/** "A. x B. y C. z" in one string → its consecutive options from `fromLetter`; null when the markers don't form a chain of at least two. */
function splitInlineOptions(text: string, fromLetter: number): { head: string; options: ParsedOption[] } | null {
  const markers: { index: number; end: number; letter: number }[] = [];
  const re = /(^|\s)([A-Ea-e])\s*[.)\-:,]\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const letter = m[2].toUpperCase().charCodeAt(0) - 65;
    if (letter !== fromLetter + markers.length) continue;
    markers.push({ index: m.index + m[1].length, end: m.index + m[0].length, letter });
  }
  if (markers.length < 2) return null;
  const options = markers.map((marker, i) => ({
    label: LETTERS[marker.letter],
    text: text.slice(marker.end, i + 1 < markers.length ? markers[i + 1].index : undefined).trim(),
  }));
  return { head: text.slice(0, markers[0].index).trim(), options };
}

/** "1. a 2. b 3.c" in one string → propositions from `from`; null when fewer than two consecutive markers. */
function splitInlineNumbers(text: string, from: number): { head: string; items: string[] } | null {
  const markers: { index: number; end: number }[] = [];
  const re = /(^|[\s/])([1-6])\s*[.)\-]\s*(?=[A-Za-zÀ-ÿ"'(«])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (Number(m[2]) !== from + markers.length) continue;
    markers.push({ index: m.index + m[1].length, end: m.index + m[0].length });
  }
  if (markers.length < 2) return null;
  return {
    head: text.slice(0, markers[0].index).trim(),
    items: markers.map((marker, i) => text.slice(marker.end, i + 1 < markers.length ? markers[i + 1].index : undefined).trim()),
  };
}

/** The type K combinations of a line ("… A:1.3 B:2.4 C:3.5", "A (1+4+3)B (1+2+3)", "A=1+2+3; B=…"), and the text before them. */
function splitCombos(line: string, minItems: number): { head: string; combos: Map<GenomeOptionLabel, number[]> } | null {
  const found: { index: number; letter: GenomeOptionLabel; ocr: boolean; digits: number[] }[] = [];
  for (const m of line.matchAll(COMBO_ITEM)) {
    const ocr = m[1] === "8";
    found.push({ index: m.index ?? 0, letter: (ocr ? "B" : m[1]) as GenomeOptionLabel, ocr, digits: (m[2].match(/[1-5]/g) ?? []).map(Number) });
  }
  if (found.length < minItems) return null;
  const combos = new Map<GenomeOptionLabel, number[]>();
  // Written order is kept ("3+2+1+5+4" answers an ordering question); an OCR "8" is a B only where no real B is written.
  for (const item of found) if (!item.ocr && !combos.has(item.letter)) combos.set(item.letter, Array.from(new Set(item.digits)));
  for (const item of found) if (item.ocr && !combos.has("B")) combos.set("B", Array.from(new Set(item.digits)));
  return { head: line.slice(0, found[0].index).trim(), combos };
}

function mergeCombos(draft: Draft, combos: Map<GenomeOptionLabel, number[]>) {
  if (!draft.combos) draft.combos = new Map();
  for (const [letter, digits] of combos) if (!draft.combos.has(letter)) draft.combos.set(letter, digits);
}

function nextLetter(draft: Draft): number {
  return draft.options.length;
}

function append(draft: Draft, text: string) {
  if (!text) return;
  if (draft.last === "option" && draft.options.length) {
    draft.options[draft.options.length - 1].text += ` ${text}`;
    draft.tail.push(text);
  }
  else if (draft.last === "prop" && draft.propositions.length) draft.propositions[draft.propositions.length - 1] += ` ${text}`;
  else draft.stem = draft.stem ? `${draft.stem} ${text}` : text;
}

function addOptions(draft: Draft, options: ParsedOption[]) {
  for (const option of options) {
    if (option.label !== LETTERS[nextLetter(draft)]) continue;
    draft.options.push(option);
    draft.last = "option";
    draft.tail = [];
  }
}

/** Proposition n's own line, which may carry the following propositions and the combinations ("1. L'intestin. 2. Le muscle… A=1+2+3"). */
function addPropositions(draft: Draft, text: string) {
  const combos = splitCombos(text, 3);
  const body = combos ? combos.head : text;
  const numbers = splitInlineNumbers(` ${body}`, draft.propositions.length + 2);
  if (numbers) draft.propositions.push(numbers.head, ...numbers.items);
  else draft.propositions.push(body);
  draft.last = "prop";
  if (combos) mergeCombos(draft, combos.combos);
}

/** Puts a line's own content into a draft: inline propositions, options, combinations. */
function absorb(draft: Draft, text: string) {
  const combos = splitCombos(text, draft.combos ? 2 : 3);
  if (combos) {
    absorbText(draft, combos.head);
    mergeCombos(draft, combos.combos);
    draft.last = "option";
    return;
  }
  absorbText(draft, text);
}

function absorbText(draft: Draft, text: string) {
  if (!text) return;
  if (draft.options.length === 0 && draft.last !== "option" && !draft.combos) {
    const numbers = splitInlineNumbers(text, draft.propositions.length + 1);
    if (numbers && (draft.stem || numbers.head)) {
      append(draft, numbers.head);
      for (const item of numbers.items) draft.propositions.push(item);
      draft.last = "prop";
      return;
    }
  }
  const inline = splitInlineOptions(text, nextLetter(draft));
  if (inline) {
    append(draft, inline.head);
    addOptions(draft, inline.options);
    return;
  }
  append(draft, text);
}

function stemLooksOpen(draft: Draft): boolean {
  return draft.options.length === 0 && !draft.combos;
}

interface Marker {
  letter: number;
  start: number;
  end: number;
  score: number;
}

/**
 * The options of a question whose lines did not give A–D in order: every
 * plausible marker in the question's whole text is scored (start of line,
 * punctuation, capital letter, after a sentence end), the best one is kept
 * for each letter — in any order, which is what a two-column layout or an OCR
 * shuffle produces — and the result counts only when the letters run from A
 * with no hole and no empty option.
 */
function repairOptions(rawLines: string[], wantFive: boolean): { stem: string; options: ParsedOption[] } | null {
  const text = rawLines.join("\n");
  const candidates: Marker[] = [];
  const re = /(^|[\s(])([A-Ea-e8])(\s*[-–—.):/,=]\s*|\s+)(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const char = m[2];
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    // The next search starts right after this letter, so "A B. x" still sees "B.".
    re.lastIndex = start + 1;
    const punct = /[-–—.):/]/.test(m[3]) ? 2 : /[,=]/.test(m[3]) ? 1 : 0;
    const lineStart = start === 0 || text[start - 1] === "\n";
    const upper = /[A-E]/.test(char);
    if (char === "8" && !(lineStart && punct === 2)) continue;
    if (!upper && char !== "8" && punct < 2) continue;
    if (punct === 0 && !/[A-ZÀ-Ý"'(«]/.test(text[end] ?? "")) continue;
    const before = text.slice(0, start).trimEnd();
    const afterSentence = !before || /[.;:?!)\]]$/.test(before);
    // "E- Aucune…": a dash or a parenthesis glued to a capital letter is a marker, not prose.
    const glued = upper && /^[-–—)]/.test(m[3]) ? 1 : 0;
    const score = (lineStart ? 3 : 0) + punct + (upper ? 1 : 0) + (afterSentence ? 1 : 0) + glued - (char === "8" ? 1 : 0);
    candidates.push({ letter: char === "8" ? 1 : char.toUpperCase().charCodeAt(0) - 65, start, end, score });
  }
  const chosen: Marker[] = [];
  for (let letter = 0; letter < 5; letter += 1) {
    const previous = chosen[chosen.length - 1];
    const pool = candidates.filter((c) => c.letter === letter && !chosen.some((x) => c.start < x.end && x.start < c.end));
    if (!pool.length) break;
    // After the previous letter is likelier (reading order); before it still happens (columns, OCR).
    const rank = (c: Marker) => c.score + (previous && c.start > previous.start ? 1 : 0);
    const best = pool.reduce((a, b) => (rank(b) > rank(a) ? b : a));
    // A fifth option needs a real marker (own line, or after a sentence end): "vitamine E." mid-text is not one.
    if (letter === 4 && wantFive && best.score < 4) break;
    chosen.push(best);
  }
  if (chosen.length < 4) return null;
  const byPosition = [...chosen].sort((a, b) => a.start - b.start);
  const options = chosen.map((marker) => {
    const next = byPosition.find((x) => x.start > marker.start);
    return { label: LETTERS[marker.letter], text: normalizeLine(text.slice(marker.end, next ? next.start : undefined)) };
  });
  if (options.some((o) => !o.text)) return null;
  return { stem: normalizeLine(text.slice(0, byPosition[0].start)), options };
}

export function inferPolarity(stem: string): "rj" | "rf" | null {
  if (RF_CUES.test(stem)) return "rf";
  if (RJ_CUES.test(stem)) return "rj";
  return null;
}

function inferFormat(draft: Draft, stem: string, options: ParsedOption[], headerHint: "qcs" | "qcm" | null): GenomeFormat {
  const comboOptions = options.length >= 4 && options.every((o) => PROPOSITION_REFERENCE.test(o.text));
  if (draft.propositions.length >= 4 && (draft.combos || comboOptions)) return "combinaison";
  if (options.length === 0) return "qroc";
  if (PLURAL_CUES.test(stem)) return "qcm";
  if (SINGLE_CUES.test(stem)) return "qcs";
  return headerHint ?? "qcs";
}

function finalize(draft: Draft, headerHint: "qcs" | "qcm" | null, wantFive: boolean): ParsedQuestion {
  const issues: string[] = [];
  let options = draft.options.map((o) => ({ ...o, text: o.text.trim() }));
  let stem = draft.stem;
  if (draft.combos) {
    options = LETTERS.filter((l) => draft.combos!.has(l)).map((label) => ({ label, text: draft.combos!.get(label)!.join("+") }));
  } else if (options.length < 4 || (options.length === 4 && wantFive)) {
    const repaired = repairOptions(draft.raw, wantFive);
    if (repaired && repaired.options.length > options.length) {
      options = repaired.options;
      stem = repaired.stem;
      issues.push("options remises en ordre");
    }
  }
  stem = stem.trim();
  if (draft.propositions.length >= 3 && draft.propositions.length < 5 && (draft.combos || options.every((o) => PROPOSITION_REFERENCE.test(o.text)))) {
    const resplit = splitInlineNumbers(draft.propositions.map((p, i) => `${i + 1}. ${p}`).join(" "), 1);
    if (resplit && resplit.items.length > draft.propositions.length && resplit.items.length <= 5) draft.propositions = resplit.items;
  }
  const format = inferFormat(draft, stem, options, headerHint);
  if (format === "combinaison") options = options.map((o) => ({ ...o, text: o.text.replace(/[.,\-/\s]+/g, "+").replace(/^\+|\+$/g, "") }));
  if (draft.rebuilt.length) issues.push(`option ${draft.rebuilt.join(", ")} sans lettre : reconstituée`);
  let confidence = issues.length ? 0.9 : 1;
  if (format !== "qroc") {
    if (options.length < 4) {
      issues.push(`${options.length} option(s) lue(s)`);
      confidence -= 0.45;
    } else if (options.length === 4 && wantFive) {
      issues.push("4 options (A–D) dans une épreuve à 5");
      confidence -= 0.1;
    }
    if (options.some((o) => !o.text)) {
      issues.push("option vide");
      confidence -= 0.2;
    }
  } else {
    issues.push("aucune option lue : QROC ou mise en page non reconnue");
    confidence -= 0.35;
  }
  if (format === "combinaison" && draft.propositions.length !== 5) {
    issues.push(`${draft.propositions.length} proposition(s) au lieu de 5`);
    confidence -= 0.2;
  }
  if (stem.length < 15 && !draft.context) {
    issues.push("énoncé très court");
    confidence -= 0.2;
  }
  if (!PLURAL_CUES.test(stem) && !SINGLE_CUES.test(stem) && format !== "combinaison" && format !== "qroc" && !headerHint) {
    issues.push("format déduit par défaut");
    confidence -= 0.1;
  }
  return {
    position: draft.position,
    context: draft.context,
    stem,
    propositions: draft.propositions.map((p) => p.trim()).filter(Boolean),
    options,
    format,
    polarity: inferPolarity(stem),
    confidence: Math.max(0, Math.round(confidence * 100) / 100),
    issues,
  };
}

function normalizeAnswer(letters: string): string {
  return Array.from(new Set(letters.toUpperCase().replace(/[^A-E]/g, "").split("")))
    .sort()
    .join("");
}

/**
 * Answer keys written in a text: pairs ("12 AD", "3- C", "4. ABDE", "5/B")
 * and two-row tables (a row of question numbers, then a row of answers).
 * Question number → letters, normalized (sorted, once each).
 */
export function parseAnswerGrid(text: string): { grid: Record<number, string>; conflicts: number[] } {
  const grid: Record<number, string> = {};
  const conflicts: number[] = [];
  const put = (n: number, letters: string) => {
    if (n < 1 || n > 400) return;
    const answer = normalizeAnswer(letters);
    if (!answer) return;
    if (grid[n] && grid[n] !== answer) conflicts.push(n);
    else grid[n] = answer;
  };
  const lines = text.split("\n").map(normalizeLine);
  for (let i = 0; i < lines.length; i += 1) {
    // A table: "1 2 3 4 5 6" then "A BD C E AB D" (with "Q" / "Rép" labels allowed in front).
    const numbers = lines[i].replace(/^(?:q(?:uestions?)?|n°|num[ée]ros?)\s*[:|]?\s*/i, "").split(/[\s|]+/).filter(Boolean);
    const answers = (lines[i + 1] ?? "").replace(/^(?:r[ée]p(?:onses?)?|r)\s*[:|]?\s*/i, "").split(/[\s|]+/).filter(Boolean);
    if (
      numbers.length >= 3 &&
      numbers.every((t, k) => /^\d{1,3}$/.test(t) && (k === 0 || Number(t) === Number(numbers[k - 1]) + 1)) &&
      answers.length === numbers.length &&
      answers.every((t) => /^[A-E]{1,5}$/.test(t))
    ) {
      numbers.forEach((t, k) => put(Number(t), answers[k]));
      i += 1;
      continue;
    }
    for (const m of lines[i].matchAll(GRID_PAIR)) put(Number(m[1]), m[2]);
  }
  return { grid, conflicts };
}

/**
 * Where the questions end and a trailing answer grid begins: after a heading
 * ("Corrigé", "Réponses :") followed mostly by grid pairs, or at a final run
 * of pair-only lines with no heading at all. Null when there is no grid.
 */
function findGrid(lines: string[]): { questionsEnd: number; gridFrom: number } | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!GRID_HEADING.test(lines[i])) continue;
    const rest = lines.slice(i + 1);
    if (!rest.length) continue;
    const pairs = Object.keys(parseAnswerGrid(rest.join("\n")).grid).length;
    const wordy = rest.filter((l) => l.split(" ").length > 8 && !GRID_PAIR_ONCE.test(` ${l} `)).length;
    if (pairs >= MIN_GRID_ENTRIES && pairs >= wordy * 2) return { questionsEnd: i, gridFrom: i + 1 };
  }
  let start = lines.length;
  while (start > 0 && GRID_LINE.test(lines[start - 1])) start -= 1;
  // Without a heading, more evidence: five pairs at least.
  if (start < lines.length && Object.keys(parseAnswerGrid(lines.slice(start).join("\n")).grid).length >= 5) return { questionsEnd: start, gridFrom: start };
  return null;
}

function newDraft(position: number, context: string | null): Draft {
  return { position, context, stem: "", propositions: [], options: [], combos: null, last: "stem", raw: [], key: null, tail: [], rebuilt: [] };
}

/** Parses an exam's text: its header, its questions, and the answer key the document carries (if any). */
export function parseExamText(raw: string): ParsedExam {
  const allLines = clean(raw);
  const warnings: string[] = [];
  const gridAt = findGrid(allLines);
  const lines = gridAt ? allLines.slice(0, gridAt.questionsEnd) : allLines;
  const gridText = gridAt ? allLines.slice(gridAt.gridFrom).join("\n") : "";

  let headerLines: string[] = [];
  let drafts: Draft[] = [];
  let current: Draft | null = null;
  let expected = 1;
  /** The statement of the exercise / clinical case being read, shared by its questions. */
  let context: string | null = null;
  let readingContext = false;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    // A question number alone on its line, its text on the next one ("12" / "Le tendon prépubien :").
    const lone = line.match(LONE_NUMBER);
    if (lone) {
      const next = lines[i + 1] ?? "";
      const mergeable = next.length >= 8 && !ORDINAL_SUFFIX.test(next) && !IDENTITY_LINE.test(next) && !OPTION_START.test(next) && !Q_START.test(next);
      if (Number(lone[1]) === expected && mergeable) {
        line = `${lone[1]}- ${next}`;
        i += 1;
      } else {
        // A page number or a stray digit — kept only in the header, where "3" / "ème année" still says the year.
        if (!current) headerLines.push(line);
        continue;
      }
    }
    const q = line.match(Q_START) ?? line.match(Q_PREFIXED);
    if (q) {
      const n = Number(q[1]);
      const rest = (q[2] ?? "").replace(LEADING_POINTS, "").trim();
      // Header noise read as a question ("3- ème année…") is given back to the header when a real question 1 follows before any option.
      if (n === 1 && current && current.position !== 1 && drafts.concat(current).every(stemLooksOpen)) {
        headerLines = headerLines.concat(...drafts.map((d) => d.raw), current.raw);
        drafts = [];
        current = null;
        expected = 1;
      }
      if (current && stemLooksOpen(current) && n === current.propositions.length + 1 && n <= 5 && current.stem) {
        current.raw.push(line);
        addPropositions(current, rest);
        continue;
      }
      const ready = !current || current.options.length > 0 || Boolean(current.combos) || n === expected;
      const plausible = current || drafts.length > 0 || n === 1 || (n <= 3 && rest.split(" ").length >= 3);
      if (ready && plausible && n >= expected && n <= expected + 3) {
        if (current) drafts.push(current);
        if (n > expected) warnings.push(`Question(s) ${expected}${n - 1 > expected ? `-${n - 1}` : ""} introuvable(s) avant la question ${n}.`);
        readingContext = false;
        current = newDraft(n, context);
        current.raw.push(rest);
        absorb(current, rest);
        expected = n + 1;
        continue;
      }
    }
    const contextStart = line.match(CONTEXT_START);
    if (contextStart) {
      if (current) drafts.push(current);
      current = null;
      context = (contextStart[1] ?? "").trim();
      readingContext = true;
      continue;
    }
    if (CONTEXT_END.test(line)) {
      if (current) drafts.push(current);
      current = null;
      context = null;
      readingContext = false;
      continue;
    }
    if (!current) {
      if (readingContext) context = context ? `${context} ${line}` : line;
      else headerLines.push(line);
      continue;
    }
    current.raw.push(line);
    const answer = line.match(ANSWER_LINE);
    if (answer && (current.options.length >= 4 || current.combos)) {
      current.key = normalizeAnswer(answer[1]);
      continue;
    }
    const combos = splitCombos(line, current.combos ? 2 : 3);
    if (combos) {
      append(current, combos.head);
      mergeCombos(current, combos.combos);
      current.last = "option";
      continue;
    }
    const expectedLetter = LETTERS[nextLetter(current)];
    let option: { letter: string; text: string; line: string } | null = null;
    const strict = line.match(OPTION_START);
    if (strict) option = { letter: strict[1].toUpperCase(), text: strict[2] ?? "", line };
    if (!option && expectedLetter) {
      const loose = line.match(OPTION_LOOSE);
      // A loose "A" ("A Sont des formes…") only when B follows: "A L'examen clinique…" is usually a sentence.
      const followed = /^(?:[Bb]\s*[-–—.):/,]|B\s+[A-ZÀ-Ý])/.test(lines[i + 1] ?? "");
      if (loose && (loose[1] !== "A" || (current.stem && followed))) option = { letter: loose[1], text: loose[2], line };
    }
    if (!option && expectedLetter === "B") {
      const ocr = line.match(OPTION_OCR_B);
      if (ocr) option = { letter: "B", text: ocr[1] ?? "", line: `B${line.slice(1)}` };
    }
    // The scan lost a letter: "B. Voriconazole" / "Métronidazole" / "D. Amphotéricine" — the unmarked line is C.
    if (option && expectedLetter && expectedLetter !== "A" && option.letter === LETTERS[nextLetter(current) + 1] && current.tail.length) {
      const lost = current.tail[current.tail.length - 1];
      const previous = current.options[current.options.length - 1];
      if (previous.text.endsWith(` ${lost}`) && lost.length >= 2) {
        previous.text = previous.text.slice(0, previous.text.length - lost.length - 1);
        addOptions(current, [{ label: expectedLetter, text: lost }]);
        current.rebuilt.push(expectedLetter);
        addOptions(current, [{ label: option.letter as GenomeOptionLabel, text: option.text }]);
        continue;
      }
    }
    if (option && option.letter === expectedLetter) {
      const inline = splitInlineOptions(option.line, nextLetter(current));
      if (inline && inline.options.length > 1) addOptions(current, inline.options);
      else addOptions(current, [{ label: expectedLetter, text: option.text }]);
      continue;
    }
    absorbText(current, line);
  }
  if (current) drafts.push(current);

  const header = headerLines.join("\n");
  const headerSaysQcm = /\bqcm\b/i.test(header) && !/\bqcs\b/i.test(header);
  const headerHint: "qcs" | "qcm" | null = /\bqcs\b/i.test(header) || SINGLE_CUES.test(header) ? "qcs" : headerSaysQcm || PLURAL_CUES.test(header) ? "qcm" : null;
  // The paper's usual option count: when most questions have five, a question read with four lost one.
  const counted = drafts.filter((d) => !d.combos && d.options.length >= 4);
  const wantFive = counted.length >= 3 && counted.filter((d) => d.options.length === 5).length / counted.length >= 0.6;
  const questions = drafts.map((d) => finalize(d, headerHint, wantFive));

  // The key: a grid after the questions (or a document that is only a grid), "Réponse : X" lines, a corrigé type's marks.
  let answerGrid: Record<number, string> = {};
  let fromGrid = false;
  let fromInline = false;
  const gridSource = gridText || (questions.filter((q) => q.options.length >= 4).length === 0 ? allLines.join("\n") : "");
  if (gridSource) {
    const { grid, conflicts } = parseAnswerGrid(gridSource);
    if (Object.keys(grid).length >= MIN_GRID_ENTRIES) {
      answerGrid = grid;
      fromGrid = true;
    }
    if (conflicts.length) warnings.push(`Grille : réponses contradictoires pour ${conflicts.slice(0, 5).join(", ")}.`);
  }
  const corrigeType = /\bcorrig[ée]/i.test(header);
  drafts.forEach((draft, i) => {
    const q = questions[i];
    let key = draft.key;
    if (corrigeType && q.format !== "combinaison") {
      const marked = q.options.filter((o) => POINTS_MARK.test(o.text));
      if (!key && marked.length) key = marked.map((o) => o.label).join("");
      q.options = q.options.map((o) => ({ ...o, text: o.text.replace(POINTS_MARK, "").trim() }));
    }
    if (key && !answerGrid[q.position]) {
      answerGrid[q.position] = key;
      fromInline = true;
    }
  });

  const complete = questions.filter((q) => q.confidence >= 0.8).length;
  const mean = questions.length ? questions.reduce((s, q) => s + q.confidence, 0) / questions.length : 0;
  const holes = warnings.filter((w) => w.startsWith("Question(s)")).length;
  const withOptions = questions.filter((q) => q.options.length >= 4).length;
  const gridEntries = Object.keys(answerGrid).length;
  return {
    header,
    questions,
    answerGrid,
    answerSource: fromGrid && fromInline ? "mixed" : fromGrid ? "grid" : fromInline ? "inline" : null,
    warnings,
    stats: {
      questions: questions.length,
      complete,
      qcs: questions.filter((q) => q.format === "qcs").length,
      qcm: questions.filter((q) => q.format === "qcm").length,
      combinaison: questions.filter((q) => q.format === "combinaison").length,
      qroc: questions.filter((q) => q.format === "qroc").length,
      meanConfidence: Math.round(mean * 100) / 100,
      gridEntries,
      layoutSuspect: questions.length > 0 && (holes >= 2 || complete / questions.length < 0.6),
      looksLikeExam: (questions.length >= 5 && withOptions / questions.length >= 0.5) || gridEntries >= 5,
    },
  };
}
