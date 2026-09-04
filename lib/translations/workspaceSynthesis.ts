import type { Language } from "@/providers/LanguageProvider";

/**
 * Translations for app/dashboard/workspace/module/[moduleId]/page.tsx — the
 * per-module synthesis workspace (source selection, global summary /
 * keyword table generation, and its result history). Mirrors the
 * shape/style of lib/translations.ts's own NAV_TRANSLATIONS + t() exactly;
 * kept in its own file rather than editing that one to avoid colliding with
 * any parallel work there.
 *
 * Strings that embed dynamic values (course counts) keep only their static
 * template pieces here, with a {n} (or {cached}/{generated}) placeholder —
 * the caller interpolates the actual number, same pattern as
 * lib/translations/todo.ts's own selectedCountSingular/selectedCountPlural.
 */
export const WORKSPACE_SYNTHESIS_TRANSLATIONS = {
  // Passed to WorkspaceTopbar as this page's own default title (BEFORE the
  // real module title has loaded from the API) — WorkspaceTopbar itself is
  // already translated separately (lib/translations/workspaceTopbar.ts).
  defaultModuleTitle: { fr: "Résumé du module", en: "Module summary" },

  // Sources sidebar
  sourcesHeading: { fr: "Sources du module", en: "Module sources" },

  // Result history list
  resultsHeading: { fr: "Résultats", en: "Results" },
  entryTypeSummary: { fr: "Résumé", en: "Summary" },
  entryTypeTable: { fr: "Tableau", en: "Table" },
  entryTypeDictionary: { fr: "Dictionnaire", en: "Dictionary" },

  // Minimum-selection gate (MIN_COURSES_REQUIRED) — shown both as an info
  // toast when generation is attempted too early, and as a persistent hint
  // next to the generation buttons.
  minSelectionToast: {
    fr: "Sélectionne au moins {n} cours pour générer cette synthèse.",
    en: "Select at least {n} courses to generate this synthesis.",
  },
  minSelectionHint: {
    fr: "Sélectionne au moins {n} cours dans la barre latérale",
    en: "Select at least {n} courses in the sidebar",
  },

  // Generation result toasts
  fullyCachedTitle: { fr: "Entièrement en cache", en: "Fully cached" },
  fullyCachedDescription: {
    fr: "Résultat instantané, aucun coût de génération.",
    en: "Instant result, no generation cost.",
  },
  partialGenerationTitle: { fr: "Génération partielle", en: "Partial generation" },
  partialGenerationDescription: {
    fr: "{cached} cours déjà en cache, {generated} générés à l'instant.",
    en: "{cached} courses already cached, {generated} generated just now.",
  },
  generationFailedTitle: { fr: "Échec de la génération", en: "Generation failed" },
  generationFailedRetryDescription: { fr: "Réessaie.", en: "Try again." },
  generationFailedServerDescription: {
    fr: "Impossible de contacter le serveur.",
    en: "Unable to reach the server.",
  },
} satisfies Record<string, Record<Language, string>>;

export function tWorkspaceSynthesis(key: keyof typeof WORKSPACE_SYNTHESIS_TRANSLATIONS, language: Language): string {
  return WORKSPACE_SYNTHESIS_TRANSLATIONS[key][language];
}
