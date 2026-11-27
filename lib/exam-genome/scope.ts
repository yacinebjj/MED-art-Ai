import { z } from "zod";
import { getBlidaUnit, blidaProgramme, yearLabel } from "@/lib/exam-genome/blida-catalog";

/**
 * EXAM GENOME — scope lock (product order 2026-11-27). The bank holds the exam
 * papers of ONE faculty and ONE track: Faculté de Médecine, Université Saad
 * Dahlab Blida 1, Médecine (general medicine), years 1 to 6. Pharmacy,
 * dentistry, other faculties and other years are refused three times: by
 * these schemas (every write path validates through them), by the database
 * (CHECK constraints of supabase/migrations/20261127_exam_genome_blida.sql)
 * and by the paper's own header (normalize.ts's detectPaperScope).
 */
export const GENOME_FACULTY = "blida1_medecine" as const;
export const GENOME_TRACK = "medecine" as const;
export const GENOME_YEARS = [1, 2, 3, 4, 5, 6] as const;

export const GENOME_SESSIONS = ["normale", "rattrapage"] as const;
export const GENOME_SITTINGS = ["emd1", "emd2", "unique", "synthese"] as const;
/** Where a paper comes from — the starting point of its trust. */
export const GENOME_PROVENANCES = ["official", "teacher", "student_copy", "student_reconstruction", "third_party"] as const;
export const GENOME_PAPER_STATUSES = ["needs_review", "published", "rejected", "duplicate", "taken_down"] as const;
export const GENOME_FORMATS = ["qcs", "qcm", "combinaison", "qroc", "cas_clinique"] as const;
export const GENOME_OPTION_LABELS = ["A", "B", "C", "D", "E"] as const;

export type GenomeSession = (typeof GENOME_SESSIONS)[number];
export type GenomeProvenance = (typeof GENOME_PROVENANCES)[number];
export type GenomeFormat = (typeof GENOME_FORMATS)[number];
export type GenomeOptionLabel = (typeof GENOME_OPTION_LABELS)[number];

/**
 * Answer-key trust, lowest to highest. A question shows the best key it has
 * and that key's level, never a lower key dressed as a better one:
 *   0 none — no key yet;
 *   1 proposed — one student's or an AI's answer;
 *   2 community — independent students agree (lib/exam-genome/trust.ts);
 *   3 expert — checked by a qualified reviewer (resident, assistant);
 *   4 official — the faculty's own corrigé type.
 */
export const TRUST_LEVELS = { none: 0, proposed: 1, community: 2, expert: 3, official: 4 } as const;
export type TrustLevel = (typeof TRUST_LEVELS)[keyof typeof TRUST_LEVELS];
export const KEY_SOURCES = ["official_grid", "teacher", "expert_review", "community_vote", "student_document", "ai"] as const;
export type KeySource = (typeof KEY_SOURCES)[number];

const ACADEMIC_YEAR = /^(20\d{2})\/(20\d{2})$/;

export const AcademicYearSchema = z
  .string()
  .regex(ACADEMIC_YEAR, "Année universitaire attendue au format 2023/2024.")
  .refine((value) => {
    const [first, second] = value.split("/").map(Number);
    return second === first + 1 && first >= 2010 && first <= 2035;
  }, "Année universitaire invalide (ex. 2023/2024).");

/** First calendar day an academic year can hold an exam (September) and the last (October of the next year: late rattrapages). */
export function academicYearBounds(academicYear: string): { from: string; to: string } {
  const first = Number(academicYear.slice(0, 4));
  return { from: `${first}-09-01`, to: `${first + 1}-10-31` };
}

