import type { Language } from "@/providers/LanguageProvider";

/**
 * Translations for components/course/workspace/WorkspaceTopbar.tsx — the
 * NotebookLM-style topbar shown above a course workspace (module/demo
 * pages). Mirrors the shape/style of lib/translations.ts's own
 * NAV_TRANSLATIONS + t() exactly; kept in its own file rather than editing
 * that one to avoid colliding with any parallel work there.
 */
export const WORKSPACE_TOPBAR_TRANSLATIONS = {
  backToDashboard: { fr: "Retour au dashboard", en: "Back to dashboard" },
  back: { fr: "Retour", en: "Back" },
  courseFallbackTitle: { fr: "Cours", en: "Course" },
  linkCopied: { fr: "Lien copié", en: "Link copied" },
  copyFailedTitle: { fr: "Échec de la copie", en: "Copy failed" },
  copyFailedDescription: {
    fr: "Impossible d'accéder au presse-papiers.",
    en: "Unable to access the clipboard.",
  },
  copyLinkAriaLabel: { fr: "Copier le lien", en: "Copy link" },
  switchToLightMode: { fr: "Passer en mode clair", en: "Switch to light mode" },
  switchToDarkMode: { fr: "Passer en mode sombre", en: "Switch to dark mode" },
  settings: { fr: "Paramètres", en: "Settings" },
  accountSettings: { fr: "Paramètres du compte", en: "Account settings" },
} satisfies Record<string, Record<Language, string>>;

export function tWorkspaceTopbar(
  key: keyof typeof WORKSPACE_TOPBAR_TRANSLATIONS,
  language: Language
): string {
  return WORKSPACE_TOPBAR_TRANSLATIONS[key][language];
}
