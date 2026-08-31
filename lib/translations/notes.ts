import type { Language } from "@/providers/LanguageProvider";

/**
 * My Notes page translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to
 * app/dashboard/(shell)/notes/page.tsx.
 */
export const NOTES_TRANSLATIONS = {
  pageTitle: { fr: "Mes notes", en: "My Notes" },
  notebookEmpty: { fr: "Ton carnet est vide", en: "Your notebook is empty" },
  createFirstNote: { fr: "Créer ma première note", en: "Create my first note" },
  newNote: { fr: "Nouvelle note", en: "New note" },
  titlePlaceholder: { fr: "Titre de la note", en: "Note title" },
  toastNoteSaved: { fr: "Note enregistrée", en: "Note saved" },
  toastNoteDeleted: { fr: "Note supprimée", en: "Note deleted" },
  toastNoteRenamed: { fr: "Note renommée", en: "Note renamed" },
  toastErrorTitle: { fr: "Échec", en: "Failed" },
  toastErrorUnknown: { fr: "Erreur inconnue.", en: "Unknown error." },
  unsavedChanges: { fr: "Modifications non enregistrées", en: "Unsaved changes" },
  renameDialogTitle: { fr: "Renommer la note", en: "Rename note" },
} satisfies Record<string, Record<Language, string>>;

export function tNotes(key: keyof typeof NOTES_TRANSLATIONS, language: Language): string {
  return NOTES_TRANSLATIONS[key][language];
}
