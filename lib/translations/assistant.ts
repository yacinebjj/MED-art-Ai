import type { Language } from "@/providers/LanguageProvider";

/**
 * Dashboard Assistant (chat) translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to
 * app/dashboard/(shell)/assistant/page.tsx's chat toolbar, attachment menu,
 * sidebar toggle, scroll-to-bottom control, and composer.
 */
export const ASSISTANT_TRANSLATIONS = {
  // ChatToolbar (per-message actions)
  regenerate: { fr: "Régénérer", en: "Regenerate" },
  regenerateResponse: { fr: "Régénérer la réponse", en: "Regenerate response" },
  copy: { fr: "Copier", en: "Copy" },
  copied: { fr: "Copié !", en: "Copied!" },
  goodResponse: { fr: "Bonne réponse", en: "Good response" },
  badResponse: { fr: "Mauvaise réponse", en: "Bad response" },
  reportResponse: { fr: "Signaler cette réponse", en: "Report this response" },
  reported: { fr: "Signalé — merci", en: "Reported — thanks" },

  // Attachment menu (ATTACHMENT_ITEMS)
  attachImage: { fr: "Importer une image", en: "Upload an image" },
  attachCamera: { fr: "Prendre une photo", en: "Take a photo" },

  // Desktop sidebar toggle
  collapseSidebar: { fr: "Réduire la barre latérale", en: "Collapse sidebar" },
  expandSidebar: { fr: "Afficher la barre latérale", en: "Show sidebar" },

  // Floating scroll-to-bottom button
  backToBottom: { fr: "Revenir en bas", en: "Back to bottom" },
  newResponseInProgress: { fr: "Nouvelle réponse en cours", en: "New response in progress" },

  // Composer
  addAttachment: { fr: "Ajouter une pièce jointe", en: "Add an attachment" },
  startDictation: { fr: "Dicter un message", en: "Dictate a message" },
  stopDictation: { fr: "Arrêter la dictée", en: "Stop dictation" },
  sendMessage: { fr: "Envoyer le message", en: "Send message" },

  // streamAssistantReply error fallback
  assistantNoReplyError: { fr: "L'assistant n'a pas pu répondre.", en: "The assistant couldn't reply." },
} satisfies Record<string, Record<Language, string>>;

export function tAssistant(key: keyof typeof ASSISTANT_TRANSLATIONS, language: Language): string {
  return ASSISTANT_TRANSLATIONS[key][language];
}
