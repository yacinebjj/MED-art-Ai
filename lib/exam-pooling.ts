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
import { normalizeText } from "@/lib/content-similarity";
import { EXAM_FORMATS, QCM_MAX_CORRECT, questionFormat, type ExamFormat, type ExamPolarity, type FormatCounts } from "@/lib/exam-formats";
import { CANONICAL_BANK_PROFILE } from "@/lib/exam-bank-profiles";
import type { QcmItem } from "@/lib/types";

export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;

/**
 * Identity of a question: its statement, its options (A→E) and its numbered
 * propositions, whatever their case, punctuation or spacing. The statement
 * alone is not enough — a combination question's is often generic
 * ("Parmi les propositions suivantes…") and shared by different questions.
 * Reads an exam question (or a stored exam's question) as it comes, so a
 * malformed legacy value never throws.
 */
export function examQuestionKey(question: { vignette: string; options?: unknown; propositions?: unknown }): string {
  const options = (Array.isArray(question.options) ? [...question.options] : []) as { label?: unknown; text?: unknown }[];
  options.sort((a, b) => (String(a?.label ?? "") < String(b?.label ?? "") ? -1 : String(a?.label ?? "") > String(b?.label ?? "") ? 1 : 0));
  const propositions = (Array.isArray(question.propositions) ? question.propositions : []) as { text?: unknown }[];
  return normalizeText([question.vignette, ...options.map((option) => String(option?.text ?? "")), ...propositions.map((proposition) => String(proposition?.text ?? ""))].join(" "));
}

/** examQuestionKey of a QcmItem-shaped row (Studio QCM / harvested question): the same key its exam conversion gets. */
export function qcmItemKey(qcm: QcmItem): string {
  return examQuestionKey({ vignette: qcm.question, options: qcm.options, propositions: (qcm as HarvestableQcm).exam?.propositions });
}

/** What a harvested row keeps of an exam question beyond the Studio QcmItem shape. Stored only in exam_harvested_qcms, which only this module reads. */
export interface HarvestedExamMeta {
  /** Absent on a question written without one (a legacy single-answer QCS). */
  format?: ExamFormat;
  polarity?: ExamPolarity;
  propositions?: { text: string; isTrue: boolean; explanation: string }[];
  weakPointTag?: string;
  /** The bank it was written for (lib/exam-bank-profiles.ts): only runs of the same profile reuse it. */
  profile?: string;
}

export type HarvestableQcm = QcmItem & { exam?: HarvestedExamMeta };

