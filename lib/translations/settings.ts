import type { Language } from "@/providers/LanguageProvider";

/**
 * Settings & Billing translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to the two
 * thematically-related account pages: app/dashboard/(shell)/settings/page.tsx
 * and app/dashboard/(shell)/billing/page.tsx.
 */
export const SETTINGS_TRANSLATIONS = {
  // app/dashboard/(shell)/settings/page.tsx
  profileSettingsTitle: { fr: "Paramètres du profil", en: "Profile settings" },
  accountInfoTitle: { fr: "Informations du compte", en: "Account information" },
  fullNameLabel: { fr: "Nom complet", en: "Full name" },
  choosePlaceholder: { fr: "Choisis", en: "Choose" },
  chooseSpecialtyFirstPlaceholder: { fr: "Choisis d'abord une spécialité", en: "Choose a specialty first" },
  loadingEllipsis: { fr: "Chargement...", en: "Loading..." },
  saved: { fr: "Enregistré", en: "Saved" },
  saveChanges: { fr: "Enregistrer les modifications", en: "Save changes" },
  flashRemindersTitle: { fr: "Rappels flash", en: "Flash reminders" },
  lockedPill: { fr: "Verrouillé", en: "Locked" },

  // app/dashboard/(shell)/billing/page.tsx
  subscriptionTitle: { fr: "Abonnement", en: "Subscription" },
  currentSubscription: { fr: "Abonnement actuel", en: "Current subscription" },
  changeSubscription: { fr: "Changer d'abonnement", en: "Change subscription" },
  hidePlans: { fr: "Masquer les formules", en: "Hide plans" },
  paymentMethod: { fr: "Moyen de paiement", en: "Payment method" },
  invoiceHistory: { fr: "Historique des factures", en: "Invoice history" },
  invoiceColumn: { fr: "Facture", en: "Invoice" },
  dateColumn: { fr: "Date", en: "Date" },
  statusColumn: { fr: "Statut", en: "Status" },
  amountColumn: { fr: "Montant", en: "Amount" },
  paidStatus: { fr: "Payé", en: "Paid" },
  failedStatus: { fr: "Échoué", en: "Failed" },
  comingSoon: { fr: "Bientôt disponible", en: "Coming soon" },
  usageStatsTitle: { fr: "Statistiques d'utilisation", en: "Usage statistics" },
  hoursStudiedLabel: { fr: "Heures d'étude", en: "Hours studied" },
  summariesGeneratedLabel: { fr: "Résumés générés", en: "Summaries generated" },
  examsTakenLabel: { fr: "Examens passés", en: "Exams taken" },
} satisfies Record<string, Record<Language, string>>;

export function tSettings(key: keyof typeof SETTINGS_TRANSLATIONS, language: Language): string {
  return SETTINGS_TRANSLATIONS[key][language];
}
