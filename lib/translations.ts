import type { Language } from "@/providers/LanguageProvider";

/**
 * Navigation-chrome translations (Sidebar, MobileBottomNav, Topbar) — the
 * one surface that's genuinely omnipresent across every dashboard page, so
 * it's the highest-value place to wire up EN/FR switching first. This is
 * NOT a claim that every screen in the app is translated: most page bodies
 * (Studio tabs, Notes, Settings forms, etc.) are still French-only text
 * baked into their own components — translating those is a much larger,
 * separate undertaking, deliberately not attempted wholesale here.
 */
export const NAV_TRANSLATIONS = {
  dashboard: { fr: "Tableau de bord", en: "Dashboard" },
  assistant: { fr: "MedArt Assistant", en: "MedArt Assistant" },
  studySpace: { fr: "Espace Étude", en: "Study Space" },
  todo: { fr: "To-Do List", en: "To-Do List" },
  groups: { fr: "Groupes de Révision", en: "Study Groups" },
  notes: { fr: "Mes notes", en: "My Notes" },
  billing: { fr: "Abonnement", en: "Subscription" },
  settings: { fr: "Paramètres", en: "Settings" },
  more: { fr: "Plus", en: "More" },
  home: { fr: "Accueil", en: "Home" },
  study: { fr: "Étude", en: "Study" },
  signOut: { fr: "Déconnexion", en: "Sign out" },
} satisfies Record<string, Record<Language, string>>;

export function t(key: keyof typeof NAV_TRANSLATIONS, language: Language): string {
  return NAV_TRANSLATIONS[key][language];
}
