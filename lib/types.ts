export type Specialty = "medicine" | "dentistry" | "pharmacy";

/** Subset of the profile needed to personalize AI-generated content. */
export interface StudentProfile {
  fullName: string;
  email?: string;
  university: string;
  specialty: Specialty;
  academicYear: string;
}

export type CourseStatus = "processing" | "ready" | "error";

export type SourceFileType = "pdf" | "pptx" | "docx" | "txt";

export interface Course {
  id: string;
  title: string;
  subject: string;
  fileType: SourceFileType;
  fileSizeLabel: string;
  status: CourseStatus;
  uploadedAt: string;
  errorMessage?: string;
}

/**
 * Everything that can be generated/displayed for a course in the workspace.
 * "cours_oral" is the primary, always-first-generated transcript shown in the
 * center reader; the rest are the Studio panel's on-demand artifacts. Each
 * has its own dedicated prompt builder (see lib/prompts/) and its own cache
 * slot — there is no shared mega-prompt anymore (see lib/sub-units.ts for
 * "cas_clinique" and "qcm", which are further split into sub-units so a
 * single AI call never has to produce the whole tab's content at once).
 */
export type ContentType =
  | "cours_oral"
  | "explication"
  | "mode_visuel"
  | "resume"
  | "cas_clinique"
  | "qcm";

/** The two content types generated as several parallel sub-units rather than one call — see lib/sub-units.ts. */
export type ChunkedContentType = "cas_clinique" | "qcm";

/** The remaining content types, each filled by exactly one dedicated AI call. */
export type SingleUnitContentType = Exclude<ContentType, ChunkedContentType>;

export const STUDIO_CONTENT_TYPES: { id: SingleUnitContentType; label: string }[] = [
  { id: "explication", label: "Explication Ultra-Détaillée" },
  { id: "mode_visuel", label: "Mode Visuel" },
  { id: "resume", label: "Résumé" },
];

/** Rendered via their own dedicated Live components (see components/course/workspace/), not through CenterReader. */
export const STUDIO_CHUNKED_CONTENT_TYPES: { id: ChunkedContentType; label: string }[] = [
  { id: "cas_clinique", label: "Cas Clinique" },
  { id: "qcm", label: "Examen QCMs" },
];

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/* ----------------------------------------------------------------------- */
/* Structured shapes for the two chunked content types. Every field is a    */
/* plain string (not Markdown) so the AI's JSON output can be validated     */
/* field-by-field before caching — see lib/ai/generate-course-content.ts.   */
/* ----------------------------------------------------------------------- */

export interface ClinicalCaseDialogueLine {
  speaker: "patient" | "medecin" | "autre";
  name: string;
  tone: string;
  text: string;
  /** Only médecin lines carry one — a patient's raw quote doesn't need a physiopathology note. */
  pourquoi?: string;
}

export interface ClinicalCaseExamStep {
  action: string;
  pourquoi: string;
}

export interface ClinicalCaseParaclinicalItem {
  label: string;
  result: string;
  pourquoi: string;
}

export interface ClinicalCaseDdxItem {
  maladie: string;
  raisonnement: string;
  pourquoi: string;
}

export interface ClinicalCaseRxItem {
  ligne: string;
  pourquoi: string;
}

export interface ClinicalCaseVital {
  label: string;
  value: string;
  alert?: boolean;
}

/** One fully-generated clinical case — the payload for a single "cas_clinique" sub-unit. */
export interface ClinicalCase {
  numero: number;
  archetype: string;
  titre: string;
  scene: string;
  vitals: ClinicalCaseVital[];
  acte1: ClinicalCaseDialogueLine[];
  acte2: ClinicalCaseExamStep[];
  acte3: ClinicalCaseParaclinicalItem[];
  acte4: { items: ClinicalCaseDdxItem[]; conclusion: string };
  acte5: { items: ClinicalCaseRxItem[]; surveillance: string };
}

export interface QcmOption {
  label: string;
  text: string;
}

export interface QcmExplication {
  globale: string;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
}

/** One QCM — the payload for a "qcm" batch sub-unit is a QcmItem[]. */
export interface QcmItem {
  id: number;
  question: string;
  options: QcmOption[];
  reponsesCorrectes: string[];
  explication: QcmExplication;
}

/** One QROC — the payload for the "qroc" sub-unit is a QrocItem[]. */
export interface QrocItem {
  id: number;
  question: string;
  reponseOfficielle: string;
}
