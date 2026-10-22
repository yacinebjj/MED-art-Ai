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
 *
 * QUESTION FORMATS (lib/exam-formats.ts): a Studio QCM with exactly one
 * correct answer pools as a QCS, exactly as before; one with 2 to 4 correct
 * answers — legitimately multi-correct, never forced to single-correct —
 * now pools as a "qcm" instead of being left out. A harvested exam question
 * carries its own format, numbered propositions and topic tag (`exam`, see
 * convertExamQuestionToHarvestableQcm), so it comes back exactly as written.
 */

import { z } from "zod";
import { ExamQuestionSchema } from "@/lib/ai/exam-schemas";
import { QCM_MAX_CORRECT, questionFormat, type ExamFormat, type ExamPolarity, type FormatCounts } from "@/lib/exam-formats";
import type { QcmItem } from "@/lib/types";

export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;

/** What a harvested row keeps of an exam question beyond the Studio QcmItem shape. Stored only in exam_harvested_qcms, which only this module reads. */
export interface HarvestedExamMeta {
  format: ExamFormat;
  polarity?: ExamPolarity;
  propositions?: { text: string; isTrue: boolean; explanation: string }[];
  weakPointTag?: string;
}

export type HarvestableQcm = QcmItem & { exam?: HarvestedExamMeta };

/** Only the known fields of a stored `exam` value — a malformed one can never override the question's own text or options. */
function readHarvestedMeta(raw: unknown): Partial<HarvestedExamMeta> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { format, polarity, propositions, weakPointTag } = raw as Record<string, unknown>;
  return {
    ...(format !== undefined ? { format: format as ExamFormat } : {}),
    ...(polarity !== undefined ? { polarity: polarity as ExamPolarity } : {}),
    ...(propositions !== undefined ? { propositions: propositions as HarvestedExamMeta["propositions"] } : {}),
    ...(typeof weakPointTag === "string" && weakPointTag.trim().length >= 3 ? { weakPointTag } : {}),
  };
}

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
  if (!Array.isArray(qcm.reponsesCorrectes) || qcm.reponsesCorrectes.length < 1 || qcm.reponsesCorrectes.length > QCM_MAX_CORRECT) return null;
  if (typeof qcm.question !== "string" || qcm.question.trim().length < 30) return null;

  const correctLabels = new Set(qcm.reponsesCorrectes);
  const explication = qcm.explication;

  const options: ExamQuestion["options"] = [];
  for (const label of EXAM_OPTION_LABELS) {
    const option = qcm.options.find((o) => o.label === label);
    if (!option || typeof option.text !== "string") return null;
    const explanation = explication?.[label];
    if (typeof explanation !== "string" || explanation.trim().length < 10) return null;
    options.push({ label, text: option.text, isCorrect: correctLabels.has(label), explanation });
  }

  // Every listed answer must be one of the five options (no stray or duplicate label).
  if (options.filter((o) => o.isCorrect).length !== qcm.reponsesCorrectes.length) return null;

  const meta = readHarvestedMeta((qcm as HarvestableQcm).exam);
  const { weakPointTag: harvestedTag, ...formatFields } = meta ?? {};
  const candidate = {
    vignette: qcm.question,
    options,
    weakPointTag: harvestedTag ?? courseTitle.slice(0, 80),
    // A harvested exam question brings its own format; an organic Studio QCM
    // is a QCS (one answer) or a QCM (several) — ExamQuestionSchema decides.
    ...(meta ? formatFields : qcm.reponsesCorrectes.length > 1 ? { format: "qcm" } : {}),
  };
  const result = ExamQuestionSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/**
 * Inverse of convertIfCompatible — turns a freshly AI-generated ExamQuestion
 * (single-correct, 5 options, per-option explanation) into the Studio
 * QcmItem shape, so it can be harvested into exam_harvested_qcms and reused
 * by FUTURE exam generations covering this course, in any course-set
 * combination — not just the one that triggered this generation. Lossless:
 * the single isCorrect option becomes a 1-element reponsesCorrectes array (a
 * field that already supports more, per StudioQcmsSchema). QcmExplication
 * requires a "globale" field ExamQuestion has no direct equivalent of (no
 * whole-question summary) — reuses the correct option's own explanation
 * text rather than inventing a new fact. A question with a `format` also
 * keeps it (with its polarity, propositions and topic tag) under `exam`, so
 * pooling it again restores the very same question.
 */
