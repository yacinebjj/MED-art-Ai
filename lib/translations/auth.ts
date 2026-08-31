import type { Language } from "@/providers/LanguageProvider";

/**
 * Auth (login/register) translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to
 * app/(auth)/login/page.tsx, app/(auth)/register/page.tsx,
 * components/auth/AuthLayout.tsx, components/auth/LoginForm.tsx and
 * components/auth/RegisterForm.tsx. Only the specific strings called out
 * for this pass are covered here — most of both forms' copy ("Adresse
 * e-mail", "Se connecter", "Créer mon compte", error messages, etc.) is
 * left as French-only text, same as the rest of the app's incremental
 * translation effort.
 */
export const AUTH_TRANSLATIONS = {
  // app/(auth)/login/page.tsx (via components/auth/AuthLayout.tsx)
  loginTitle: { fr: "Bon retour parmi nous", en: "Welcome back" },
  loginSubtitle: {
    fr: "Connecte-toi pour retrouver tes cours et continuer tes révisions.",
    en: "Sign in to pick up your courses and continue your revision.",
  },

  // app/(auth)/register/page.tsx (via components/auth/AuthLayout.tsx)
  registerTitle: { fr: "Crée ton compte étudiant", en: "Create your student account" },
  registerSubtitle: {
    fr: "Renseigne ton profil pour recevoir un contenu adapté à ta spécialité et ton année.",
    en: "Fill in your profile to get content tailored to your specialty and year.",
  },

  // components/auth/RegisterForm.tsx
  verifyEmailTitle: { fr: "Vérifie ta boîte mail", en: "Check your inbox" },
  fullNameLabel: { fr: "Nom complet", en: "Full name" },
  fullNamePlaceholder: { fr: "Ex : Amine Belkacem", en: "E.g.: Amine Belkacem" },
  facultyPlaceholder: { fr: "Choisis ta faculté", en: "Choose your faculty" },
  specialtyLabel: { fr: "Spécialité", en: "Specialty" },
  yearLabel: { fr: "Année", en: "Year" },

  // components/auth/LoginForm.tsx + components/auth/RegisterForm.tsx
  passwordLabel: { fr: "Mot de passe", en: "Password" },
} satisfies Record<string, Record<Language, string>>;

export function tAuth(key: keyof typeof AUTH_TRANSLATIONS, language: Language): string {
  return AUTH_TRANSLATIONS[key][language];
}
