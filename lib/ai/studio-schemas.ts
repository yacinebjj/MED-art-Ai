import { z } from "zod";
import type { DemoSectionId } from "@/lib/demo-content";

/**
 * Zod mirrors of lib/course-slug-content.ts's Gastrite-prefixed/MindMap interfaces —
 * the exact shapes the real Studio components (GastriteResumeStudio,
 * GastriteCasCliniqueStudio, GastriteQcmsStudio) require as props.
 * Validation is strict on TYPES/SHAPE (every required field present, right
 * primitive type, right nesting) and, for cas_clinique/qcm specifically, now
 * also strict on the client's mandated MINIMUM COUNTS (5 cases, 30 QCM, 5
 * QROC) — those are non-negotiable per the current spec, not soft guidance,
 * so an under-count generation is rejected rather than silently accepted.
 * Résumé's mode count stays lenient (no hard minimum was mandated for it),
 * since GastriteResumeStudio already degrades gracefully on a missing mode.
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

const GastriteRawCaseSchema = z.object({
  id: z.string(),
  numero: z.number(),
  archetype: z.string(),
  icon: z.string(),
  color: z.string(),
  titre: z.string(),
  scene: z.string(),
  vitals: z.array(VitalItemSchema),
  acte1_interrogatoire: z.array(DialogueLineSchema),
  acte2_examen_physique: z.array(ExamStepSchema),
  acte3_examens_complementaires: z.array(ParaclinicalItemSchema),
  acte4_raisonnement: z.object({ items: z.array(DdxItemSchema), conclusion: z.string() }),
  acte5_prise_en_charge: z.object({ items: z.array(RxItemSchema), surveillance: z.string() }),
});

/** Client mandate: minimum absolu de 5 cas cliniques distincts — see STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT's override in lib/ai/studio-prompts.ts. */
export const StudioCasCliniqueSchema = z.object({
  titre_section: z.string(),
  cases: z.array(GastriteRawCaseSchema).min(5),
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

/** Client mandate: minimum absolu de 30 QCM et 5 QROC — see STUDIO_QCMS_SYSTEM_PROMPT's override in lib/ai/studio-prompts.ts. */
export const StudioQcmsSchema = z.object({
  titre_section: z.string(),
  qcms: z.array(QcmItemSchema).min(30),
  qrocs: z.array(QrocItemSchema).min(5),
});

const StudioTextSchema = z.string().min(50);

export const MindMapNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["symptome", "mecanisme", "diagnostic", "examen", "traitement"]),
  /**
   * Not a strict enum on purpose — resolveLucideIcon (lib/lucide-icon-lookup.ts)
   * already falls back to a sensible default on any unrecognized value, the
   * same lenient pattern GastriteRawCaseSchema uses for its own "icon"
   * field. Rejecting a whole generation over one slightly-off icon name
   * the model picked would hurt reliability more than a generic fallback
   * icon ever would. Rendered directly as a React icon component by
   * DynamicMindMapStudio (v7, the restored HTML hybrid) — see that file's
   * header comment for why the "bake it into the Ideogram image instead"
   * approach (v6) was tried and reverted.
   */
  icon: z.string().optional().default("stethoscope"),
  /** Short real clinical elaboration (score/classification/mechanism precision) shown under the node's label in DynamicMindMapStudio's v11 radial cards — optional/lenient like "icon" above, since a missing detail on one node must never fail the whole generation. */
  detail: z.string().optional().default(""),
});
const MindMapLinkSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional().default(""),
});

export type MindMapNodeData = z.infer<typeof MindMapNodeSchema>;

/**
 * Golden Standard hybrid (v7, = v5 restored): the reliable {nodes, links}
 * graph, rendered as HTML, PLUS an "ideogram_prompt" field — a text-free
 * image prompt sent to the real Ideogram API by
 * app/api/studio/generate/route.ts, fails open (a bonus accent
 * illustration, never a blocker). ~480 chars is a conservative floor under
 * the prompt's own "at least 80 words" ask (average English word ≈ 6 chars
 * incl. trailing space), left with margin so a slightly shorter but still
 * substantive prompt isn't falsely rejected.
 */
export const StudioMindMapSchema = z.object({
  nodes: z.array(MindMapNodeSchema).min(1),
  links: z.array(MindMapLinkSchema),
  ideogram_prompt: z.string().min(480),
});

/** One schema per Studio tile, keyed the same way as STUDIO_PROMPT_CONFIG/STUDIO_SECTION_KEYS in lib/ai/studio-prompts.ts. */
export const STUDIO_SCHEMAS: Record<DemoSectionId, z.ZodTypeAny> = {
  explication: StudioTextSchema,
  resume: StudioResumeSchema,
  cas_clinique: StudioCasCliniqueSchema,
  qcm: StudioQcmsSchema,
  mind_map: StudioMindMapSchema,
  exemples_analogies: StudioTextSchema,
};
