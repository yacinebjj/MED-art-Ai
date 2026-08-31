/**
 * "Smart Aggregation" for Examen de Module (see app/api/exam/generate/route.ts)
 * — pulls already-generated QCMs from each selected course's own Studio QCM
 * tile (studio_courses.qcms) instead of always generating a full fresh exam.
 *
 * REAL FORMAT CONFLICT (confirmed by direct comparison, not assumed): Studio's
 * QcmItem (lib/types.ts) and the Exam's ExamQuestionSchema
 * (lib/ai/exam-schemas.ts) are structurally incompatible —
 *   - Studio: 2+ options, POSSIBLY multiple correct answers, one "globale"
 *     explanation + optional per-letter ones.
 *   - Exam: EXACTLY 5 options, EXACTLY 1 correct (boolean per option), a
 *     REQUIRED ≥10-char explanation on every option, plus a weakPointTag
 *     Studio QCMs have no equivalent of at all.
 *
 * Product decision (explicit, after this conflict was raised): NO
 * fabrication — never invent a topic tag from nothing, never force a
 * legitimately multi-correct question down to single-correct (that would
 * silently change its actual medical meaning). Only pool a Studio QCM when
 * it ALREADY happens to satisfy the Exam's stricter shape; anything else is
 * left for fresh generation. This means the usable pool per course can be
 * small or empty depending on how that course's QCMs were generated — an
 * accepted tradeoff, not a bug.
 *
 * The one derived (not fabricated) field: weakPointTag has no source data in
 * a Studio QCM at all, so pooled questions use the COURSE TITLE as their tag
 * — a defensible proxy (labels which course a question belongs to; invents
 * no medical content) rather than leaving a required field empty or guessing
 * a fake topic string.
 */

import { z } from "zod";
import { ExamQuestionSchema } from "@/lib/ai/exam-schemas";
import type { QcmItem } from "@/lib/types";

export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;

const EXAM_OPTION_LABELS = ["A", "B", "C", "D", "E"] as const;

/** Fisher-Yates — used so a regeneration's "shuffle and pull a different random subset" (product direction) is a genuinely random resample each call, not the same first N every time. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Converts one Studio QCM into the Exam's native format ONLY when it's
 * already structurally compatible — returns null otherwise (see this
 * module's own header comment for why nothing here ever fabricates a
 * missing field). Final safety net: the constructed object is validated
 * against ExamQuestionSchema itself before being accepted, not just the
 * manual checks below.
 */
function convertIfCompatible(qcm: QcmItem, courseTitle: string): ExamQuestion | null {
  if (!Array.isArray(qcm.options) || qcm.options.length !== 5) return null;
  if (!Array.isArray(qcm.reponsesCorrectes) || qcm.reponsesCorrectes.length !== 1) return null;
  if (typeof qcm.question !== "string" || qcm.question.trim().length < 30) return null;

  const correctLabel = qcm.reponsesCorrectes[0];
  const explication = qcm.explication;

  const options: ExamQuestion["options"] = [];
  for (const label of EXAM_OPTION_LABELS) {
    const option = qcm.options.find((o) => o.label === label);
    if (!option || typeof option.text !== "string") return null;
    const explanation = explication?.[label];
    if (typeof explanation !== "string" || explanation.trim().length < 10) return null;
    options.push({ label, text: option.text, isCorrect: label === correctLabel, explanation });
  }

  if (options.filter((o) => o.isCorrect).length !== 1) return null;

  const candidate = { vignette: qcm.question, options, weakPointTag: courseTitle.slice(0, 80) };
  const result = ExamQuestionSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

export interface ExamPoolingCourseInput {
  title: string;
  /** Raw studio_courses.qcms column value — untyped/untrusted until validated above. */
  qcms: unknown;
}

export interface ExamPoolingResult {
  pooled: ExamQuestion[];
  totalShortfall: number;
  /** Per-course shortfall count, in the SAME order as the input courses — used to log/report which courses had little or no reusable pool. */
  shortfallByCourse: Array<{ title: string; shortfall: number }>;
}

/**
 * For each course, pools up to `targetPerCourse` compatible questions
 * (randomly sampled — see shuffle's own comment) and reports the shortfall
 * (how many more are needed from fresh generation to reach the target for
 * that course). Called identically for a first-ever generation AND a
 * "Régénérer" click — regeneration naturally draws a different random
 * subset whenever a course's compatible pool is larger than the target,
 * with no separate "already shown" tracking needed.
 */
export function poolExamQuestions(courses: ExamPoolingCourseInput[], targetPerCourse: number): ExamPoolingResult {
  const pooled: ExamQuestion[] = [];
  const shortfallByCourse: Array<{ title: string; shortfall: number }> = [];
  let totalShortfall = 0;

  for (const course of courses) {
    const qcmsColumn = course.qcms as { qcms?: unknown } | null;
    const rawQcms = Array.isArray(qcmsColumn?.qcms) ? (qcmsColumn!.qcms as QcmItem[]) : [];

    const compatible = rawQcms
      .map((qcm) => convertIfCompatible(qcm, course.title))
      .filter((q): q is ExamQuestion => q !== null);

    const taken = shuffle(compatible).slice(0, targetPerCourse);
    pooled.push(...taken);

    const shortfall = Math.max(0, targetPerCourse - taken.length);
    if (shortfall > 0) {
      shortfallByCourse.push({ title: course.title, shortfall });
      totalShortfall += shortfall;
    }
  }

  return { pooled, totalShortfall, shortfallByCourse };
}
