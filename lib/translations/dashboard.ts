import type { Language } from "@/providers/LanguageProvider";

/**
 * Translations for the dashboard home page (app/dashboard/(shell)/page.tsx).
 * Mirrors the shape/style of lib/translations.ts's NAV_TRANSLATIONS/t() —
 * kept in its own file to avoid touching the nav-chrome dictionary.
 */
export const DASHBOARD_TRANSLATIONS = {
  // DashboardHero.tsx — {name} interpolated by the caller (String.replace),
  // same pattern as lib/translations/workspaceSynthesis.ts's own {n}/{cached}.
  heroGreeting: { fr: "Bonjour Dr. {name} 👋", en: "Hello Dr. {name} 👋" },
  heroWelcomeWithYear: {
    fr: "Bienvenue dans ton espace de {year} — choisis une unité, un module indépendant, ou ajoute un cours indépendant.",
    en: "Welcome to your {year} workspace — choose a teaching unit, an independent module, or add an independent course.",
  },
  heroWelcomeNoYear: {
    fr: "Choisis ta spécialité et ton année dans les Paramètres pour voir ton programme — en attendant, ajoute un cours indépendant.",
    en: "Choose your specialty and year in Settings to see your curriculum — in the meantime, add an independent course.",
  },
  // "Audio to Smart Notes" quick-action tile (app/dashboard/(shell)/page.tsx).
  audioNotesTitle: { fr: "Audio to Smart Notes", en: "Audio to Smart Notes" },
  audioNotesSubtitle: {
    fr: "Enregistre ou importe un cours audio — l'IA en sort des notes structurées.",
    en: "Record or import an audio lesson — AI extracts structured notes.",
  },
  addCourseHeading: { fr: "Ajouter un cours indépendant", en: "Add an independent course" },
  addCourseHelper: {
    fr: "Importe un PDF ou un document sans l'associer à un module.",
    en: "Import a PDF or document without linking it to a module.",
  },
  importButton: { fr: "Importer", en: "Import" },
  assistantLabel: { fr: "Assistant", en: "AI Assistant" },
  searchPlaceholder: { fr: "Rechercher...", en: "Search..." },
  myCurriculumHeading: { fr: "Mon Programme", en: "My Curriculum" },
  chooseSpecialtyHelper: {
    fr: "Choisis ta spécialité et ton année dans les Paramètres pour afficher tes unités d'enseignement.",
    en: "Choose your specialty and year in Settings to display your teaching units.",
  },
  goToSettings: { fr: "Aller aux Paramètres", en: "Go to Settings" },
  independentCoursesHeading: { fr: "Mes cours indépendants (Historique)", en: "My independent courses (History)" },
  noIndependentCourses: {
    fr: "Vous n'avez pas encore de cours indépendants.",
    en: "You don't have any independent courses yet.",
  },
  noIndependentCoursesHelper: {
    fr: "Cliquez sur « Ajouter un cours indépendant » ci-dessus pour importer votre premier cours.",
    en: 'Click on "Add an independent course" above to import your first course.',
  },
  curriculumLoadError: { fr: "Impossible de charger le programme.", en: "Unable to load the curriculum." },
  fallbackStudentName: { fr: "Étudiant(e)", en: "Student" },
} satisfies Record<string, Record<Language, string>>;

export function tDashboard(key: keyof typeof DASHBOARD_TRANSLATIONS, language: Language): string {
  return DASHBOARD_TRANSLATIONS[key][language];
}
