/**
 * Server-side scoring for a completed exam attempt (app/api/exam/attempts/
 * route.ts) — the exact same "correct option = the one with isCorrect"
 * logic app/dashboard/module/[id]/exam/page.tsx already computes client-side
 * for the instant on-screen correction, factored out here so the SAVED
 * score/wrong-question list is always recomputed from the exam's own
 * canonical content, never trusted from the client's request body.
 */

export interface ExamOption {
  label: string;
  text: string;
  isCorrect: boolean;
  explanation: string;
}

export interface ExamQuestion {
  id: string;
  vignette: string;
  options: ExamOption[];
  weakPointTag: string;
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

/** Recomputes an attempt's score and wrong-question detail from the exam's own questions + the submitted answers. A question with no matching answer (unanswered) counts as wrong, same as the existing client-side logic. */
export function scoreExamAttempt(
  questions: ExamQuestion[],
  answers: Record<string, string | null | undefined>
): ExamAttemptResult {
  let score = 0;
  const wrongQuestions: WrongQuestionDetail[] = [];

  for (const question of questions) {
    const correctOption = question.options.find((option) => option.isCorrect);
    const given = answers[question.id];

    if (correctOption && given === correctOption.label) {
      score++;
      continue;
    }

    wrongQuestions.push({
      vignette: question.vignette,
      correctAnswerText: correctOption
        ? `${correctOption.label}. ${correctOption.text} — ${correctOption.explanation}`
        : "(réponse non disponible)",
      weakPointTag: question.weakPointTag,
    });
  }

  return { score, totalQuestions: questions.length, wrongQuestions };
}
