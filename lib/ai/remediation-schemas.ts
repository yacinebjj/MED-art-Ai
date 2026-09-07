import { z } from "zod";

export const RemediationPlanSchema = z.object({
  weakSpots: z
    .array(
      z.object({
        concept: z.string().min(3),
        courseTitle: z.string().min(1),
        priority: z.enum(["haute", "moyenne", "basse"]),
        whyItMatters: z.string().min(5),
        actionableAdvice: z.string().min(5),
      })
    )
    .min(1),
});
