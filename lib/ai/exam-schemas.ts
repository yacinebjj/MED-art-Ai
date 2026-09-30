import { z } from "zod";

/**
 * Structural validation of the generated exam — this IS the hard backstop
 * against LLM laziness the route's own comment describes: the prompt asks
 * for 40-60 questions, but a prompt instruction is a request, not a
 * guarantee. A response landing below this floor fails zod validation and
 * never reaches the database — the route treats that exactly like any other
 * generation failure (refund quota, 502), never silently saving a too-short
 * exam as if it were valid.
 *
 * FLOOR RELAXED 40 -> 30, 2026-09-30, after a real production report on a
 * large (30-40+ course) exam: EXAM_TARGET_TOTAL in the route stays 40 (still
 * the number pooling/generation actively aims for, and the route's own
 * gap-filler top-up still tries to reach it before ever reaching this
 * schema) — but a REQUEST-level `.min(40)` meant that if the combined result
 * legitimately landed a little short even after that top-up (a genuinely
 * unlucky run of individually-malformed questions across several courses,
 * now recoverable per-question rather than per-batch — see
 * generateExamBatch's own comment in the route), the entire exam, including
 * every one of the 34-38 perfectly valid questions it DID produce, was
 * discarded outright rather than served. 30 (75% of the 40-question target)
 * is chosen as a floor still meaningful for a real "Semaine Bloquée" révision
 * session, not an arbitrary loosening — this is RELAXED, not REMOVED: a
 * response that's this short is still a real signal something went
 * genuinely wrong upstream (see the route's own "still reachable,
 * deliberately" comment), and still fails cleanly rather than being served.
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
  questions: z.array(ExamQuestionSchema).min(30).max(60),
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
