/**
 * SHARED QUESTION BANK — the per-course side of the Examen de Module
 * (app/api/exam/run). Every validated question an exam with a bank profile
 * (lib/exam-bank-profiles.ts: the canonical exam, or a sealed reference-exam
 * archetype) generates is filed under the course it was written from, in
 * exam_harvested_qcms (lib/exam-harvested-qcms.ts), keyed by that course's
 * content and tagged with the profile: any later exam of the same profile
 * that includes the course — any student, any selection of courses — reuses
 * it at 0 tokens, and only what the bank cannot cover is generated (then
 * filed in turn, so the bank deepens with use). A reference-exam profile
 * without a valid seal has no bank.
 *
 * This module holds the two decisions that keep that bank clean:
 *  - ATTRIBUTION: a job over several courses must say which course each
 *    question comes from. The model names it ("sourceCourse", requested by
 *    buildExamSourceAttributionInstruction); verifySourceCourse then checks
 *    the claim against each course's own vocabulary and refuses any claim the
 *    text contradicts. An unattributable question still goes into the exam
 *    it was generated for — it is only kept out of the bank, never misfiled.
 *  - SEEN QUESTIONS: an exam never hands a student a question they were
 *    already given in this module (loadSeenQuestionKeys), so a repeated
 *    generation draws other bank questions, or generates new ones that then
 *    deepen the bank for everyone.
 */

import { normalizeText } from "@/lib/content-similarity";
import { examQuestionKey, type ExamQuestion } from "@/lib/exam-pooling";
import type { ExamCourseInput } from "@/lib/ai/exam-prompts";
import type { SupabaseAdmin } from "@/lib/exam-generation";

// ─── attribution ─────────────────────────────────────────────────────────

/** Words shorter than this, and the words below, say nothing about which course a question comes from. */
const MIN_WORD_LENGTH = 4;
const NEUTRAL_WORDS = new Set([
  "dans", "avec", "pour", "sans", "sous", "chez", "entre", "vers", "selon", "lors", "contre", "depuis", "pendant", "avant", "après",
  "plus", "moins", "très", "trop", "bien", "aussi", "ainsi", "donc", "mais", "comme", "alors", "encore", "toujours", "jamais",
  "souvent", "parfois", "déjà", "cette", "celle", "celui", "ceux", "celles", "leur", "leurs", "elle", "elles", "nous", "vous",
  "dont", "quel", "quelle", "quels", "quelles", "lequel", "laquelle", "lesquels", "lesquelles", "tout", "tous", "toute", "toutes",
  "autre", "autres", "même", "mêmes", "être", "avoir", "sont", "était", "étaient", "sera", "seront", "fait", "font", "faire",
  "peut", "peuvent", "doit", "doivent", "faut", "chaque", "plusieurs", "certains", "certaines", "aucun", "aucune", "parmi",
  "suivant", "suivante", "suivants", "suivantes", "proposition", "propositions", "exacte", "exactes", "inexacte", "inexactes",
  "juste", "justes", "fausse", "fausses", "vrai", "vraie", "faux", "réponse", "réponses", "question", "questions", "concernant",
  "correct", "correcte", "correctes", "incorrect", "incorrecte", "option", "options", "explication", "cours", "texte", "source",
  "notion", "notions", "cocher", "combinaison", "combinaisons", "énoncé", "dite", "dites",
]);

/** Without a usable claim, the best course must have this many of its own words, and twice the runner-up's. */
const MIN_LEXICAL_ONLY_WORDS = 4;

function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of normalizeText(text).split(" ")) {
    if (word.length >= MIN_WORD_LENGTH && !/^\d+$/.test(word) && !NEUTRAL_WORDS.has(word)) words.add(word);
  }
  return words;
}

/** Everything a question says, as one text — what the model wrote from its source course. */
function questionText(question: ExamQuestion): string {
  const parts = [question.vignette, question.weakPointTag];
  for (const option of question.options) parts.push(option.text, option.explanation);
  for (const proposition of question.propositions ?? []) parts.push(proposition.text, proposition.explanation);
  return parts.join(" ");
}

/** Per course: the words found in this course's text (and title) and in no other course of the job. */
function distinctiveVocabularies(courses: ExamCourseInput[]): Set<string>[] {
  const vocabularies = courses.map((course) => contentWords(`${course.title} ${course.text}`));
  const occurrences = new Map<string, number>();
  for (const vocabulary of vocabularies) for (const word of Array.from(vocabulary)) occurrences.set(word, (occurrences.get(word) ?? 0) + 1);
  return vocabularies.map((vocabulary) => new Set(Array.from(vocabulary).filter((word) => occurrences.get(word) === 1)));
}

