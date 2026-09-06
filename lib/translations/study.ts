import type { Language } from "@/providers/LanguageProvider";

/**
 * Translations for app/dashboard/(shell)/study/page.tsx — the study page's
 * own tab labels and Pomodoro control tooltips. Mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS + t() exactly; kept in its own
 * file rather than editing that one to avoid colliding with any parallel
 * work there.
 */
export const STUDY_TRANSLATIONS = {
  pageTitle: { fr: "Espace de Révision", en: "Study Space" },
  pageSubtitle: {
    fr: "Points faibles, flashcards et sessions de concentration — tout au même endroit.",
    en: "Weak points, flashcards, and focus sessions — all in one place.",
  },
  weakPoints: { fr: "Points Faibles", en: "Weak Points" },
  flashcards: { fr: "Flashcards", en: "Flashcards" },
  pomodoro: { fr: "Pomodoro", en: "Pomodoro" },
  pause: { fr: "Pause", en: "Pause" },
  start: { fr: "Démarrer", en: "Start" },
  reset: { fr: "Réinitialiser", en: "Reset" },
} satisfies Record<string, Record<Language, string>>;

export function tStudy(key: keyof typeof STUDY_TRANSLATIONS, language: Language): string {
  return STUDY_TRANSLATIONS[key][language];
}
