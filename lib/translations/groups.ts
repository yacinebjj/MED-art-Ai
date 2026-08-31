import type { Language } from "@/providers/LanguageProvider";

/**
 * Study Groups translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to the
 * groups lobby (app/dashboard/(shell)/groups/page.tsx) and the chat room
 * (components/groups/ChatRoom.tsx). app/dashboard/(shell)/groups/[id]/page.tsx
 * itself has no user-facing strings of its own (it only renders <ChatRoom>),
 * so it needs no import, but is covered by this file per scope.
 *
 * The medical background-theme *names* below (cardiologyTheme..) are
 * display-only labels shown next to each swatch in ChatRoom.tsx's theme
 * menu — they are intentionally separate from that array's `id` field
 * ("cardiologie", "neurologie", ...), which is used for
 * localStorage matching/lookup and must stay untranslated.
 */
export const GROUPS_TRANSLATIONS = {
  // app/dashboard/(shell)/groups/page.tsx
  createGroupTitle: { fr: "Créer un groupe", en: "Create a group" },
  groupNameLabel: { fr: "Nom du groupe", en: "Group name" },
  groupNamePlaceholder: { fr: "Ex : Promo 16 Cardio", en: "E.g.: Cardio Class 16" },
  joinGroupTitle: { fr: "Rejoindre un groupe", en: "Join a group" },
  joinCodeLabel: { fr: "Code d'invitation", en: "Invite code" },

  // components/groups/ChatRoom.tsx
  todayLabel: { fr: "Aujourd'hui", en: "Today" },
  backToGroups: { fr: "Retour aux groupes", en: "Back to groups" },
  medicalThemeTitle: { fr: "Thème médical", en: "Medical theme" },
  sendImageAriaLabel: { fr: "Envoyer une image", en: "Send an image" },
  sendVideoAriaLabel: { fr: "Envoyer une vidéo", en: "Send a video" },
  voiceMessageAriaLabel: { fr: "Message vocal", en: "Voice message" },
  stopRecordingAriaLabel: { fr: "Arrêter l'enregistrement", en: "Stop recording" },
  messagePlaceholder: {
    fr: "Écris un message (le collage est désactivé)...",
    en: "Write a message (pasting is disabled)...",
  },
  sendButton: { fr: "Envoyer", en: "Send" },

  // components/groups/ChatRoom.tsx — medicalThemes[].name (display labels only, see file header note)
  cardiologyThemeName: { fr: "Cardiologie", en: "Cardiology" },
  neurologyThemeName: { fr: "Neurologie", en: "Neurology" },
  pneumologyThemeName: { fr: "Pneumologie", en: "Pneumology" },
  infectiologyThemeName: { fr: "Infectiologie", en: "Infectiology" },
} satisfies Record<string, Record<Language, string>>;

export function tGroups(key: keyof typeof GROUPS_TRANSLATIONS, language: Language): string {
  return GROUPS_TRANSLATIONS[key][language];
}
