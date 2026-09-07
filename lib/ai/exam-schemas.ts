import { z } from "zod";

/**
 * Structural validation of the generated exam — this IS the hard backstop
 * against LLM laziness the route's own comment describes: the prompt asks
 * for 40-60 questions, but a prompt instruction is a request, not a
 * guarantee. `.min(40).max(60)` here means a response with fewer questions
 * fails zod validation and never reaches the database — the route treats
 * that exactly like any other generation failure (refund quota, 502), never
 * silently saving a too-short exam as if it were valid.
 */
const ExamOptionSchema = z
  .object({
    label: z.enum(["A", "B", "C", "D", "E"]),
    text: z.string().min(1),
    isCorrect: z.boolean(),
    explanation: z.string().min(10),
  })
  .strict();

export const ExamQuestionSchema = z
  .object({
    vignette: z.string().min(30),
    options: z
      .array(ExamOptionSchema)
      .length(5)
      .refine((options) => options.filter((o) => o.isCorrect).length === 1, {
        message: "Chaque question doit avoir EXACTEMENT une seule bonne réponse.",
      }),
    weakPointTag: z.string().min(3),
  })
  .strict();

export const ExamGenerationSchema = z.object({
  questions: z.array(ExamQuestionSchema).min(40).max(60),
});

/**
 * Sequential-batching architecture (app/api/exam/generate/route.ts): the
 * exam is now built from independent OpenRouter calls of a fixed question
 * count each (currently 5 batches of 8, see route.ts's TOTAL_BATCHES/
 * QUESTIONS_PER_BATCH), concatenated into one 40-question exam — replacing
 * the single 40-60-question call that relied on the model not stopping
 * early. `.length(8)` is the per-batch backstop: a short/malformed batch
 * fails validation and triggers THAT batch's retry, never a silent short
 * exam. Keep this number in sync with route.ts's QUESTIONS_PER_BATCH if
 * that ever changes again.
 */
export const ExamBatchSchema = z.object({
  questions: z.array(ExamQuestionSchema).length(8),
});

/**
 * Extracted "ADN de style" of a student-uploaded reference exam (Examen
 * Guidé par le Style Prof — app/api/exam/analyze-reference/route.ts). Pure
 * descriptive text/array fields, never medical content itself — this is
 * folded into buildExamStyleAdaptedSystemPrompt (lib/ai/exam-prompts.ts) as
 * prompt text, never persisted alongside a generated question (ExamQuestionSchema
 * stays .strict() with no style metadata on individual questions).
 */
export const ExamStyleProfileSchema = z
  .object({
    questionTypeDistribution: z.string().min(10),
    trapPatterns: z.array(z.string().min(5)).min(1).max(8),
    optionFormatConventions: z.string().min(5),
    difficultyAndVocabulary: z.string().min(10),
    summary: z.string().min(10).max(1000),
  })
  .strict();

export type ExamStyleProfile = z.infer<typeof ExamStyleProfileSchema>;
