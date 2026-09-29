import type { Language } from "@/providers/LanguageProvider";

/**
 * Study-tools translations — mirrors the shape/style of lib/translations.ts's
 * own NAV_TRANSLATIONS/t() exactly, scoped to the three components rendered
 * inside the already-translated Study page's tabs
 * (app/dashboard/(shell)/study/page.tsx): ActiveFlashcardsDeck.tsx,
 * FlipFlashcard.tsx and WeaknessRemediationPlan.tsx. Strings that embed
 * dynamic values (counts, dates) keep only their static template pieces
 * here — the dynamic parts are interpolated in the component code, same as
 * before.
 *
 * A few keys (serverContactError, noActiveModulesTitle) are genuinely
 * identical French/English text shared by two of these components' own
 * status branches, so they're declared once here and reused from both.
 */
export const STUDY_TOOLS_TRANSLATIONS = {
  // Shared across ActiveFlashcardsDeck.tsx and WeaknessRemediationPlan.tsx
  serverContactError: { fr: "Impossible de contacter le serveur.", en: "Unable to reach the server." },
  noActiveModulesTitle: { fr: "Aucun module actif.", en: "No active modules." },

  // components/study/ActiveFlashcardsDeck.tsx
  preparingFlashcards: { fr: "Préparation de tes flashcards...", en: "Preparing your flashcards..." },
  signInForFlashcards: { fr: "Connecte-toi pour voir tes flashcards.", en: "Sign in to see your flashcards." },
  noActiveModulesFlashcardsSubtitle: {
    fr: "Active les flashcards depuis ton tableau de bord (menu ⋮ d'un module, « Activer les Flashcards »).",
    en: "Activate flashcards from your dashboard (⋮ menu on a module, \"Activate Flashcards\").",
  },
  emptyPoolTitle: { fr: "Pas encore de contenu à réviser.", en: "No content to review yet." },
  emptyPoolSubtitle: {
    fr: "Génère d'abord l'Explication d'un cours dans un de tes modules activés — les flashcards en sont extraites automatiquement.",
    en: "First generate a course's Explanation in one of your activated modules — flashcards are extracted from it automatically.",
  },
  flashcardQuotaTitle: {
    fr: "Limite de flashcards atteinte pour ta formule ce mois-ci.",
    en: "Flashcard limit reached for your plan this month.",
  },
  flashcardQuotaSubtitle: {
    fr: "Passe à une formule supérieure pour continuer à générer des flashcards.",
    en: "Upgrade your plan to keep generating flashcards.",
  },
  generatingNewFlashcards: { fr: "Génération de nouvelles flashcards...", en: "Generating new flashcards..." },
  sessionCompleteStreak: { fr: "Fin de la session — belle série !", en: "Session complete — nice streak!" },
  deckExhausted: {
    fr: "Bravo ! Tu as fait le tour des flashcards disponibles pour ce(s) cours.",
    en: "Well done! You've gone through all the flashcards available for these course(s).",
  },
  restartSession: { fr: "Recommencer une session", en: "Restart a session" },
  flashcardsActiveModulesTitle: { fr: "Flashcards — Modules Actifs", en: "Flashcards — Active Modules" },
  preparingMoreInBackground: {
    fr: "Préparation de la suite en arrière-plan...",
    en: "Preparing more in the background...",
  },

  // components/study/FlipFlashcard.tsx
  cardCounterLabel: { fr: "Carte", en: "Card" },
  /** {n} placeholder — replaced by the caller. French pluralizes "restante"; English doesn't need a separate plural form, but both are kept as whole-template strings for symmetry with the singular/plural pattern used elsewhere (see lib/translations/todo.ts). */
  cardsRemainingSingular: { fr: "{n} restante", en: "{n} remaining" },
  cardsRemainingPlural: { fr: "{n} restantes", en: "{n} remaining" },
  lastCard: { fr: "Dernière carte", en: "Last card" },
  ariaReturnToQuestion: { fr: "Revenir à la question", en: "Return to the question" },
  ariaSeeAnswer: { fr: "Voir la réponse", en: "See the answer" },
  questionLabel: { fr: "Question", en: "Question" },
  answerLabel: { fr: "Réponse", en: "Answer" },
  frontHint: {
    fr: "Clique, glisse, ou appuie sur Espace, pour voir la réponse",
    en: "Click, swipe, or press Space to see the answer",
  },
  backHint: {
    fr: "Clique, glisse, ou appuie sur Espace, pour revenir à la question",
    en: "Click, swipe, or press Space to return to the question",
  },
  feedbackCorrect: { fr: "Bien joué !", en: "Nice job!" },
  feedbackIncorrect: { fr: "Pas grave, on continue", en: "No worries, keep going" },
  buttonSeeQuestion: { fr: "Voir la question", en: "See the question" },
  ariaPrevCard: { fr: "Carte précédente", en: "Previous card" },
  ariaNextCard: { fr: "Carte suivante", en: "Next card" },
  reviewAgain: { fr: "À revoir", en: "Review again" },
  correctLabel: { fr: "Correct", en: "Correct" },
} satisfies Record<string, Record<Language, string>>;

export function tStudyTools(key: keyof typeof STUDY_TOOLS_TRANSLATIONS, language: Language): string {
  return STUDY_TOOLS_TRANSLATIONS[key][language];
}
