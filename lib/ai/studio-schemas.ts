import { z } from "zod";
import type { DemoSectionId } from "@/lib/demo-content";

/**
 * Zod mirrors of lib/course-slug-content.ts's Gastrite-prefixed interfaces —
 * the exact shapes the real Studio components (GastriteResumeStudio,
 * GastriteCasCliniqueStudio, GastriteQcmsStudio) require as props.
 * Validation is strict on TYPES/SHAPE (every required field present, right
 * primitive type, right nesting) and, for cas_clinique/qcm specifically, now
 * also strict on the client's mandated MINIMUM COUNTS (3 cases, 15 QCM) —
 * those are non-negotiable per the current spec, not soft guidance, so an
 * under-count generation is rejected rather than silently accepted. QROC was
 * dropped entirely from the Studio spec for cost reasons — `qrocs` stays a
 * required (but unbounded) array purely so InteractiveQuiz, SHARED with the
 * real per-course production pipeline, keeps receiving the exact prop shape
 * it always has; Studio's own prompt now always sends it empty. Résumé's
 * mode count stays lenient (no hard minimum was mandated for it), since
 * GastriteResumeStudio already degrades gracefully on a missing mode.
 */

const strArr = z.array(z.string());

const GastriteResumeCardSchema = z.object({
  titre: z.string(),
  type: z.string().optional(),
  tone: z.string().optional(),
  content: z.string().optional(),
  items: strArr,
});

const GastriteResumeTableSchema = z.object({
  headers: strArr,
  rows: z.array(strArr),
});

const GastriteResumeSectionSchema = z.object({
  numero: z.number(),
  titre: z.string(),
  intro: z.string(),
  outro: z.string(),
  cards: z.array(GastriteResumeCardSchema),
  table: GastriteResumeTableSchema,
  rows: z.array(z.record(z.string())),
  items: strArr,
});

const GastriteResumeHeroSchema = z.object({
  tags: strArr,
  badge: z.string(),
  titre: z.string(),
  intro: z.string(),
  sous_titre: z.string(),
});

const GastriteDdxTableSchema = GastriteResumeTableSchema.extend({
  titre: z.string(),
  intro: z.string(),
});

const GastritePiegeItemSchema = z.object({ numero: z.number(), text: z.string() });
const GastritePiegeCategorySchema = z.object({ nom: z.string(), items: z.array(GastritePiegeItemSchema) });
const GastritePiegesSchema = z.object({ titre: z.string(), intro: z.string(), categories: z.array(GastritePiegeCategorySchema) });

const GastriteGuidelineStepSchema = z.object({ numero: z.number(), titre: z.string(), content: z.string() });
const GastriteQuoteSchema = z.object({ text: z.string(), contexte: z.string() });
const GastritePerleSchema = z.object({ type: z.enum(["perle", "astuce"]), text: z.string() });
const GastriteAstuceItemSchema = z.object({
  numero: z.number(),
  titre: z.string(),
  acronyme: z.string(),
  chiffres: z.string(),
  image: z.string(),
  citation: z.string(),
  content: z.string(),
  details: strArr,
});

const GastriteResumeModeSchema = z.object({
  id: z.enum(["smart", "exam", "cheatsheet", "guideline", "professor", "astuces"]),
  label: z.string(),
  hero: GastriteResumeHeroSchema,
  sections: z.array(GastriteResumeSectionSchema),
  ddx_table: GastriteDdxTableSchema,
  pieges: GastritePiegesSchema,
  cards: z.array(GastriteResumeCardSchema),
  steps: z.array(GastriteGuidelineStepSchema),
  quotes: z.array(GastriteQuoteSchema),
  perles: z.array(GastritePerleSchema),
  items: z.array(GastriteAstuceItemSchema),
});

export const StudioResumeSchema = z.object({
  tombabilite: z.number(),
  modes: z.array(GastriteResumeModeSchema).min(1),
});

