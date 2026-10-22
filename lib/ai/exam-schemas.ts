import { z } from "zod";
import { EXAM_FORMATS, EXAM_POLARITIES, QCM_MAX_CORRECT, QCM_MIN_CORRECT, formatCombination, parseCombination, type ExamFormat, type ExamPolarity } from "@/lib/exam-formats";

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
const ExamOptionSchema = z.object({
  label: z.enum(["A", "B", "C", "D", "E"]),
  text: z.string().min(1),
  isCorrect: z.boolean(),
  explanation: z.string().min(10),
});

/** One numbered proposition (1–5, by position) of a "combinaison" question. */
const ExamPropositionSchema = z.object({
  text: z.string().min(3),
  isTrue: z.boolean(),
  explanation: z.string().min(10),
});

/** Case and the aliases a model sometimes writes ("QCM", "combination") are folded in before the enum check. */
const FORMAT_ALIASES: Record<string, ExamFormat> = { combinaisons: "combinaison", combination: "combinaison", combinations: "combinaison", combinatoire: "combinaison" };
const normalizeEnumText = (aliases: Record<string, string>) => (value: unknown) => {
  if (typeof value !== "string") return value;
  const key = value.trim().toLowerCase();
  return aliases[key] ?? key;
};

export interface ExamQuestionOutput {
  vignette: string;
  options: { label: "A" | "B" | "C" | "D" | "E"; text: string; isCorrect: boolean; explanation: string }[];
  weakPointTag: string;
  /** Absent on every question saved before the three formats existed: read as a QCS. */
  format?: ExamFormat;
  polarity?: ExamPolarity;
  /** "combinaison" only: the five numbered propositions, 1 to 5 in order. */
  propositions?: { text: string; isTrue: boolean; explanation: string }[];
}

/**
 * One exam question, in any of the three formats (lib/exam-formats.ts).
 * Unknown keys are dropped rather than rejecting an otherwise-valid question;
 * options are returned in A→E order. A question WITHOUT `format` (every exam
 * saved before the formats, and every pooled single-answer Studio QCM) is
 * validated exactly as before: five options, exactly one correct.
 *
 * Nothing is repaired or invented: a combination whose correct option does
 * not list exactly the propositions to tick, a QCM with one (or five)
 * answers, a duplicated combination — each is rejected, and the generator
 * asks for that question again.
 */
export const ExamQuestionSchema = z
  .object({
    vignette: z.string().min(30),
    options: z.array(ExamOptionSchema).length(5),
    weakPointTag: z.string().min(3),
    format: z.preprocess(normalizeEnumText(FORMAT_ALIASES), z.enum(EXAM_FORMATS)).optional(),
    polarity: z.preprocess(normalizeEnumText({}), z.enum(EXAM_POLARITIES)).optional(),
    propositions: z.array(ExamPropositionSchema).length(5).optional(),
  })
  .transform((question, ctx): ExamQuestionOutput => {
    const fail = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    if (new Set(question.options.map((option) => option.label)).size !== question.options.length) {
      return fail("Les 5 options doivent être A, B, C, D et E, chacune une seule fois.");
    }
    const options = [...question.options].sort((a, b) => a.label.localeCompare(b.label));
    const correctCount = options.filter((option) => option.isCorrect).length;
    const { vignette, weakPointTag, format, polarity } = question;
    const base = { vignette, weakPointTag, ...(polarity ? { polarity } : {}) };

    if (format === "qcm") {
      if (correctCount < QCM_MIN_CORRECT || correctCount > QCM_MAX_CORRECT) {
        return fail(`Un QCM doit avoir entre ${QCM_MIN_CORRECT} et ${QCM_MAX_CORRECT} réponses à cocher.`);
      }
      return { ...base, format, options };
    }

    if (format === "combinaison") {
      const propositions = question.propositions;
      if (!propositions) return fail("Une question à combinaisons doit avoir 5 propositions numérotées.");
      if (!polarity) return fail("Une question à combinaisons doit préciser RJ ou RF.");
      if (correctCount !== 1) return fail("Une question à combinaisons doit avoir exactement une combinaison juste.");
      const combinations = options.map((option) => parseCombination(option.text));
      if (combinations.some((combination) => combination === null)) {
        return fail("Chaque option d'une question à combinaisons doit être une combinaison de numéros 1 à 5 (ex. 1+3).");
      }
      const keys = combinations.map((combination) => formatCombination(combination!));
      if (new Set(keys).size !== keys.length) return fail("Les 5 combinaisons doivent être différentes.");
      const expected = formatCombination(propositions.flatMap((proposition, index) => (proposition.isTrue === (polarity === "rj") ? [index + 1] : [])));
      if (!expected) return fail("Au moins une proposition doit être à cocher.");
      if (keys[options.findIndex((option) => option.isCorrect)] !== expected) {
        return fail("La combinaison juste doit contenir toutes et seulement les propositions à cocher.");
      }
      return { ...base, format, propositions, options: options.map((option, index) => ({ ...option, text: keys[index] })) };
    }

    // "qcs", or a question without format.
    if (correctCount !== 1) return fail("Chaque question doit avoir EXACTEMENT une seule bonne réponse.");
    return { ...base, ...(format ? { format } : {}), options };
  });

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