/** How many of each course's distinctive words the question uses, in course order. */
export function sourceEvidence(question: ExamQuestion, courses: ExamCourseInput[]): number[] {
  const words = contentWords(questionText(question));
  return distinctiveVocabularies(courses).map((vocabulary) => Array.from(words).filter((word) => vocabulary.has(word)).length);
}

/**
 * The model's "sourceCourse" (1-based, as numbered in the prompt), as a
 * 0-based index — null when absent or out of range. Accepts 2, "2" or
 * "Cours 2", the ways a model writes the same number.
 */
export function readSourceCourse(raw: unknown, courseCount: number): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).sourceCourse;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number((value.match(/\d+/) ?? [""])[0]) : NaN;
  return Number.isInteger(number) && number >= 1 && number <= courseCount ? number - 1 : null;
}

/**
 * The course a generated question may be filed under in the shared bank, as
 * an index into `courses` (the job's inputs, in prompt order) — or null when
 * it must stay out of the bank.
 *  - one course: always that course;
 *  - a claim from the model stands only when the claimed course has strictly
 *    more of its own words in the question than any other course (or when no
 *    course has any — nothing contradicts it); otherwise it is refused,
 *    never moved to another course;
 *  - no usable claim: filed only when one course's vocabulary is decisive.
 */
export function verifySourceCourse(question: ExamQuestion, claimed: number | null, courses: ExamCourseInput[]): number | null {
  if (courses.length === 1) return 0;
  if (courses.length === 0) return null;
  const evidence = sourceEvidence(question, courses);
  if (claimed !== null && claimed >= 0 && claimed < courses.length) {
    const rival = Math.max(...evidence.filter((_, index) => index !== claimed));
    return evidence[claimed] > rival || (evidence[claimed] === 0 && rival === 0) ? claimed : null;
  }
  const ranked = evidence.map((words, index) => ({ words, index })).sort((a, b) => b.words - a.words);
  const [best, runnerUp] = ranked;
  return best.words >= MIN_LEXICAL_ONLY_WORDS && best.words >= 2 * runnerUp.words ? best.index : null;
}

// ─── questions a student was already given ───────────────────────────────

/** Recent exams of this module whose questions are never handed to the same student again. */
const SEEN_HISTORY_EXAMS = 20;

/** Adds the key (examQuestionKey) of every question of a saved exam's content ({ questions: [...] }) to `keys`. */
function collectQuestionKeys(content: unknown, keys: Set<string>): void {
  const questions = content && typeof content === "object" ? (content as { questions?: unknown }).questions : null;
  if (!Array.isArray(questions)) return;
  for (const question of questions) {
    const vignette = question && typeof question === "object" ? (question as { vignette?: unknown }).vignette : null;
    if (typeof vignette === "string" && vignette.trim()) keys.add(examQuestionKey(question as { vignette: string; options?: unknown; propositions?: unknown }));
  }
}

/**
 * Keys (examQuestionKey) of every question in this student's recent exams of
 * this module. Fail-open: a read failure returns an empty set — the exam is
 * then built without the repeat check rather than not built at all.
 */
export async function loadSeenQuestionKeys(supabase: SupabaseAdmin, userId: string, moduleId: number): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const { data, error } = await supabase
      .from("module_generated_exams")
      .select("content")
      .eq("user_id", userId)
      .eq("curriculum_module_id", moduleId)
      .order("created_at", { ascending: false })
      .limit(SEEN_HISTORY_EXAMS);
    if (error) {
      console.warn("[exam-question-bank] Historique d'examens illisible — examen construit sans le filtre anti-répétition:", error.message);
      return keys;
    }
    for (const row of (data ?? []) as { content: unknown }[]) collectQuestionKeys(row.content, keys);
  } catch (error) {
    console.warn("[exam-question-bank] Historique d'examens illisible (exception):", error instanceof Error ? error.message : error);
  }
  return keys;
}

/** True when a stored exam (cache row, variation) contains a question the student was already given. */
export function examRepeatsSeenQuestion(content: unknown, seen: ReadonlySet<string>): boolean {
  if (seen.size === 0) return false;
  const keys = new Set<string>();
  collectQuestionKeys(content, keys);
  return Array.from(keys).some((key) => seen.has(key));
}
