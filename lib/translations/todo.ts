import type { Language } from "@/providers/LanguageProvider";

/**
 * To-Do List & AI Study Planner translations — mirrors the shape/style of
 * lib/translations.ts's own NAV_TRANSLATIONS/t() exactly, scoped to the
 * to-do wizard's 4 steps (app/dashboard/(shell)/todo/page.tsx and its
 * components/todo/* views). Strings that embed dynamic values (counts,
 * dates, labels) keep only their static template pieces here — the
 * dynamic parts are interpolated in the component code, same as before.
 */
export const TODO_TRANSLATIONS = {
  // app/dashboard/(shell)/todo/page.tsx
  pageSubtitle: {
    fr: "Construis un planning de révision réaliste, généré et affiné par l'IA, puis exécute-le jour après jour.",
    en: "Build a realistic revision schedule, generated and refined by AI, then work through it day by day.",
  },
  stepModules: { fr: "Modules", en: "Modules" },
  stepConfig: { fr: "Configuration", en: "Configuration" },
  stepGenerate: { fr: "Génération IA", en: "AI Generation" },
  stepExecute: { fr: "Exécution", en: "Execution" },
  loading: { fr: "Chargement...", en: "Loading..." },
  resumedCoachMessage: {
    fr: "Te revoilà — voici où tu en étais.",
    en: "You're back — here's where you left off.",
  },
  stepWord: { fr: "Étape", en: "Step" },
  nextWord: { fr: "Ensuite :", en: "Next:" },

  // components/todo/ModuleChipSelector.tsx
  moduleSelectorTitle: { fr: "Quels modules veux-tu réviser ?", en: "Which modules do you want to review?" },
  moduleSelectorSubtitle: {
    fr: "Sélectionne un ou plusieurs modules — tu pourras ajouter des cours manuels à l'étape suivante.",
    en: "Select one or more modules — you'll be able to add manual courses in the next step.",
  },
  missingSpecialtyError: {
    fr: "Renseigne d'abord ta spécialité et ton année dans Paramètres pour voir tes modules.",
    en: "First fill in your specialty and year in Settings to see your modules.",
  },
  modulesLoadError: {
    fr: "Impossible de charger tes modules pour le moment.",
    en: "Unable to load your modules right now.",
  },
  independentModulesGroup: { fr: "Modules indépendants", en: "Independent modules" },
  modulesLoading: { fr: "Chargement de tes modules...", en: "Loading your modules..." },
  modulesEmpty: { fr: "Aucun module trouvé pour ton année académique.", en: "No modules found for your academic year." },
  selectAtLeastOne: { fr: "Sélectionne au moins un module pour continuer", en: "Select at least one module to continue" },
  next: { fr: "Suivant", en: "Next" },
  /** {n} placeholder — replaced by the caller. French pluralizes both "module" and "sélectionné"; English only pluralizes "module", so these are separate whole-template strings rather than word-by-word composition. */
  selectedCountSingular: { fr: "{n} module sélectionné", en: "{n} module selected" },
  selectedCountPlural: { fr: "{n} modules sélectionnés", en: "{n} modules selected" },

  // components/todo/PlanConfigForm.tsx
  configTitle: { fr: "Configure ton planning", en: "Configure your schedule" },
  configSubtitle: {
    fr: "Ces informations permettent à l'IA de construire un planning réaliste et tenable.",
    en: "This information lets the AI build a realistic, sustainable schedule.",
  },
  hoursPerDayLabel: { fr: "Heures d'étude par jour", en: "Study hours per day" },
  restDaysLabel: { fr: "Jours de repos par semaine", en: "Rest days per week" },
  restDaysNone: { fr: "0 (aucun)", en: "0 (none)" },
  dayWord: { fr: "jour", en: "day" },
  examDateLabel: { fr: "Date de l'examen", en: "Exam date" },
  previewIntro: { fr: "Il te reste", en: "You have" },
  previewBeforeExam: { fr: "avant l'examen — soit environ", en: "left before the exam — about" },
  previewOfRevision: { fr: "de révision", en: "of revision" },
  previewInTotal: { fr: "au total", en: "total" },
  previewOnceRestSubtracted: { fr: "une fois les repos déduits.", en: "once rest days are subtracted." },
  programOptionalLabel: { fr: "Programme officiel (Optionnel)", en: "Official curriculum (Optional)" },
  dropzoneText: {
    fr: "Glisse une image ou un PDF du programme, ou clique pour choisir",
    en: "Drag an image or PDF of the curriculum, or click to choose",
  },
  manualCoursesLabel: { fr: "Liste manuelle de cours (si pas de fichier)", en: "Manual course list (if no file)" },
  manualCoursesPlaceholder: {
    fr: "Un cours par ligne, ex :\nCardiologie — Insuffisance cardiaque\nPneumologie — Tuberculose",
    en: "One course per line, e.g.:\nCardiology — Heart failure\nPneumology — Tuberculosis",
  },
  back: { fr: "Retour", en: "Back" },
  generateWithAI: { fr: "Générer avec l'IA", en: "Generate with AI" },

  // components/todo/PlanGenerationView.tsx
  planTitle: { fr: "Ton planning de révision", en: "Your revision schedule" },
  planSubtitle: {
    fr: "Demande des ajustements dans le chat ci-dessous, puis sauvegarde ou lance l'exécution.",
    en: "Ask for adjustments in the chat below, then save or start execution.",
  },
  weekLabel: { fr: "Semaine", en: "Week" },
  coachAdjusting: { fr: "Coach MedArt ajuste ton planning...", en: "MedArt Coach is adjusting your schedule..." },
  chatInputPlaceholder: { fr: "Ex : Ajoute plus de temps pour la cardiologie", en: "E.g.: Add more time for cardiology" },
  saveLabel: { fr: "Sauvegarder", en: "Save" },
  startLabel: { fr: "START", en: "START" },
  ctaSaveExplain: { fr: "garde ce brouillon pour plus tard.", en: "keeps this draft for later." },
  ctaStartExplain: { fr: "lance le planning dès aujourd'hui.", en: "starts the schedule today." },
  backRestart: { fr: "Retour / Recommencer", en: "Back / Restart" },
  toastPlanLaunched: { fr: "Ton planning est lancé !", en: "Your schedule is live!" },
  toastPlanSaved: { fr: "Plan sauvegardé.", en: "Plan saved." },

  // components/todo/PlanExecutionView.tsx
  executionTitle: { fr: "Ton planning en cours", en: "Your ongoing schedule" },
  progress100: { fr: "100% — Bravo !", en: "100% — Well done!" },
  emptyStateText: {
    fr: "Aucune tâche pour l'instant. Ton planning apparaîtra ici dès qu'il sera prêt.",
    en: "No tasks yet. Your schedule will appear here as soon as it's ready.",
  },
  todayBadge: { fr: "Aujourd'hui", en: "Today" },
  overdueBadge: { fr: "À rattraper", en: "Catch up" },
  doneBadge: { fr: "Terminé", en: "Done" },

  // components/todo/PlanExecutionView.tsx + TaskRow.tsx + ProgressRing.tsx — "God-Tier" redesign (hero + accordions)
  overdueSection: { fr: "En retard", en: "Overdue" },
  overdueSectionSubtitle: {
    fr: "Une tâche quitte cette liste dès qu'elle est cochée — ce n'est pas un bug.",
    en: "A task leaves this list as soon as it's checked off — that's expected, not a bug.",
  },
  thisWeekSection: { fr: "Cette semaine", en: "This week" },
  upcomingSection: { fr: "À venir", en: "Upcoming" },
  doneSection: { fr: "Terminé (archive)", en: "Done (archive)" },
  restDayTitle: { fr: "Jour de repos", en: "Rest day" },
  restDayBody: {
    fr: "Aucune tâche prévue aujourd'hui. Profite de la pause — tu l'as méritée.",
    en: "No tasks scheduled today. Enjoy the break — you've earned it.",
  },
  qcmBadge: { fr: "QCM", en: "MCQ" },
  clinicalBadge: { fr: "Clinique", en: "Clinical" },
  revisionBadge: { fr: "Révision", en: "Review" },
  longSessionBadge: { fr: "Session longue", en: "Long session" },
  quickWinBadge: { fr: "Rapide", en: "Quick win" },
  dragHandleAriaLabel: { fr: "Réordonner", en: "Reorder" },
  deleteAriaLabel: { fr: "Supprimer", en: "Delete" },
  taskDeletedToast: { fr: "Tâche supprimée.", en: "Task deleted." },
  taskDeleteFailedToast: { fr: "La suppression a échoué.", en: "Deletion failed." },
  reorderFailedToast: { fr: "Le réordonnancement a échoué.", en: "Reordering failed." },
  undoAction: { fr: "Annuler", en: "Undo" },
  aiSuggestAriaLabel: { fr: "Suggestions IA", en: "AI suggestions" },
  aiSuggestErrorToast: { fr: "Impossible de générer des suggestions pour l'instant.", en: "Couldn't generate suggestions right now." },
  aiSuggestDismiss: { fr: "Fermer", en: "Close" },
  studyOathText: {
    fr: "« Ne te mens pas à toi-même en cochant une case sans avoir réellement maîtrisé le cours. N'oublie jamais : demain, la vie de tes patients sera entre tes mains. »",
    en: "\"Don't lie to yourself by checking a box without truly having mastered the material. Never forget: tomorrow, your patients' lives will be in your hands.\"",
  },
} satisfies Record<string, Record<Language, string>>;

export function tTodo(key: keyof typeof TODO_TRANSLATIONS, language: Language): string {
  return TODO_TRANSLATIONS[key][language];
}