export const GenomePaperMetaSchema = z
  .object({
    faculty: z.literal(GENOME_FACULTY),
    track: z.literal(GENOME_TRACK),
    yearLevel: z.number().int().min(1).max(6),
    unitCode: z.string().regex(/^Y[1-6]-[A-Z0-9-]+$/),
    academicYear: AcademicYearSchema,
    session: z.enum(GENOME_SESSIONS),
    sitting: z.enum(GENOME_SITTINGS),
    rotation: z.number().int().min(1).max(12).nullable().default(null),
    variant: z.string().trim().min(1).max(12).nullable().default(null),
    examDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    durationMinutes: z.number().int().min(10).max(480).nullable().default(null),
    provenance: z.enum(GENOME_PROVENANCES),
  })
  .strict()
  .superRefine((meta, ctx) => {
    const unit = getBlidaUnit(meta.unitCode);
    if (!unit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unitCode"], message: `Unité inconnue du programme de Blida : ${meta.unitCode}.` });
      return;
    }
    if (unit.year !== meta.yearLevel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unitCode"], message: `${unit.title} est une unité de ${yearLabel(unit.year)}, pas de ${yearLabel(meta.yearLevel)}.` });
    }
    if (meta.session === "rattrapage" && meta.sitting !== "unique") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sitting"], message: "Un rattrapage est une épreuve unique." });
    }
    if (meta.session === "normale" && meta.sitting !== "synthese" && !unit.normalSittings.includes(meta.sitting)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sitting"], message: `${unit.title} : épreuves attendues ${unit.normalSittings.join(", ")}, pas « ${meta.sitting} ».` });
    }
    if (meta.rotation !== null && !unit.rotations) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rotation"], message: "Une rotation n'existe que pour les unités cliniques (4e à 6e année)." });
    }
    if (meta.examDate) {
      const { from, to } = academicYearBounds(meta.academicYear);
      if (meta.examDate < from || meta.examDate > to) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["examDate"], message: `La date ${meta.examDate} n'appartient pas à l'année universitaire ${meta.academicYear}.` });
      }
    }
  });
export type GenomePaperMeta = z.infer<typeof GenomePaperMetaSchema>;

/** A paper older than its year's current programme: kept, but outside the current unit catalog's guarantees. */
export function isLegacyProgramme(meta: Pick<GenomePaperMeta, "yearLevel" | "academicYear">): boolean {
  const programme = blidaProgramme(meta.yearLevel);
  return programme ? meta.academicYear < programme.validFrom : false;
}

const OptionSchema = z.object({ label: z.enum(GENOME_OPTION_LABELS), text: z.string().trim().min(1).max(1200) });

/** A normalized question as stored. QCS/QCM/combinaison carry 4 or 5 options (some Blida papers use A–D). */
export const GenomeQuestionSchema = z
  .object({
    position: z.number().int().min(1).max(400),
    format: z.enum(GENOME_FORMATS),
    polarity: z.enum(["rj", "rf"]).nullable(),
    /** The statement of the exercise / clinical case the question belongs to, shared with its siblings. */
    context: z.string().trim().max(8000).nullable().default(null),
    stem: z.string().trim().max(4000),
    propositions: z.array(z.string().trim().min(1).max(1200)).max(8).default([]),
    options: z.array(OptionSchema).max(5).default([]),
    parseConfidence: z.number().min(0).max(1),
  })
  .superRefine((q, ctx) => {
    // A question of an exercise may only say "On trouve :" — its statement is the exercise's.
    if (q.stem.length < 8 && !q.context) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stem"], message: `Question ${q.position} : énoncé manquant.` });
    }
    const choice = q.format === "qcs" || q.format === "qcm" || q.format === "combinaison";
    if (choice && (q.options.length < 4 || q.options.length > 5)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: `Question ${q.position} : 4 ou 5 options attendues, ${q.options.length} trouvées.` });
    }
    const labels = q.options.map((o) => o.label);
    if (new Set(labels).size !== labels.length || labels.some((label, i) => label !== GENOME_OPTION_LABELS[i])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: `Question ${q.position} : options attendues dans l'ordre A, B, C…` });
    }
    if (q.format === "combinaison" && q.propositions.length < 4) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["propositions"], message: `Question ${q.position} : une question à combinaisons a au moins 4 propositions numérotées.` });
    }
  });
export type GenomeQuestion = z.infer<typeof GenomeQuestionSchema>;

/** An answer, letters A–E in order, each once ("BD"). */
export const AnswerSchema = z.string().regex(/^(?=[A-E]{1,5}$)A?B?C?D?E?$/, "Réponse attendue en lettres A à E, dans l'ordre (ex. BD).");

export const GenomeKeyClaimSchema = z
  .object({
    position: z.number().int().min(1).max(400),
    answer: AnswerSchema,
    level: z.number().int().min(0).max(4),
    source: z.enum(KEY_SOURCES),
  })
  .strict();
export type GenomeKeyClaim = z.infer<typeof GenomeKeyClaimSchema>;

/** The highest level a key from this source may claim — a student's document never becomes "official". */
export function maxTrustForSource(source: KeySource, provenance: GenomeProvenance): TrustLevel {
  switch (source) {
    case "official_grid":
      return provenance === "official" ? TRUST_LEVELS.official : TRUST_LEVELS.proposed;
    case "teacher":
    case "expert_review":
      return TRUST_LEVELS.expert;
    case "community_vote":
      return TRUST_LEVELS.community;
    case "student_document":
    case "ai":
      return TRUST_LEVELS.proposed;
  }
}
