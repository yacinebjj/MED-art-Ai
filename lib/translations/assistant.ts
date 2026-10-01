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

  // Composer
  composerPlaceholder: { fr: "Écris à MedArt Assistant…", en: "Message MedArt Assistant…" },
  stopGeneration: { fr: "Arrêter la génération", en: "Stop generating" },
  listening: { fr: "J'écoute…", en: "Listening…" },
  removeMode: { fr: "Retirer ce mode", en: "Remove this mode" },

  // Quick actions (chips above the composer) — label + what to type next
  quickActionsLabel: { fr: "Actions rapides", en: "Quick actions" },
  modeClinicalCase: { fr: "Cas clinique", en: "Clinical case" },
  modeMcq: { fr: "QCM", en: "MCQ" },
  modeDifferential: { fr: "Diag. différentiel", en: "Differential" },
  modeSummary: { fr: "Résumé de cours", en: "Course summary" },
  modeSimplify: { fr: "Simplifier", en: "Simplify" },
  modeFlashcards: { fr: "Flashcards", en: "Flashcards" },
  placeholderClinicalCase: { fr: "Spécialité ou pathologie (ex : cardiologie)…", en: "Specialty or condition (e.g. cardiology)…" },
  placeholderMcq: { fr: "Sujet des QCM (ex : insuffisance cardiaque, 5 QCM)…", en: "MCQ topic (e.g. heart failure, 5 questions)…" },
  placeholderDifferential: { fr: "Signes ou symptômes (ex : douleur thoracique)…", en: "Signs or symptoms (e.g. chest pain)…" },
  placeholderSummary: { fr: "Colle un cours, importe un PDF ou donne un sujet…", en: "Paste a course, import a PDF or name a topic…" },
  placeholderSimplify: { fr: "Terme ou passage à simplifier…", en: "Term or passage to simplify…" },
  placeholderFlashcards: { fr: "Sujet à transformer en flashcards…", en: "Topic to turn into flashcards…" },

  // Answer settings popover
  settings: { fr: "Réglages", en: "Settings" },
  settingsTitle: { fr: "Style des réponses", en: "Answer style" },
  styleAcademic: { fr: "Académique", en: "Academic" },
  styleSimple: { fr: "Simple", en: "Simple" },
  stylePatient: { fr: "Patient", en: "Patient" },
  styleAcademicHint: { fr: "Terminologie précise, niveau faculté.", en: "Precise terminology, med-school level." },
  styleSimpleHint: { fr: "Phrases courtes, analogies, termes définis.", en: "Short sentences, analogies, defined terms." },
  stylePatientHint: { fr: "Comme tu l'expliquerais à un patient.", en: "As you would explain it to a patient." },
  stepByStep: { fr: "Raisonnement pas à pas", en: "Step-by-step reasoning" },
  stepByStepHint: { fr: "Déroule la démarche en étapes avant de conclure.", en: "Walks through the reasoning in steps before concluding." },

  // Per-message actions
  speak: { fr: "Écouter la réponse", en: "Read aloud" },
  stopSpeaking: { fr: "Arrêter la lecture", en: "Stop reading" },
  copyMarkdown: { fr: "Copier (Markdown)", en: "Copy (Markdown)" },
  saveToNotes: { fr: "Enregistrer dans Mes notes", en: "Save to My notes" },
  savedToNotes: { fr: "Enregistré dans Mes notes", en: "Saved to My notes" },
  exportPdf: { fr: "Exporter en PDF", en: "Export as PDF" },
  moreOptions: { fr: "Plus d'options", en: "More options" },
  deleteResponse: { fr: "Supprimer cette réponse", en: "Delete this response" },
  noteSavedTitle: { fr: "Réponse enregistrée", en: "Reply saved" },
  noteSavedDescription: { fr: "Retrouve-la dans « Mes notes ».", en: "Find it in “My notes”." },
  noteSavedOpen: { fr: "Ouvrir", en: "Open" },
  noteSaveFailed: { fr: "Échec de l'enregistrement", en: "Couldn't save" },
  speechUnsupported: { fr: "La lecture à voix haute n'est pas disponible sur ce navigateur.", en: "Read-aloud isn't available in this browser." },
  speechNoVoice: { fr: "Aucune voix installée sur cet appareil pour cette langue.", en: "No voice installed on this device for this language." },
  speechFailed: { fr: "Lecture impossible", en: "Couldn't read aloud" },
  speechFailedHint: { fr: "Ton navigateur a refusé la lecture vocale. Réessaie en touchant le bouton.", en: "Your browser blocked read-aloud. Try again by tapping the button." },
  exportFailed: { fr: "Impossible de préparer le PDF.", en: "Couldn't prepare the PDF." },
} satisfies Record<string, Record<Language, string>>;

export function tAssistant(key: keyof typeof ASSISTANT_TRANSLATIONS, language: Language): string {
  return ASSISTANT_TRANSLATIONS[key][language];
}
