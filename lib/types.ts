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
 * Each field is a full Markdown block for that section, produced by the
 * "professeur" mega-prompt (see lib/prompts/course-generation.ts). One AI
 * call fills all 6 at once — see lib/course-content-cache.ts.
 */
export interface CourseContent {
  explication: string;
  resume: string;
  pieges: string;
  astuces: string;
  casClinique: string;
  qcm: string;
}

/**
 * Everything that can be generated/displayed for a course in the workspace.
 * "coursOral" is the primary, always-first-generated transcript shown in the
 * center reader; the rest are the Studio panel's on-demand artifacts.
 */
export type ContentType =
  | "cours_oral"
  | "explication"
  | "resume"
  | "pieges"
  | "astuces"
  | "cas_clinique"
  | "qcm";

export const STUDIO_CONTENT_TYPES: { id: ContentType; label: string }[] = [
  { id: "explication", label: "Explication Ultra-Détaillée" },
  { id: "resume", label: "Résumé" },
  { id: "pieges", label: "Les Pièges" },
  { id: "astuces", label: "Astuces Mnémotechniques" },
  { id: "cas_clinique", label: "Cas Clinique" },
  { id: "qcm", label: "Examen QCMs" },
];

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