/** Only the known fields of a stored `exam` value — a malformed one can never override the question's own text or options. */
function readHarvestedMeta(raw: unknown): Partial<HarvestedExamMeta> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { format, polarity, propositions, weakPointTag, profile } = raw as Record<string, unknown>;
  return {
    ...(format !== undefined ? { format: format as ExamFormat } : {}),
    ...(polarity !== undefined ? { polarity: polarity as ExamPolarity } : {}),
    ...(propositions !== undefined ? { propositions: propositions as HarvestedExamMeta["propositions"] } : {}),
    ...(typeof weakPointTag === "string" && weakPointTag.trim().length >= 3 ? { weakPointTag } : {}),
    ...(typeof profile === "string" ? { profile } : {}),
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
  const harvestedTag = meta?.weakPointTag;
  // The bank tag (meta.profile) is the lookup's business, never part of the question.
  const formatFields = {
    ...(meta?.format !== undefined ? { format: meta.format } : {}),
    ...(meta?.polarity !== undefined ? { polarity: meta.polarity } : {}),
    ...(meta?.propositions !== undefined ? { propositions: meta.propositions } : {}),
  };
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
 * text rather than inventing a new fact. A question keeps its format (with
 * its polarity, propositions and topic tag) under `exam`, so pooling it again
 * restores the very same question — and `exam.profile`, the bank it was
 * written for (lib/exam-bank-profiles.ts; the canonical one by default).
 */
export function convertExamQuestionToHarvestableQcm(question: ExamQuestion, id: number, profile: string = CANONICAL_BANK_PROFILE): HarvestableQcm {
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
    exam: {
      ...(question.format ? { format: question.format } : {}),
      ...(question.polarity ? { polarity: question.polarity } : {}),
      ...(question.propositions ? { propositions: question.propositions } : {}),
      weakPointTag: question.weakPointTag,
      profile,
    },
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
 *
 * `exclude`: keys (examQuestionKey) of questions the student was already
 * given (lib/exam-question-bank.ts) — never pooled again; what they leave
 * missing becomes shortfall, so the bank deepens instead of repeating itself.
 * A question is also never taken twice in one exam (the same statement can
 * reach two selected courses that hold the same content).
 * `quotas`: per course id, how many questions that course gets in this exam
 * (replaces `targetPerCourse`) — lets the caller spread the exam over every
 * selected course even when the first courses' pools could fill it alone.
 * With quotas, how many questions of each format each course gives is solved
 * exactly (planFormatAllocation): the most questions the pools can supply
 * under the exam's format caps, so a rich pool fills the exam's exact mix.
 * Without quotas, the original course-by-course fill is kept unchanged.
 */
export function poolExamQuestions(
  courses: ExamPoolingCourseInput[],
  targetPerCourse: number,
  formatCaps?: FormatCounts,
  options: { exclude?: ReadonlySet<string>; quotas?: ReadonlyMap<number, number> } = {}
): ExamPoolingResult {
  const pooled: ExamQuestion[] = [];
  const shortfallByCourse: Array<{ id: number; title: string; shortfall: number }> = [];
  let totalShortfall = 0;
  const takenKeys = new Set<string>();

  // Per course, in random order: every compatible question not excluded, each statement once.
  const poolByCourse = courses.map((course) => {
    const qcmsColumn = course.qcms as { qcms?: unknown } | null;
    const rawQcms = Array.isArray(qcmsColumn?.qcms) ? (qcmsColumn!.qcms as QcmItem[]) : [];
    // Harvested QCMs (see lib/exam-harvested-qcms.ts) are already QcmItem-
    // shaped — merged in BEFORE convertIfCompatible so both sources go
    // through the exact same validation, never a separate "trust this one"
    // path.
    const candidates = [...rawQcms, ...(course.harvestedQcms ?? [])];

    const compatible = candidates
      .map((qcm) => convertIfCompatible(qcm, course.title))
      .filter((q): q is ExamQuestion => q !== null && !options.exclude?.has(examQuestionKey(q)));
    const keys = new Set<string>();
    return shuffle(compatible).filter((question) => {
      const key = examQuestionKey(question);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
  });

  const quotas = courses.map((course) => options.quotas?.get(course.id) ?? targetPerCourse);
  const allocation = options.quotas ? planFormatAllocation(poolByCourse.map((pool) => tallyQuestionFormats(pool)), quotas, formatCaps ?? null) : null;
  const capsLeft = formatCaps ? { ...formatCaps } : null;

  courses.forEach((course, index) => {
    const quota = quotas[index];
    const wanted = allocation ? { ...allocation[index] } : null;
    const taken: ExamQuestion[] = [];
    for (const question of poolByCourse[index]) {
      if (taken.length >= quota) break;
      const key = examQuestionKey(question);
      if (takenKeys.has(key)) continue;
      const format = questionFormat(question);
      if (wanted) {
        if (wanted[format] <= 0) continue;
        wanted[format]--;
      } else if (capsLeft) {
        if (capsLeft[format] <= 0) continue;
        capsLeft[format]--;
      }
      takenKeys.add(key);
      taken.push(question);
    }
    pooled.push(...taken);

    const shortfall = Math.max(0, quota - taken.length);
    if (shortfall > 0) {
      shortfallByCourse.push({ id: course.id, title: course.title, shortfall });
      totalShortfall += shortfall;
    }
  });

  return { pooled, totalShortfall, shortfallByCourse };
}

function tallyQuestionFormats(questions: ExamQuestion[]): FormatCounts {
  const counts: FormatCounts = { qcs: 0, qcm: 0, combinaison: 0 };
  for (const question of questions) counts[questionFormat(question)]++;
  return counts;
}

/**
 * How many questions of each format each course should give: the largest
 * total the pools can supply, with at most `quotas[i]` from course i, at most
 * `available[i][format]` of a format from course i, and at most `caps[format]`
 * of a format in the whole exam (no caps: unlimited). A max-flow from courses
 * to formats (Edmonds–Karp on a graph of courses + 3 formats — at most a few
 * hundred nodes), so no course-by-course order can strand a format: a course
 * rich in combinations gives them when the exam still needs combinations.
 */
export function planFormatAllocation(available: FormatCounts[], quotas: number[], caps: FormatCounts | null): FormatCounts[] {
  const courseCount = available.length;
  const source = 0;
  const sink = courseCount + EXAM_FORMATS.length + 1;
  const size = sink + 1;
  const formatNode = (f: number) => courseCount + 1 + f;
  const capacity = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const flow = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < courseCount; i++) {
    capacity[source][1 + i] = Math.max(0, quotas[i]);
    EXAM_FORMATS.forEach((format, f) => (capacity[1 + i][formatNode(f)] = available[i][format]));
  }
  EXAM_FORMATS.forEach((format, f) => (capacity[formatNode(f)][sink] = caps ? Math.max(0, caps[format]) : Number.MAX_SAFE_INTEGER));

  for (;;) {
    const parent = new Array<number>(size).fill(-1);
    parent[source] = source;
    const queue = [source];
    for (let head = 0; head < queue.length && parent[sink] < 0; head++) {
      const u = queue[head];
      for (let v = 0; v < size; v++) {
        if (parent[v] < 0 && capacity[u][v] - flow[u][v] > 0) {
          parent[v] = u;
          queue.push(v);
        }
      }
    }
    if (parent[sink] < 0) break;
    let bottleneck = Number.MAX_SAFE_INTEGER;
    for (let v = sink; v !== source; v = parent[v]) bottleneck = Math.min(bottleneck, capacity[parent[v]][v] - flow[parent[v]][v]);
    for (let v = sink; v !== source; v = parent[v]) {
      flow[parent[v]][v] += bottleneck;
      flow[v][parent[v]] -= bottleneck;
    }
  }

  return available.map((_, i) => {
    const counts: FormatCounts = { qcs: 0, qcm: 0, combinaison: 0 };
    EXAM_FORMATS.forEach((format, f) => (counts[format] = Math.max(0, flow[1 + i][formatNode(f)])));
    return counts;
  });
}
