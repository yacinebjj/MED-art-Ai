import type { Language } from "@/providers/LanguageProvider";

/**
 * Translations for app/dashboard/module/[id]/page.tsx's own chrome — the
 * desktop/mobile Sources panel (ModuleSourcesPanel) header, empty state, and
 * "Add a source" affordances, plus this page's own toasts. Mirrors the
 * shape/style of lib/translations.ts's own NAV_TRANSLATIONS + t() exactly;
 * kept in its own file rather than editing that one to avoid colliding with
 * any parallel work there.
 */
export const MODULE_PAGE_TRANSLATIONS = {
  // ModuleSourcesPanel — desktop header
  sourcesHeading: { fr: "Sources", en: "Sources" },
  closePanelAriaLabel: { fr: "Fermer le panneau", en: "Close panel" },
  collapsePanelAriaLabel: { fr: "Réduire le panneau", en: "Collapse panel" },
  openPanelAriaLabel: { fr: "Ouvrir le panneau", en: "Open panel" },
  searchWebPlaceholder: { fr: "Rechercher sur le web...", en: "Search the web..." },
  selectSourceAriaLabel: { fr: "Inclure dans la conversation", en: "Include in conversation" },

  // ModuleSourcesPanel — empty state
  noSourcesEmptyState: {
    fr: "Aucun support n'a été ajouté à ce module",
    en: "No material has been added to this module yet",
  },

  // ModuleSourcesPanel — course list row
  activeCourseLabel: { fr: "Cours actif", en: "Active course" },
  clickToOpenLabel: { fr: "Cliquer pour ouvrir", en: "Click to open" },

  // ModuleSourcesPanel — "Add a source" (mobile pill button + Add-sources dialog title)
  addSourceLabel: { fr: "Ajouter une source", en: "Add a source" },
  masteryAriaLabel: { fr: "Maîtrise", en: "Mastery" },

  // ModuleWorkspacePage — toasts
  toastSourceAdded: { fr: "Source ajoutée", en: "Source added" },
  toastLoadFailed: { fr: "Échec du chargement", en: "Failed to load" },
  toastGenerationFailed: { fr: "Échec de la génération", en: "Generation failed" },
  toastDeleteFailed: { fr: "Échec de la suppression", en: "Deletion failed" },
} satisfies Record<string, Record<Language, string>>;

export function tModulePage(key: keyof typeof MODULE_PAGE_TRANSLATIONS, language: Language): string {
  return MODULE_PAGE_TRANSLATIONS[key][language];
}