const VitalItemSchema = z.object({ label: z.string(), value: z.string(), alert: z.boolean().optional().default(false) });
const DialogueLineSchema = z.object({
  speaker: z.enum(["patient", "medecin", "autre"]),
  name: z.string(),
  tone: z.string(),
  text: z.string(),
  pourquoi: z.string().optional().default(""),
});
const ExamStepSchema = z.object({ action: z.string(), pourquoi: z.string() });
const ParaclinicalItemSchema = z.object({ label: z.string(), result: z.string(), pourquoi: z.string() });
const DdxItemSchema = z.object({ maladie: z.string(), raisonnement: z.string(), pourquoi: z.string() });
const RxItemSchema = z.object({ ligne: z.string(), pourquoi: z.string() });

export const GastriteRawCaseSchema = z.object({
  id: z.string(),
  numero: z.number(),
  archetype: z.string(),
  // Purely cosmetic (never medical content) and both already have a
  // graceful runtime fallback downstream for an unrecognized value —
  // resolveLucideIcon (lib/lucide-icon-lookup.ts) falls back to Stethoscope,
  // resolveCaseColor (GastriteCasCliniqueStudio.tsx) falls back to "indigo".
  // Defaulted here too so a MISSING key (as opposed to an unrecognized
  // value, already handled) doesn't fail the whole case over a detail with
  // zero clinical weight — unlike every other field below, which stays
  // strictly required since it IS real medical content.
  icon: z.string().optional().default(""),
  color: z.string().optional().default("indigo"),
  titre: z.string(),
  scene: z.string(),
  vitals: z.array(VitalItemSchema),
  acte1_interrogatoire: z.array(DialogueLineSchema),
  acte2_examen_physique: z.array(ExamStepSchema),
  acte3_examens_complementaires: z.array(ParaclinicalItemSchema),
  acte4_raisonnement: z.object({ items: z.array(DdxItemSchema), conclusion: z.string() }),
  acte5_prise_en_charge: z.object({ items: z.array(RxItemSchema), surveillance: z.string() }),
});

/** Client mandate: exactement 3 cas cliniques, les plus importants/fréquents — see STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT's override in lib/ai/studio-prompts.ts. min(3) is a floor (guards against a genuine under-generation), the prompt itself controls the exact target. */
export const StudioCasCliniqueSchema = z.object({
  titre_section: z.string(),
  cases: z.array(GastriteRawCaseSchema).min(3),
});

const QcmOptionSchema = z.object({ label: z.string(), text: z.string() });
const ExplicationQCMSchema = z.object({
  globale: z.string(),
  A: z.string().optional().default(""),
  B: z.string().optional().default(""),
  C: z.string().optional().default(""),
  D: z.string().optional().default(""),
  E: z.string().optional().default(""),
});
const QcmItemSchema = z.object({
  id: z.number(),
  question: z.string(),
  options: z.array(QcmOptionSchema).min(2),
  reponsesCorrectes: z.array(z.string()).min(1),
  explication: ExplicationQCMSchema,
});
const QrocItemSchema = z.object({ id: z.number(), question: z.string(), reponseOfficielle: z.string() });

/**
 * Client mandate: exactement 15 QCM, aucun QROC — see STUDIO_QCMS_SYSTEM_PROMPT's
 * override in lib/ai/studio-prompts.ts. `qrocs` keeps no minimum (always sent
 * empty by the Studio prompt now) rather than being removed outright, since
 * InteractiveQuiz (components/course/workspace/InteractiveQuiz.tsx) is SHARED
 * with the real per-course production pipeline and still expects the key.
 */
export const StudioQcmsSchema = z.object({
  titre_section: z.string(),
  qcms: z.array(QcmItemSchema).min(15),
  qrocs: z.array(QrocItemSchema),
});

const StudioTextSchema = z.string().min(50);

/** One schema per Studio tile, keyed the same way as STUDIO_PROMPT_CONFIG/STUDIO_SECTION_KEYS in lib/ai/studio-prompts.ts. */
export const STUDIO_SCHEMAS: Record<DemoSectionId, z.ZodTypeAny> = {
  explication: StudioTextSchema,
  resume: StudioResumeSchema,
  cas_clinique: StudioCasCliniqueSchema,
  qcm: StudioQcmsSchema,
  exemples_analogies: StudioTextSchema,
};
