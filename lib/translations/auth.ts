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

  // app/(auth)/forgot-password/page.tsx (via AuthLayout) + ForgotPasswordForm.tsx
  forgotPasswordTitle: { fr: "Mot de passe oublié ?", en: "Forgot your password?" },
  forgotPasswordSubtitle: {
    fr: "Indique ton adresse e-mail, on t'envoie un lien pour en choisir un nouveau.",
    en: "Enter your email address and we'll send you a link to choose a new one.",
  },
  forgotPasswordSubmit: { fr: "Envoyer le lien de réinitialisation", en: "Send reset link" },
  forgotPasswordSentTitle: { fr: "Vérifie ta boîte mail", en: "Check your inbox" },
  forgotPasswordSentDescription: {
    fr: "Si un compte existe avec cette adresse, un lien de réinitialisation vient d'être envoyé. Clique dessus pour choisir un nouveau mot de passe.",
    en: "If an account exists for that address, a reset link was just sent. Click it to choose a new password.",
  },
  backToLogin: { fr: "Retour à la connexion", en: "Back to login" },

  // app/auth/update-password/page.tsx (via AuthLayout) + UpdatePasswordForm.tsx
  updatePasswordTitle: { fr: "Choisis un nouveau mot de passe", en: "Choose a new password" },
  updatePasswordSubtitle: {
    fr: "Ton nouveau mot de passe doit contenir au moins 8 caractères.",
    en: "Your new password must be at least 8 characters long.",
  },
  newPasswordLabel: { fr: "Nouveau mot de passe", en: "New password" },
  confirmPasswordLabel: { fr: "Confirme le mot de passe", en: "Confirm password" },
  updatePasswordSubmit: { fr: "Mettre à jour le mot de passe", en: "Update password" },
  updatePasswordSuccess: { fr: "Mot de passe mis à jour avec succès.", en: "Password updated successfully." },
  invalidRecoveryLinkTitle: { fr: "Lien invalide ou expiré", en: "Invalid or expired link" },
  invalidRecoveryLinkDescription: {
    fr: "Ce lien de réinitialisation n'est plus valide. Demande-en un nouveau.",
    en: "This reset link is no longer valid. Request a new one.",
  },
} satisfies Record<string, Record<Language, string>>;

export function tAuth(key: keyof typeof AUTH_TRANSLATIONS, language: Language): string {
  return AUTH_TRANSLATIONS[key][language];
}