export function convertExamQuestionToHarvestableQcm(question: ExamQuestion, id: number): HarvestableQcm {
  const correctOption = question.options.find((o) => o.isCorrect);
  const explication = { globale: correctOption?.explanation ?? "" } as QcmItem["explication"];
  for (const option of question.options) {
    explication[option.label as "A" | "B" | "C" | "D" | "E"] = option.explanation;
  }
  return {
    id,
    question: question.vignette,
    options: question.options.map((o) => ({ label: o.label, text: o.text })),
    reponsesCorrectes: question.options.filter((o) => o.isCorrect).map((o) => o.label),
    explication,
    ...(question.format
      ? {
          exam: {
            format: question.format,
            ...(question.polarity ? { polarity: question.polarity } : {}),
            ...(question.propositions ? { propositions: question.propositions } : {}),
            weakPointTag: question.weakPointTag,
          },
        }
      : {}),
  };
}

export interface ExamPoolingCourseInput {
  id: number;
  title: string;
  /** Raw studio_courses.qcms column value — untyped/untrusted until validated above. */
  qcms: unknown;
  /** Previously-harvested QCMs for this course (see lib/exam-harvested-qcms.ts) — already QcmItem-shaped, merged with `qcms` before the same convertIfCompatible check applies to both. */
  harvestedQcms?: QcmItem[];
}

export interface ExamPoolingResult {
  pooled: ExamQuestion[];
  totalShortfall: number;
  /** Per-course shortfall, in the SAME order as the input courses — used both to log which courses had little/no reusable pool AND (via `id`) to generate + harvest each course's shortfall independently, see app/api/exam/generate/route.ts. */
  shortfallByCourse: Array<{ id: number; title: string; shortfall: number }>;
}

/**
 * For each course, pools up to `targetPerCourse` compatible questions
 * (randomly sampled — see shuffle's own comment) and reports the shortfall
 * (how many more are needed from fresh generation to reach the target for
 * that course). Called identically for a first-ever generation AND a
 * "Régénérer" click — regeneration naturally draws a different random
 * subset whenever a course's compatible pool is larger than the target,
 * with no separate "already shown" tracking needed.
 *
 * `formatCaps`: the most questions of each format the WHOLE exam may take
 * from the pools (its target mix, lib/exam-formats.ts) — without it, a course
 * rich in single-answer Studio QCMs would fill the exam with QCS alone.
 * What a cap leaves out becomes shortfall, generated in the missing formats.
 */
export function poolExamQuestions(courses: ExamPoolingCourseInput[], targetPerCourse: number, formatCaps?: FormatCounts): ExamPoolingResult {
  const pooled: ExamQuestion[] = [];
  const shortfallByCourse: Array<{ id: number; title: string; shortfall: number }> = [];
  let totalShortfall = 0;
  const capsLeft = formatCaps ? { ...formatCaps } : null;

  for (const course of courses) {
    const qcmsColumn = course.qcms as { qcms?: unknown } | null;
    const rawQcms = Array.isArray(qcmsColumn?.qcms) ? (qcmsColumn!.qcms as QcmItem[]) : [];
    // Harvested QCMs (see lib/exam-harvested-qcms.ts) are already QcmItem-
    // shaped — merged in BEFORE convertIfCompatible so both sources go
    // through the exact same validation, never a separate "trust this one"
    // path.
    const candidates = [...rawQcms, ...(course.harvestedQcms ?? [])];

    const compatible = candidates
      .map((qcm) => convertIfCompatible(qcm, course.title))
      .filter((q): q is ExamQuestion => q !== null);

    const taken: ExamQuestion[] = [];
    for (const question of shuffle(compatible)) {
      if (taken.length >= targetPerCourse) break;
      if (capsLeft) {
        const format = questionFormat(question);
        if (capsLeft[format] <= 0) continue;
        capsLeft[format]--;
      }
      taken.push(question);
    }
    pooled.push(...taken);

    const shortfall = Math.max(0, targetPerCourse - taken.length);
    if (shortfall > 0) {
      shortfallByCourse.push({ id: course.id, title: course.title, shortfall });
      totalShortfall += shortfall;
    }
  }

  return { pooled, totalShortfall, shortfallByCourse };
}
