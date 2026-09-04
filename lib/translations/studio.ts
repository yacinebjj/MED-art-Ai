import type { Language } from "@/providers/LanguageProvider";
import type { DemoSectionId } from "@/lib/demo-content";

/**
 * Translations for the Studio right panel (StudioPanel.tsx,
 * MobileStudioCards.tsx) — heading/menu/aria-label copy for the study-mode
 * grid, the "recently generated" list, and the note editor. Mirrors the
 * shape/style of lib/translations.ts's own NAV_TRANSLATIONS + t() exactly;
 * kept in its own file rather than editing that one to avoid colliding with
 * any parallel work there.
 */
export const STUDIO_TRANSLATIONS = {
  studioHeading: { fr: "Studio", en: "Studio" },
  recentlyGenerated: { fr: "Récemment généré", en: "Recently generated" },
  regenerate: { fr: "Régénérer", en: "Regenerate" },
  delete: { fr: "Supprimer", en: "Delete" },
  normal: { fr: "Normal", en: "Normal" },
  notePlaceholder: { fr: "Écris ta note ici...", en: "Write your note here..." },
  save: { fr: "Sauvegarder", en: "Save" },
  deleteNoteAria: { fr: "Supprimer la note", en: "Delete note" },
  expandAria: { fr: "Agrandir", en: "Expand" },
  openPanelAria: { fr: "Ouvrir le panneau", en: "Open panel" },
  collapsePanelAria: { fr: "Réduire le panneau", en: "Collapse panel" },
  undoAria: { fr: "Annuler", en: "Undo" },
  redoAria: { fr: "Rétablir", en: "Redo" },
  boldAria: { fr: "Gras", en: "Bold" },
  italicAria: { fr: "Italique", en: "Italic" },
  linkAria: { fr: "Lien", en: "Link" },
  codeAria: { fr: "Code", en: "Code" },
  /** The fullscreen-overlay exit control (Minimize2 icon) — distinct from collapsePanelAria above, which is the docked panel's own collapse toggle. */
  minimizeAria: { fr: "Réduire", en: "Minimize" },
  alreadyGeneratedCaption: { fr: "Déjà généré — appuie pour ouvrir", en: "Already generated — tap to open" },
  tapToGenerateCaption: { fr: "Appuie pour générer", en: "Tap to generate" },
  emptyState: { fr: "Les résultats de Studio seront enregistrés ici.", en: "Studio results will be saved here." },
  generateAction: { fr: "Générer", en: "Generate" },
  optionsMenuAria: { fr: "Options de génération", en: "Generation options" },
} satisfies Record<string, Record<Language, string>>;

export function tStudio(key: keyof typeof STUDIO_TRANSLATIONS, language: Language): string {
  return STUDIO_TRANSLATIONS[key][language];
}

/**
 * Section-label lookup for DEMO_SECTIONS tiles. lib/demo-content.ts's own
 * DemoSection.label field is a plain string read by many consumers across
 * the app (app/dashboard/module/[id]/page.tsx, app/dashboard/demo/[slug]/
 * page.tsx, app/dashboard/demo/page.tsx, lib/course-slug-content.ts, etc.),
 * so translating that field directly would silently break every consumer
 * that isn't ALSO updated to call this lookup. This function only backs the
 * two render call sites actually in scope here (StudioPanel.tsx,
 * MobileStudioCards.tsx) — every other consumer keeps reading
 * section.label untouched, deliberately, to avoid a partial/inconsistent
 * translation.
 */
const SECTION_LABELS: Record<DemoSectionId, Record<Language, string>> = {
  explication: { fr: "Explication Ultra-Détaillée", en: "Ultra-Detailed Explanation" },
  resume: { fr: "Résumé", en: "Summary" },
  // "Cas Cliniques" (pluriel) — 3ème année et + génère réellement 3 cas
  // distincts (STUDIO_CAS_CLINIQUE_SYSTEM_PROMPT, lib/ai/studio-prompts.ts),
  // ce label est le "standard" par défaut (studyYear absent/inconnu/>=3) —
  // voir getSectionLabel ci-dessous pour les variantes 1ère/2ème année.
  cas_clinique: { fr: "Cas Cliniques", en: "Clinical Cases" },
  qcm: { fr: "Examen QCMs", en: "MCQ Exam" },
  exemples_analogies: { fr: "Exemples & Analogies", en: "Examples & Analogies" },
  infographic: { fr: "Infographie", en: "Infographic" },
  audio: { fr: "Podcast Audio", en: "Audio Podcast" },
};

/** Cas Clinique's own year-dependent labels — see StudioPanel.tsx/MobileStudioCards.tsx's studyYear prop and app/api/studio/generate/route.ts's resolveCasCliniqueSystemPrompt for the matching backend behavior. Every OTHER section id ignores `studyYear` entirely. */
const CAS_CLINIQUE_LABEL_BY_YEAR: Record<1 | 2, Record<Language, string>> = {
  1: { fr: "Utilité Clinique", en: "Clinical Relevance" },
  2: { fr: "Cas Clinique (Physiologique)", en: "Clinical Case (Physiological)" },
};

/**
 * `studyYear` — the student's own curriculum level (StudentCurriculumProfile.
 * academicYear.level, types/academic.ts). Optional and only ever consulted
 * for `id === "cas_clinique"`; every other section's label is completely
 * unaffected, and an omitted/unrecognized year (anything but exactly 1 or 2)
 * falls through to the standard "Cas Cliniques" label — the same one this
 * section has always shown.
 */
export function getSectionLabel(id: DemoSectionId, language: Language, studyYear?: number | null): string {
  if (id === "cas_clinique" && (studyYear === 1 || studyYear === 2)) {
    return CAS_CLINIQUE_LABEL_BY_YEAR[studyYear][language];
  }
  return SECTION_LABELS[id][language];
}
