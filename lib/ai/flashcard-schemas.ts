import { z } from "zod";

export const FlashcardGenerationSchema = z.object({
  flashcards: z
    .array(
      z.object({
        question: z.string().min(5),
        answer: z.string().min(2),
      })
    )
    .min(1),
});
