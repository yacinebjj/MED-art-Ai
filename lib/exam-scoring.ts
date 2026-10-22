/**
 * Scoring for a completed exam attempt — shared by the server
 * (app/api/exam/attempts/route.ts, where the SAVED score and wrong-question
 * list are always recomputed from the exam's own canonical content, never
 * trusted from the client's request body) and the exam page's instant
 * on-screen correction, so the two can never disagree.
 *
 * One rule for every question format (lib/exam-formats.ts): the set of
 * ticked labels must equal the set of options marked isCorrect — a single
 * letter for a QCS or a combination question, all of them and nothing more
 * for a QCM ("tout ou rien"). An answer is stored as a string: "B", or
 * "A,C" for a QCM — so every attempt saved before the formats existed (a
 * single letter) scores exactly as it always did.
 */

export interface ExamOption {
  label: string;
  text: string;
  isCorrect: boolean;
  explanation: string;
}

export interface ExamProposition {
  text: string;
  isTrue: boolean;
  explanation: string;
}

export interface ExamQuestion {
  id: string;
  vignette: string;
  options: ExamOption[];
  weakPointTag: string;
  format?: string;
  polarity?: string;
  propositions?: ExamProposition[];
}

export interface WrongQuestionDetail {
  vignette: string;
  correctAnswerText: string;
  weakPointTag: string;
}

export interface ExamAttemptResult {
  score: number;
  totalQuestions: number;
  wrongQuestions: WrongQuestionDetail[];
}

const ANSWER_LABELS = ["A", "B", "C", "D", "E"];

function cleanLabels(labels: string[]): string[] {
  return Array.from(new Set(labels.map((label) => label.trim().toUpperCase()).filter((label) => ANSWER_LABELS.includes(label)))).sort();
}

/** A stored answer → the ticked labels, in A→E order: "B" → ["B"], "A,C" → ["A", "C"]; anything else → []. */
export function parseAnswerLabels(answer: unknown): string[] {
  return typeof answer === "string" ? cleanLabels(answer.split(",")) : [];
}

/** The stored form of a set of ticked labels ("A,C") — null when nothing is ticked. */
export function serializeAnswerLabels(labels: string[]): string | null {
  const clean = cleanLabels(labels);
  return clean.length > 0 ? clean.join(",") : null;
}

export function correctAnswerLabels(question: { options: { label: string; isCorrect: boolean }[] }): string[] {
  return cleanLabels(question.options.filter((option) => option.isCorrect).map((option) => option.label));
}

/** True only when the ticked set is exactly the set of options to tick. */
export function isAnswerCorrect(question: { options: { label: string; isCorrect: boolean }[] }, answer: unknown): boolean {
  const correct = correctAnswerLabels(question);
  const given = parseAnswerLabels(answer);
  return correct.length > 0 && given.length === correct.length && given.every((label, index) => label === correct[index]);
}

/** Recomputes an attempt's score and wrong-question detail from the exam's own questions + the submitted answers. An unanswered question counts as wrong, same as the client-side logic. */
export function scoreExamAttempt(
  questions: ExamQuestion[],
  answers: Record<string, string | null | undefined>
): ExamAttemptResult {
  let score = 0;
  const wrongQuestions: WrongQuestionDetail[] = [];

  for (const question of questions) {
    if (isAnswerCorrect(question, answers[question.id])) {
      score++;
      continue;
    }

    const correctOptions = question.options.filter((option) => option.isCorrect);
    wrongQuestions.push({
      vignette: question.vignette,
      correctAnswerText:
        correctOptions.length > 0
          ? correctOptions.map((option) => `${option.label}. ${option.text} — ${option.explanation}`).join(" / ")
          : "(réponse non disponible)",
      weakPointTag: question.weakPointTag,
    });
  }

  return { score, totalQuestions: questions.length, wrongQuestions };
}