const MAX_TRAP_PATTERNS = 8;
const SUMMARY_MAX_CHARS = 1000;
/** A summary rebuilt from the question-type description stays a short, readable line. */
const FALLBACK_SUMMARY_MAX_CHARS = 240;
/** A list marker a model sometimes writes at the start of each item ("- ", "• ", "1. ", "2) "). */
const LIST_MARKER = /^(?:[-•*]|\d+[.)])\s+/;
/** Stands in for an EXPLICITLY empty trap list (the model looked and found none): the schema needs one entry, and this one tells the generator exactly that. */
const NO_TRAP_OBSERVED = "Aucun piège récurrent identifiable dans l'examen de référence.";

/** Any JSON value a model put where text was expected, as one line of text ("" when nothing usable). */
function asProfileText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(asProfileText).filter(Boolean).join(" ; ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = asProfileText(item);
        return text ? `${key} : ${text}` : "";
      })
      .filter(Boolean)
      .join(" ; ");
  }
  return "";
}

/** Cuts to `max` UTF-16 units, never leaving half an emoji (a lone surrogate, which Postgres jsonb rejects) behind. */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}…`;
}

/** The profile object itself, also when the model wrapped it in one extra key ({"profile": {...}}). */
function profileSource(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  if ("questionTypeDistribution" in record) return record;
  const nested = Object.values(record).find(
    (value) => value !== null && typeof value === "object" && !Array.isArray(value) && "questionTypeDistribution" in value
  );
  return (nested as Record<string, unknown> | undefined) ?? record;
}

/**
 * Turns a model's raw style-profile JSON into an ExamStyleProfile, or throws
 * a ZodError. Only repairs that keep the model's own analysis intact — the
 * strict schema above (re-checked by /api/exam/generate and /api/exam/run)
 * still has the last word:
 *  - keys outside the schema are dropped (`.strict()` would reject them);
 *  - a field written as a list, a number or a nested object becomes text;
 *  - a trap list sent as one string is split on its lines, list markers are
 *    stripped, more than 8 traps are cut to the first 8, and an explicitly
 *    EMPTY list becomes NO_TRAP_OBSERVED;
 *  - a summary over 1,000 characters is shortened; a missing or too-short one
 *    is taken from the question-type description (the summary is only shown
 *    to the student, never part of the generation prompt).
 * A missing analytical field still fails here, so the caller asks the next
 * model instead of keeping a hollow profile.
 */
export function normalizeExamStyleProfile(raw: unknown): ExamStyleProfile {
  const source = profileSource(raw);
  const rawTraps = source.trapPatterns;
  const trapPatterns = (Array.isArray(rawTraps) ? rawTraps : typeof rawTraps === "string" ? rawTraps.split(/\n+/) : [])
    .map((trap) => asProfileText(trap).replace(LIST_MARKER, "").trim())
    .filter((trap) => trap.length >= 5)
    .slice(0, MAX_TRAP_PATTERNS);
  if (trapPatterns.length === 0 && Array.isArray(rawTraps) && rawTraps.length === 0) trapPatterns.push(NO_TRAP_OBSERVED);

  const questionTypeDistribution = asProfileText(source.questionTypeDistribution);
  const summary = asProfileText(source.summary);
  return ExamStyleProfileSchema.parse({
    questionTypeDistribution,
    trapPatterns,
    optionFormatConventions: asProfileText(source.optionFormatConventions),
    difficultyAndVocabulary: asProfileText(source.difficultyAndVocabulary),
    summary: summary.length >= 10 ? clipText(summary, SUMMARY_MAX_CHARS) : clipText(questionTypeDistribution, FALLBACK_SUMMARY_MAX_CHARS),
  });
}
