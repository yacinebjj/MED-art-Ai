import type { Language } from "@/providers/LanguageProvider";

/**
 * My Notes page translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to
 * app/dashboard/(shell)/notes/page.tsx and components/notes/*.
 */
export const NOTES_TRANSLATIONS = {
  pageTitle: { fr: "Mes notes", en: "My Notes" },
  loading: { fr: "Chargement...", en: "Loading..." },
  pageSubtitle: { fr: "Tes notes personnelles, indépendantes de tes cours.", en: "Your personal notes, independent from your courses." },
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

  // components/notes/NoteCard.tsx
  rename: { fr: "Renommer", en: "Rename" },
  delete: { fr: "Supprimer", en: "Delete" },
  noteOptionsAriaLabel: { fr: "Options de la note", en: "Note options" },

  // Sidebar (search + collapse)
  searchPlaceholder: { fr: "Rechercher une note...", en: "Search notes..." },
  collapseSidebarAriaLabel: { fr: "Réduire la liste", en: "Collapse list" },
  expandSidebarAriaLabel: { fr: "Afficher la liste", en: "Show list" },
  noSearchResults: { fr: "Aucune note ne correspond à ta recherche.", en: "No notes match your search." },

  // Editor chrome
  emptySelectionTitleWithNotes: { fr: "Choisis une note à ouvrir", en: "Choose a note to open" },
  emptySelectionBodyWithNotes: { fr: "Sélectionne une note dans la liste à gauche, ou lance-en une nouvelle.", en: "Select a note from the list on the left, or start a new one." },
  emptySelectionBodyNoNotes: { fr: "Note un résumé, une astuce ou une idée à retenir — elle sera toujours là.", en: "Jot down a summary, a tip, or an idea worth keeping — it'll always be here." },
  savingLabel: { fr: "Enregistrement...", en: "Saving..." },
  saveErrorLabel: { fr: "Échec de l'enregistrement — réessaie", en: "Save failed — try again" },
  savedLabel: { fr: "Enregistré", en: "Saved" },
  saveButton: { fr: "Sauvegarder", en: "Save" },
  organizeButton: { fr: "Organiser avec l'IA", en: "Organize with AI" },
  organizingLabel: { fr: "Organisation en cours...", en: "Organizing..." },
  organizeSuccessToast: { fr: "Note organisée avec succès ! N'oublie pas de sauvegarder.", en: "Note organized successfully! Don't forget to save." },
  summarizeButton: { fr: "Résumé IA", en: "AI summary" },
  summaryTitle: { fr: "Résumé", en: "Summary" },
  summaryErrorToast: { fr: "Impossible de générer un résumé pour l'instant.", en: "Couldn't generate a summary right now." },
  backToListAriaLabel: { fr: "Retour à la liste", en: "Back to list" },
  fullscreenAriaLabel: { fr: "Mode focus", en: "Focus mode" },
  exitFullscreenAriaLabel: { fr: "Quitter le mode focus", en: "Exit focus mode" },
  deleteNoteAriaLabel: { fr: "Supprimer la note", en: "Delete note" },

  // Rename dialog
  cancel: { fr: "Annuler", en: "Cancel" },

  // Delete confirm dialog
  deleteDialogTitle: { fr: "Supprimer la note ?", en: "Delete this note?" },
  deleteDialogBodySuffix: { fr: "sera supprimée définitivement", en: "will be permanently deleted" },
  deleteDialogBodyUnsavedSuffix: {
    fr: ", y compris les modifications non enregistrées que tu es en train d'écrire",
    en: ", including the unsaved changes you're currently writing",
  },
  deleteDialogBodyEnd: { fr: ". Cette action est irréversible.", en: ". This action is irreversible." },

  // Editor toolbar (components/notes/EditorToolbar.tsx) — aria-labels/titles, execCommand-driven
  toolbarBold: { fr: "Gras", en: "Bold" },
  toolbarItalic: { fr: "Italique", en: "Italic" },
  toolbarUnderline: { fr: "Souligné", en: "Underline" },
  toolbarHeading2: { fr: "Titre", en: "Heading" },
  toolbarHeading3: { fr: "Sous-titre", en: "Subheading" },
  toolbarBulletList: { fr: "Liste à puces", en: "Bullet list" },
  toolbarNumberedList: { fr: "Liste numérotée", en: "Numbered list" },
  toolbarHighlight: { fr: "Surligner", en: "Highlight" },
} satisfies Record<string, Record<Language, string>>;

export function tNotes(key: keyof typeof NOTES_TRANSLATIONS, language: Language): string {
  return NOTES_TRANSLATIONS[key][language];
}
