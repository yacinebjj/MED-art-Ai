import type { Language } from "@/providers/LanguageProvider";

/**
 * "Finding/browsing content" surfaces translations — mirrors the shape/style
 * of lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to the
 * semantic search page (app/dashboard/search/page.tsx), the curriculum Bento
 * grid (components/curriculum/CurriculumView.tsx), and the module global
 * summary modal (components/dashboard/GlobalSummaryModal.tsx). Strings that
 * embed dynamic values (counts) keep only their static template pieces here
 * — the dynamic parts are interpolated in the component code, same as
 * lib/translations/todo.ts's {n}-placeholder pattern.
 */
export const DISCOVERY_TRANSLATIONS = {
  // app/dashboard/search/page.tsx
  searchPlaceholder: {
    fr: "Ex : structure mitochondriale, signes de l'appendicite...",
    en: "E.g.: mitochondrial structure, signs of appendicitis...",
  },
  searchAriaLabel: { fr: "Rechercher", en: "Search" },
  searchButton: { fr: "Rechercher", en: "Search" },
  noModuleGroup: { fr: "Sans module", en: "No module" },
  // "God-Tier" pass — replaces a pre-existing, inaccurate "recherche
  // sémantique" claim: app/api/search/route.ts is deliberately plain
  // substring matching over the student's own studio_courses (see that
  // route's own header comment), not an embeddings/semantic index. This is
  // the honest description of what the feature actually does.
  searchSubtitle: {
    fr: "Recherche par mot-clé dans tes cours — trouve instantanément où un terme apparaît.",
    en: "Keyword search across your courses — instantly find where a term appears.",
  },
  /** {n} placeholder — real result count, {q} placeholder — the raw query text. */
  resultsCountLabel: {
    fr: "{n} résultat{s} pour « {q} »",
    en: "{n} result{s} for “{q}”",
  },

  // components/curriculum/CurriculumView.tsx
  independentModulesHeading: { fr: "Modules Indépendants", en: "Independent Modules" },
  modulesHeading: { fr: "Modules", en: "Modules" },
  sourcesDeleted: { fr: "Sources supprimées", en: "Sources deleted" },
  deleteSourcesFailed: { fr: "Échec de la suppression", en: "Deletion failed" },
  enableWeaknesses: { fr: "Activer les points faibles", en: "Enable weak points" },
  disableWeaknesses: { fr: "Désactiver les points faibles", en: "Disable weak points" },
  updateFailed: { fr: "Échec de la mise à jour", en: "Update failed" },

  // components/dashboard/GlobalSummaryModal.tsx
  globalSummaryTitle: { fr: "Résumé global du module", en: "Module global summary" },
  generateButton: { fr: "Générer", en: "Generate" },
  regenerateButton: { fr: "Régénérer", en: "Regenerate" },
  globalSummaryGenerated: { fr: "Résumé global généré", en: "Global summary generated" },
  generationFailed: { fr: "Échec de la génération", en: "Generation failed" },
  /** {n} placeholder — replaced by the caller with MIN_COURSES_REQUIRED. */
  selectAtLeastNCourses: {
    fr: "Sélectionne au moins {n} cours pour générer un résumé global.",
    en: "Select at least {n} courses to generate a global summary.",
  },
  /** {n} placeholder — MIN_COURSES_REQUIRED; {x} placeholder — the current selected count. */
  selectAtLeastNCoursesWithCount: {
    fr: "Sélectionne au moins {n} cours ({x}/{n}) pour générer un résumé global.",
    en: "Select at least {n} courses ({x}/{n}) to generate a global summary.",
  },
} satisfies Record<string, Record<Language, string>>;

export function tDiscovery(key: keyof typeof DISCOVERY_TRANSLATIONS, language: Language): string {
  return DISCOVERY_TRANSLATIONS[key][language];
}
