import { z } from "zod";

/**
 * One study item on one day of the generated plan. `moduleId` is nullable —
 * the AI is given the student's module titles with their ids, but a manual
 * course list (no curriculum module behind it) has nothing to attach.
 *
 * NOT `.strict()` — a long plan (30+ days, hundreds of items) only needs ONE
 * item anywhere to carry a stray extra field (CHEAP_MODEL/deepseek
 * occasionally adds one, e.g. a spontaneous "day" or "topic" echo) before
 * `.strict()` fails the ENTIRE plan over a single harmless key. Zod's
 * default behavior silently drops unknown keys instead — nothing downstream
 * ever reads more than the named fields, so there's no correctness cost.
 */
const PlanItemSchema = z.object({
  moduleId: z.number().int().nullable(),
  title: z.string().min(1),
  hours: z.number().min(0.25).max(16),
  note: z.string().optional(),
});

/** A rest day is simply OMITTED from `days` entirely — every date present here has real work on it. Not `.strict()` — see PlanItemSchema's comment. */
export const PlanDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La date doit être au format AAAA-MM-JJ."),
  items: z.array(PlanItemSchema).min(1),
});

/** POST /api/study-planner/generate — first generation from the student's config. */
export const StudyPlanGenerationSchema = z.object({
  /** The coach's opening message — strict-but-encouraging framing shown above the timeline. */
  coachMessage: z.string().min(10),
  days: z.array(PlanDaySchema).min(1),
});

/** POST /api/study-planner/generate with a refinement message — same plan shape, plus the conversational reply. */
export const StudyPlanRefinementSchema = z.object({
  assistantReply: z.string().min(1),
  days: z.array(PlanDaySchema).min(1),
});
