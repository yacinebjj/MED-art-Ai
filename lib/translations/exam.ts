import type { Language } from "@/providers/LanguageProvider";

/**
 * Custom Exam Generator translations (app/dashboard/module/[id]/exam/page.tsx)
 * — mirrors the shape/style of lib/translations.ts's own NAV_TRANSLATIONS/t()
 * exactly. Scoped to a handful of strings on that page: the left panel's
 * "Cours du module" heading, the results "Score final" card, the
 * regenerate/attempts-remaining button (count interpolated the same way as
 * lib/translations/todo.ts's own selectedCountSingular/Plural), the
 * "Générer un nouvel examen" button, and the two error toasts. Most of the
 * page's other French copy (idle/generating/testing states, etc.) is
 * intentionally left untranslated here — out of this pass's scope.
 */
export const EXAM_TRANSLATIONS = {
  coursesOfModule: { fr: "Cours du module", en: "Module courses" },
  finalScore: { fr: "Score final", en: "Final score" },

  /** {n} placeholder — replaced by the caller, same pattern as todo.ts's selectedCountSingular/Plural. */
  regenerateCountSingular: {
    fr: "Régénérer avec les mêmes cours ({n} tentative restante)",
    en: "Regenerate with the same courses ({n} attempt remaining)",
  },
  regenerateCountPlural: {
    fr: "Régénérer avec les mêmes cours ({n} tentatives restantes)",
    en: "Regenerate with the same courses ({n} attempts remaining)",
  },
  noRegenerationsLeft: {
    fr: "Aucune tentative de régénération restante",
    en: "No regeneration attempts remaining",
  },

  generateNewExam: {
    fr: "Générer un nouvel examen (choisir d'autres cours)",
    en: "Generate a new exam (choose different courses)",
  },

  resultsNotSavedTitle: { fr: "Résultats non sauvegardés", en: "Results not saved" },
  resultsNotSavedFallbackDescription: {
    fr: "Tu pourras revoir la correction maintenant, mais elle ne sera pas retrouvée si tu reviens plus tard.",
    en: "You'll be able to review the correction now, but it won't be found again if you come back later.",
  },
  resultsNotSavedNetworkDescription: {
    fr: "Impossible de contacter le serveur — la correction reste visible maintenant, mais ne sera pas retrouvée si tu reviens plus tard.",
    en: "Unable to reach the server — the correction stays visible now, but won't be found again if you come back later.",
  },

  generationFailedTitle: { fr: "Échec de la génération", en: "Generation failed" },
  generationFailedFallbackDescription: { fr: "Réessaie.", en: "Try again." },
  generationFailedNetworkDescription: {
    fr: "Impossible de contacter le serveur.",
    en: "Unable to reach the server.",
  },
} satisfies Record<string, Record<Language, string>>;

export function tExam(key: keyof typeof EXAM_TRANSLATIONS, language: Language): string {
  return EXAM_TRANSLATIONS[key][language];
}
