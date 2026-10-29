import {
  Activity,
  Bookmark,
  BookOpenText,
  Brain,
  CalendarCheck,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Download,
  Ellipsis,
  Expand,
  FileUp,
  FlaskConical,
  Gauge,
  GraduationCap,
  Headphones,
  History,
  Layers,
  Library,
  Lightbulb,
  ListChecks,
  ListTree,
  MessageSquareText,
  MousePointerClick,
  Network,
  NotebookPen,
  Paperclip,
  Receipt,
  Repeat,
  Rocket,
  Save,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Table2,
  Target,
  Timer,
  Type,
  Upload,
  Users,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Language } from "@/providers/LanguageProvider";
import type { TourId } from "@/lib/onboarding/tour-ids";

/**
 * Every guided tour's content, played by components/onboarding/OnboardingTour.tsx.
 * Targets are `data-tour="…"` attributes on the pages' own elements; when a
 * page's markup changes, keep its keys on the element they describe.
 */

export interface TourStep {
  id: string;
  /** `data-tour` values, in priority order: the first VISIBLE one is spotlighted (desktop sidebar vs mobile dock…). None visible, or none listed → centered card. */
  targets: string[];
  /** Left out when none of its targets is on screen as the tour opens (a feature the page isn't showing yet). */
  optional?: boolean;
  icon: LucideIcon;
  /** Badge chip gradient + glow color of this workspace. Glows are `rgba(…, 0.55)`: the tour derives its fainter rings from that alpha. */
  gradient: string;
  glow: string;
  badge: Record<Language, string>;
  title: Record<Language, string>;
  body: Record<Language, string>;
}

export interface TourDefinition {
  /** The tour dialog's accessible name. */
  label: Record<Language, string>;
  steps: TourStep[];
  /** Badge finale (medal + confetti) after the last step. Tool tours have none: they end on their last step. */
  finale?: { title: Record<Language, string>; body: Record<Language, string>; launch: Record<Language, string> };
}

const HUE = {
  emerald: { gradient: "from-emerald-400 to-teal-500", glow: "rgba(16,185,129,0.55)" },
  cyan: { gradient: "from-cyan-400 to-sky-500", glow: "rgba(34,211,238,0.55)" },
  violet: { gradient: "from-violet-400 to-fuchsia-500", glow: "rgba(167,139,250,0.55)" },
  amber: { gradient: "from-amber-400 to-orange-500", glow: "rgba(251,191,36,0.55)" },
  pink: { gradient: "from-fuchsia-400 to-pink-500", glow: "rgba(232,121,249,0.55)" },
  rose: { gradient: "from-rose-400 to-red-500", glow: "rgba(251,113,133,0.55)" },
  sky: { gradient: "from-sky-400 to-blue-500", glow: "rgba(56,189,248,0.55)" },
  lime: { gradient: "from-lime-400 to-emerald-500", glow: "rgba(163,230,53,0.55)" },
} as const;

const LAUNCH = { fr: "C'est parti !", en: "Let's go!" };

export const TOURS: Record<TourId, TourDefinition> = {
  // ─── Dashboard home: the first-run tour ────────────────────────────────────
  dashboard: {
    label: { fr: "Visite guidée de MedArt AI", en: "MedArt AI guided tour" },
    steps: [
      {
        id: "studio",
        targets: ["studio"],
        icon: GraduationCap,
        ...HUE.emerald,
        badge: { fr: "Studio", en: "Studio" },
        title: { fr: "Ton programme, ton Studio", en: "Your curriculum, your Studio" },
        body: {
          fr: "Choisis un module et importe ton polycopié (PDF, Word, photo). En quelques secondes il devient un cours structuré, prêt à réviser.",
          en: "Pick a module and import your handout (PDF, Word, photo). Within seconds it becomes a structured course, ready to study.",
        },
      },
      {
        id: "explication",
        targets: ["explication"],
        icon: BookOpenText,
        ...HUE.cyan,
        badge: { fr: "Explication", en: "Explanation" },
        title: { fr: "L'Explication Ultra-Détaillée", en: "The Ultra-Detailed Explanation" },
        body: {
          fr: "Chaque chapitre décortiqué : physiopathologie, clinique, pièges. Et tu reprends toujours là où tu t'es arrêté(e), en un clic.",
          en: "Every chapter broken down: pathophysiology, presentation, pitfalls. And you always pick up where you left off, in one tap.",
        },
      },
      {
        id: "lab",
        targets: ["lab"],
        icon: FlaskConical,
        ...HUE.violet,
        badge: { fr: "MedArt Lab", en: "MedArt Lab" },
        title: { fr: "Le Lab : pratique comme en stage", en: "The Lab: practice like on rounds" },
        body: {
          fr: "Patient virtuel pour t'entraîner au diagnostic, cartes mentales et matrices pharmaco / diagnostic différentiel — générés depuis TON cours.",
          en: "A virtual patient to train your diagnosis, mind maps and pharmacology / differential matrices — built from YOUR course.",
        },
      },
      {
        id: "exam",
        // Desktop sidebar entry; on phones and tablets, a module card's QCM tile.
        targets: ["exam", "exam-module"],
        icon: ClipboardCheck,
        ...HUE.amber,
        badge: { fr: "Examen", en: "Exam" },
        title: { fr: "Le simulateur d'examen", en: "The exam simulator" },
        body: {
          fr: "Des QCM style concours sur tout un module, chronométrés et corrigés. Chaque erreur devient une notion à revoir.",
          en: "Exam-style MCQs across a whole module, timed and corrected. Every mistake becomes a topic to review.",
        },
      },
      {
        id: "chat",
        targets: ["chat"],
        icon: Sparkles,
        ...HUE.pink,
        badge: { fr: "Copilot IA", en: "AI Copilot" },
        title: { fr: "Ton Copilot clinique, 24h/24", en: "Your clinical Copilot, 24/7" },
        body: {
          fr: "Une question en pleine garde ? Demande. Il répond à partir de tes cours, explique, compare et te fait réciter.",
          en: "A question mid-shift? Ask. It answers from your courses, explains, compares and quizzes you.",
        },
      },
    ],
    finale: {
      title: { fr: "Prêt pour le Majorat !", en: "Ready for the top rank!" },
      body: {
        fr: "Tu connais les 5 armes de MedArt AI. Importe ton premier cours et laisse le Studio faire le reste.",
        en: "You know MedArt AI's 5 weapons. Import your first course and let the Studio do the rest.",
      },
      launch: LAUNCH,
    },
  },

  // ─── Module workspace (/dashboard/module/[id]) ─────────────────────────────
  module: {
    label: { fr: "Guide de l'espace module", en: "Module workspace guide" },
    steps: [
      {
        id: "sources",
        targets: ["ws-add-source", "ws-tab-sources"],
        icon: Upload,
        ...HUE.emerald,
        badge: { fr: "Sources", en: "Sources" },
        title: { fr: "Tes sources, la base de tout", en: "Your sources come first" },
        body: {
          fr: "Importe ton polycopié (PDF, Word, PowerPoint), colle du texte ou un lien web. Chaque source devient un cours sur lequel le Studio et le Co-pilote travaillent.",
          en: "Import your handout (PDF, Word, PowerPoint), paste text or a web link. Each source becomes a course the Studio and the Co-pilot work on.",
        },
      },
      {
        id: "course",
        targets: ["ws-course"],
        optional: true,
        icon: MousePointerClick,
        ...HUE.cyan,
        badge: { fr: "Cours", en: "Course" },
        title: { fr: "Ouvre un cours", en: "Open a course" },
        body: {
          fr: "Touche un cours pour l'ouvrir : le Studio construit ses outils à partir de lui. Le menu ⋮ affiche le cours, ses statistiques, ou le supprime.",
          en: "Tap a course to open it: the Studio builds its tools from it. The ⋮ menu shows the course, its statistics, or deletes it.",
        },
      },
      {
        id: "chat",
        targets: ["ws-chat", "ws-tab-chat"],
        icon: MessageSquareText,
        ...HUE.pink,
        badge: { fr: "Co-pilote", en: "Co-pilot" },
        title: { fr: "Le Co-pilote lit tes sources", en: "The Co-pilot reads your sources" },
        body: {
          fr: "Pose ta question : il répond à partir de tes documents. Choisis son mode (Standard, Mode Examen, Explication détaillée, Synthèse express) et les sources qu'il doit lire.",
          en: "Ask your question: it answers from your documents. Pick its answer mode and the sources it should read.",
        },
      },
      {
        id: "studio",
        targets: ["ws-studio", "ws-tab-studio"],
        icon: Sparkles,
        ...HUE.violet,
        badge: { fr: "Studio", en: "Studio" },
        title: { fr: "Le Studio crée tes outils", en: "The Studio builds your tools" },
        body: {
          fr: "Un appui sur un outil (Explication, Résumé, QCM, Podcast…) le génère pour le cours ouvert ; un second appui l'ouvre dès que son point de couleur apparaît. La flèche ⌄ règle ses options avant.",
          en: "One tap on a tool (Explanation, Summary, MCQs, Podcast…) generates it for the open course; tap again to open it once its colored dot appears. The ⌄ arrow sets its options first.",
        },
      },
      {
        id: "lab",
        targets: ["ws-lab", "ws-tab-studio"],
        icon: FlaskConical,
        ...HUE.lime,
        badge: { fr: "MedArt Lab", en: "MedArt Lab" },
        title: { fr: "Le Lab : pratique comme en stage", en: "The Lab: practice like on rounds" },
        body: {
          fr: "Dans le Studio : patient virtuel, matrice pharmaco / diagnostic différentiel et carte mentale, construits à partir du cours ouvert.",
          en: "In the Studio: virtual patient, pharmacology / differential matrix and mind map, built from the open course.",
        },
      },
      {
        id: "note",
        targets: ["ws-note", "ws-quick-note"],
        optional: true,
        icon: NotebookPen,
        ...HUE.amber,
        badge: { fr: "Notes", en: "Notes" },
        title: { fr: "Note sans quitter ton cours", en: "Take notes without leaving" },
        body: {
          fr: "« Note rapide » (⇧N) ouvre une note à côté de ton cours ; elle est rangée dans « Mes notes ».",
          en: "The quick note (⇧N) opens a note next to your course; it is filed in My notes.",
        },
      },
      {
        id: "more",
        targets: ["ws-more"],
        icon: Ellipsis,
        ...HUE.sky,
        badge: { fr: "Plus", en: "More" },
        title: { fr: "Examen et synthèse du module", en: "Module exam and summary" },
        body: {
          fr: "Le menu ⋯ ouvre l'examen de module (Semaine Bloquée), la synthèse du module et tes notes. La palette (⌘K) retrouve n'importe quel outil ou source.",
          en: "The ⋯ menu opens the module exam, the module summary and your notes. The palette (⌘K) finds any tool or source.",
        },
      },
    ],
    finale: {
      title: { fr: "Espace module maîtrisé !", en: "Workspace mastered!" },
      body: { fr: "Importe ta première source, ouvre-la, puis lance un outil du Studio.", en: "Import your first source, open it, then launch a Studio tool." },
      launch: LAUNCH,
    },
  },

  // ─── Module exam (/dashboard/module/[id]/exam) ─────────────────────────────
  exam: {
    label: { fr: "Guide de l'examen de module", en: "Module exam guide" },
    steps: [
      {
        id: "courses",
        targets: ["exam-courses"],
        icon: ListChecks,
        ...HUE.cyan,
        badge: { fr: "Cours", en: "Courses" },
        title: { fr: "Choisis les cours de l'examen", en: "Pick the exam's courses" },
        body: {
          fr: "Coche les cours à inclure, ou « Sélectionner tout ». L'examen mêle leurs notions en 40 à 60 QCM.",
          en: "Tick the courses to include, or select them all. The exam mixes their topics into 40 to 60 MCQs.",
        },
      },
      {
        id: "style",
        targets: ["exam-style"],
        optional: true,
        icon: FileUp,
        ...HUE.violet,
        badge: { fr: "Style", en: "Style" },
        title: { fr: "Imite un vrai sujet", en: "Match a real paper" },
        body: {
          fr: "Facultatif : dépose un ancien examen (PDF ou photo) et l'IA reprend son style de questions.",
          en: "Optional: drop a past exam (PDF or photo) and the AI copies its question style.",
        },
      },
      {
        id: "timer",
        targets: ["exam-timer", "exam-settings"],
        icon: Timer,
        ...HUE.amber,
        badge: { fr: "Minuteur", en: "Timer" },
        title: { fr: "Ton minuteur", en: "Your timer" },
        body: {
          fr: "Dans les réglages : Chronomètre (temps écoulé) ou Conditions d'examen (compte à rebours de 90 s par question). Il ne démarre qu'au début de l'examen.",
          en: "In the settings: Stopwatch (time elapsed) or Exam conditions (a 90 s per question countdown). It only starts when the exam begins.",
        },
      },
      {
        id: "generate",
        targets: ["exam-generate"],
        icon: Rocket,
        ...HUE.emerald,
        badge: { fr: "Examen", en: "Exam" },
        title: { fr: "Lance l'examen", en: "Start the exam" },
        body: {
          fr: "« Générer l'examen » rédige tes QCM, puis l'examen commence. À la fin, « Afficher la correction » te donne ton score et les explications.",
          en: "“Generate the exam” writes your MCQs, then the exam begins. At the end, “Show the correction” gives your score and the explanations.",
        },
      },
    ],
    finale: {
      title: { fr: "Prêt à te tester !", en: "Ready to test yourself!" },
      body: { fr: "Coche tes cours, choisis ton minuteur et lance ton premier examen.", en: "Tick your courses, choose your timer and launch your first exam." },
      launch: LAUNCH,
    },
  },

  // The exam's correction, the first time it is shown.
  "exam-results": {
    label: { fr: "Guide de la correction", en: "Correction guide" },
    steps: [
      {
        id: "score",
        targets: ["exam-score"],
        icon: Gauge,
        ...HUE.emerald,
        badge: { fr: "Score", en: "Score" },
        title: { fr: "Ton score", en: "Your score" },
        body: {
          fr: "Ta note, ta précision, ta couverture, tes bonnes réponses et tes erreurs — puis l'analyse par notion.",
          en: "Your grade, accuracy, coverage, correct answers and mistakes — then the per-topic analysis.",
        },
      },
      {
        id: "filters",
        targets: ["exam-filters"],
        icon: Search,
        ...HUE.cyan,
        badge: { fr: "Correction", en: "Correction" },
        title: { fr: "Filtre ta correction", en: "Filter the correction" },
        body: {
          fr: "Toutes, Correctes, Erreurs ou Sans réponse : affiche les questions qui t'intéressent, et cherche une notion.",
          en: "All, Correct, Mistakes or Unanswered: show the questions you want, and search for a topic.",
        },
      },
      {
        id: "explanation",
        targets: ["exam-explanation"],
        optional: true,
        icon: Lightbulb,
        ...HUE.amber,
        badge: { fr: "Explication", en: "Explanation" },
        title: { fr: "Comprends chaque réponse", en: "Understand every answer" },
        body: { fr: "Chaque question a son explication détaillée.", en: "Every question has its detailed explanation." },
      },
      {
        id: "weak",
        targets: ["exam-weak"],
        optional: true,
        icon: Target,
        ...HUE.rose,
        badge: { fr: "À revoir", en: "To review" },
        title: { fr: "Tes points faibles", en: "Your weak spots" },
        body: { fr: "Les notions où tu t'es trompé(e) : commence tes révisions par elles.", en: "The topics you got wrong: start your revision with them." },
      },
      {
        id: "actions",
        targets: ["exam-actions"],
        icon: Repeat,
        ...HUE.violet,
        badge: { fr: "Suite", en: "Next" },
        title: { fr: "Et maintenant ?", en: "What next?" },
        body: { fr: "Génère un nouvel examen, ou régénère celui-ci pour t'entraîner encore.", en: "Generate a new exam, or regenerate this one to practise again." },
      },
    ],
  },

  // ─── Module summary (/dashboard/workspace/module/[moduleId]) ──────────────
  synthesis: {
    label: { fr: "Guide de la synthèse du module", en: "Module summary guide" },
    steps: [
      {
        id: "sources",
        targets: ["syn-sources"],
        icon: Library,
        ...HUE.cyan,
        badge: { fr: "Sources", en: "Sources" },
        title: { fr: "Au moins 5 cours", en: "At least 5 courses" },
        body: {
          fr: "La synthèse croise tout le module : sélectionne au moins 5 cours déjà générés (« Sélectionner tout » pour aller vite).",
          en: "The summary spans the whole module: select at least 5 generated courses (select them all to go fast).",
        },
      },
      {
        id: "options",
        targets: ["syn-options"],
        optional: true,
        icon: SlidersHorizontal,
        ...HUE.violet,
        badge: { fr: "Options", en: "Options" },
        title: { fr: "Personnalise le Résumé Global", en: "Tune the Global Summary" },
        body: { fr: "Ouvre ce bloc pour régler le Résumé Global avant de le lancer.", en: "Open this block to tune the Global Summary before launching it." },
      },
      {
        id: "generate",
        targets: ["syn-generate"],
        icon: Sparkles,
        ...HUE.emerald,
        badge: { fr: "Synthèses", en: "Summaries" },
        title: { fr: "Trois synthèses", en: "Three summaries" },
        body: {
          fr: "Résumé Global, Tableau des Mots-Clés et Dictionnaire Médical. Les boutons s'activent dès que 5 cours sont sélectionnés.",
          en: "Global Summary, Keyword Table and Medical Dictionary. The buttons unlock once 5 courses are selected.",
        },
      },
      {
        id: "results",
        targets: ["syn-results"],
        optional: true,
        icon: History,
        ...HUE.amber,
        badge: { fr: "Résultats", en: "Results" },
        title: { fr: "Tout reste ici", en: "Everything stays here" },
        body: {
          fr: "Chaque synthèse générée est gardée dans « Résultats » : copie-la, télécharge-la ou ouvre-la en plein écran.",
          en: "Every generated summary is kept under Results: copy it, download it or open it full screen.",
        },
      },
    ],
    finale: {
      title: { fr: "Synthèse prête à lancer !", en: "Ready to summarise!" },
      body: { fr: "Sélectionne 5 cours et lance ta première synthèse du module.", en: "Select 5 courses and launch your first module summary." },
      launch: LAUNCH,
    },
  },

  // ─── Copilot (/dashboard/assistant) ────────────────────────────────────────
  assistant: {
    label: { fr: "Guide du Copilot", en: "Copilot guide" },
    steps: [
      {
        id: "suggestions",
        targets: ["asst-suggestions"],
        optional: true,
        icon: Lightbulb,
        ...HUE.amber,
        badge: { fr: "Idées", en: "Ideas" },
        title: { fr: "Démarre en un appui", en: "Start in one tap" },
        body: { fr: "Choisis une suggestion pour lancer la conversation, ou écris ta propre question.", en: "Pick a suggestion to start the conversation, or write your own question." },
      },
      {
        id: "composer",
        targets: ["asst-composer"],
        icon: MessageSquareText,
        ...HUE.pink,
        badge: { fr: "Copilot", en: "Copilot" },
        title: { fr: "Demande, il explique", en: "Ask, it explains" },
        body: {
          fr: "Pose ta question comme à un interne de garde : il explique, compare et te fait réciter.",
          en: "Ask the way you'd ask a resident on call: it explains, compares and quizzes you.",
        },
      },
      {
        id: "quick",
        targets: ["asst-quick"],
        icon: Zap,
        ...HUE.violet,
        badge: { fr: "Actions rapides", en: "Quick actions" },
        title: { fr: "Une demande en un appui", en: "A request in one tap" },
        body: {
          fr: "Cas clinique, QCM, diagnostic différentiel, résumé, simplification, flashcards : un appui prépare la demande. « Réglages » change le style des réponses.",
          en: "Clinical case, MCQs, differential diagnosis, summary, simplify, flashcards: one tap drafts the request. Settings changes the answer style.",
        },
      },
      {
        id: "attach",
        targets: ["asst-attach"],
        icon: Paperclip,
        ...HUE.cyan,
        badge: { fr: "Pièces jointes", en: "Attachments" },
        title: { fr: "Joins, dicte ou parle", en: "Attach, dictate or talk" },
        body: {
          fr: "Le trombone ajoute une photo ou un document ; le micro dicte ta question et le mode vocal te laisse discuter à voix haute.",
          en: "The paperclip adds a photo or a document; the mic dictates your question and voice mode lets you talk out loud.",
        },
      },
      {
        id: "history",
        targets: ["asst-history-phone", "asst-history"],
        icon: History,
        ...HUE.emerald,
        badge: { fr: "Historique", en: "History" },
        title: { fr: "Tes conversations", en: "Your conversations" },
        body: { fr: "Retrouve tes anciennes conversations, et commences-en une nouvelle à tout moment.", en: "Find your past conversations, and start a new one anytime." },
      },
    ],
    finale: {
      title: { fr: "Ton Copilot est prêt !", en: "Your Copilot is ready!" },
      body: { fr: "Pose ta première question, ou lance une action rapide.", en: "Ask your first question, or launch a quick action." },
      launch: LAUNCH,
    },
  },

  // ─── Notes (/dashboard/notes) ──────────────────────────────────────────────
  notes: {
    label: { fr: "Guide de mes notes", en: "My notes guide" },
    steps: [
      {
        id: "new",
        targets: ["notes-new"],
        icon: NotebookPen,
        ...HUE.cyan,
        badge: { fr: "Carnet de bord", en: "Logbook" },
        title: { fr: "Tes notes personnelles", en: "Your personal notes" },
        body: {
          fr: "Tes notes, indépendantes de tes cours. « Nouvelle note » en crée une en un appui.",
          en: "Your notes, separate from your courses. New note creates one in a tap.",
        },
      },
      {
        id: "search",
        targets: ["notes-search"],
        icon: Search,
        ...HUE.violet,
        badge: { fr: "Recherche", en: "Search" },
        title: { fr: "Retrouve n'importe quelle note", en: "Find any note" },
        body: { fr: "Cherche un mot, filtre (Toutes, 7 j, Modules) et trie ta liste.", en: "Search for a word, filter (All, 7 days, Modules) and sort your list." },
      },
      {
        id: "list",
        targets: ["notes-list"],
        icon: ListTree,
        ...HUE.emerald,
        badge: { fr: "Notes", en: "Notes" },
        title: { fr: "Ta liste", en: "Your list" },
        body: {
          fr: "Touche une note pour l'ouvrir. Les notes prises dans un module arrivent ici aussi. Pense à « Sauvegarder » (Ctrl+S) : rien ne s'enregistre tout seul.",
          en: "Tap a note to open it. Notes taken in a module land here too. Remember to save (Ctrl+S): nothing saves by itself.",
        },
      },
      {
        id: "ai",
        targets: ["notes-ai"],
        optional: true,
        icon: Sparkles,
        ...HUE.pink,
        badge: { fr: "IA", en: "AI" },
        title: { fr: "L'IA range tes notes", en: "AI tidies your notes" },
        body: {
          fr: "« Organiser avec l'IA » structure une note brouillon ; « Résumé IA » la condense.",
          en: "Organize with AI structures a rough note; AI summary condenses it.",
        },
      },
      {
        id: "save",
        targets: ["notes-save"],
        optional: true,
        icon: Save,
        ...HUE.amber,
        badge: { fr: "Sauvegarde", en: "Save" },
        title: { fr: "Sauvegarde", en: "Save" },
        body: { fr: "« Sauvegarder » ou Ctrl+S : la pastille te dit si tout est enregistré.", en: "Save or Ctrl+S: the status pill tells you whether everything is saved." },
      },
    ],
    finale: {
      title: { fr: "Carnet prêt !", en: "Notebook ready!" },
      body: { fr: "Crée ta première note.", en: "Create your first note." },
      launch: LAUNCH,
    },
  },

  // ─── Study space (/dashboard/study) ────────────────────────────────────────
  study: {
    label: { fr: "Guide de l'espace de révision", en: "Study space guide" },
    steps: [
      {
        id: "tabs",
        targets: ["study-tabs"],
        icon: Layers,
        ...HUE.cyan,
        badge: { fr: "Révision", en: "Study" },
        title: { fr: "Deux espaces", en: "Two spaces" },
        body: { fr: "Flashcards pour mémoriser, Pomodoro pour te concentrer : passe de l'un à l'autre ici.", en: "Flashcards to memorise, Pomodoro to focus: switch between them here." },
      },
      {
        id: "pomodoro",
        targets: ["study-pomodoro"],
        icon: Timer,
        ...HUE.amber,
        badge: { fr: "Pomodoro", en: "Pomodoro" },
        title: { fr: "Ton chrono de concentration", en: "Your focus timer" },
        body: {
          fr: "Lance un Pomodoro sans quitter tes cartes : il continue même si tu changes de page.",
          en: "Start a Pomodoro without leaving your cards: it keeps running when you change page.",
        },
      },
      {
        id: "courses",
        targets: ["study-courses"],
        optional: true,
        icon: Library,
        ...HUE.emerald,
        badge: { fr: "Cours", en: "Courses" },
        title: { fr: "Choisis tes cours", en: "Choose your courses" },
        body: { fr: "Sélectionne les cours à réviser : tes flashcards viennent d'eux.", en: "Select the courses to study: your flashcards come from them." },
      },
      {
        id: "card",
        targets: ["study-card"],
        optional: true,
        icon: Brain,
        ...HUE.violet,
        badge: { fr: "Carte", en: "Card" },
        title: { fr: "Réfléchis, puis retourne", en: "Think, then flip" },
        body: {
          fr: "Lis la question, cherche la réponse, puis touche la carte (ou Espace) pour la retourner.",
          en: "Read the question, recall the answer, then tap the card (or Space) to flip it.",
        },
      },
      {
        id: "rate",
        targets: ["study-rate"],
        optional: true,
        icon: Gauge,
        ...HUE.pink,
        badge: { fr: "Note", en: "Rating" },
        title: { fr: "Note ta réponse", en: "Rate your answer" },
        body: {
          fr: "Difficile, Moyen ou Facile (touches 1, 2, 3) : sois honnête, chaque note compte dans ta rétention.",
          en: "Hard, Medium or Easy (keys 1, 2, 3): be honest, every rating counts towards your retention.",
        },
      },
      {
        id: "stats",
        targets: ["study-stats"],
        optional: true,
        icon: Activity,
        ...HUE.lime,
        badge: { fr: "Progrès", en: "Progress" },
        title: { fr: "Ta mémorisation en direct", en: "Live memorisation" },
        body: { fr: "Suis ta session en temps réel.", en: "Follow your session in real time." },
      },
    ],
    finale: {
      title: { fr: "Prêt à mémoriser !", en: "Ready to memorise!" },
      body: { fr: "Choisis tes cours et révise ta première carte.", en: "Choose your courses and study your first card." },
      launch: LAUNCH,
    },
  },

  // The study space's Pomodoro tab, the first time it is opened.
  pomodoro: {
    label: { fr: "Guide du Pomodoro", en: "Pomodoro guide" },
    steps: [
      {
        id: "dial",
        targets: ["pomo-dial"],
        icon: Timer,
        ...HUE.amber,
        badge: { fr: "Pomodoro", en: "Pomodoro" },
        title: { fr: "Ton Pomodoro", en: "Your Pomodoro" },
        body: {
          fr: "Lance une session de concentration d'un appui ; le chrono continue même si tu changes de page.",
          en: "Start a focus session in one tap; the timer keeps going when you change page.",
        },
      },
      {
        id: "programs",
        targets: ["pomo-programs"],
        icon: SlidersHorizontal,
        ...HUE.cyan,
        badge: { fr: "Rythme", en: "Rhythm" },
        title: { fr: "Règle ton rythme", en: "Set your rhythm" },
        body: { fr: "Choisis un programme, ou ajuste l'étude, la pause et le nombre de cycles.", en: "Pick a programme, or adjust study time, break and number of cycles." },
      },
      {
        id: "side",
        targets: ["pomo-side"],
        optional: true,
        icon: Wind,
        ...HUE.emerald,
        badge: { fr: "Focus", en: "Focus" },
        title: { fr: "Reste concentré(e)", en: "Stay focused" },
        body: { fr: "Suivi de ta concentration, respiration guidée et ambiance sonore.", en: "Focus tracking, guided breathing and ambient sound." },
      },
    ],
  },

  // ─── AI planner (/dashboard/todo) ──────────────────────────────────────────
  todo: {
    label: { fr: "Guide du planificateur", en: "Planner guide" },
    steps: [
      {
        id: "steps",
        targets: ["todo-steps"],
        icon: ClipboardList,
        ...HUE.cyan,
        badge: { fr: "Planificateur IA", en: "AI planner" },
        title: { fr: "Ton planning en 4 étapes", en: "Your plan in 4 steps" },
        body: { fr: "Modules, configuration, génération par l'IA, puis exécution jour après jour.", en: "Modules, setup, AI generation, then day-by-day execution." },
      },
      {
        id: "wizard",
        targets: ["todo-wizard"],
        icon: CalendarCheck,
        ...HUE.violet,
        badge: { fr: "Étapes", en: "Steps" },
        title: { fr: "Avance pas à pas", en: "Go step by step" },
        body: {
          fr: "Chaque étape s'affiche ici : choisis tes modules, donne ta date d'examen, tes heures par jour et tes jours de repos, puis affine le planning de l'IA avant de le lancer.",
          en: "Each step shows here: choose your modules, give your exam date, hours per day and rest days, then refine the AI's plan before starting it.",
        },
      },
      {
        id: "modules",
        targets: ["todo-modules"],
        optional: true,
        icon: ListChecks,
        ...HUE.emerald,
        badge: { fr: "Modules", en: "Modules" },
        title: { fr: "Choisis tes modules", en: "Pick your modules" },
        body: { fr: "Sélectionne les modules à mettre dans ton planning, puis « Suivant ».", en: "Select the modules for your plan, then Next." },
      },
      {
        id: "today",
        targets: ["todo-today"],
        optional: true,
        icon: CalendarCheck,
        ...HUE.amber,
        badge: { fr: "Aujourd'hui", en: "Today" },
        title: { fr: "Ta journée", en: "Your day" },
        body: { fr: "Chaque jour, retrouve ici les tâches prévues et coche-les au fil de tes révisions.", en: "Every day, find the planned tasks here and tick them off as you study." },
      },
    ],
    finale: {
      title: { fr: "Planning en route !", en: "Plan on track!" },
      body: { fr: "Choisis tes modules : l'IA construit le reste.", en: "Choose your modules: the AI builds the rest." },
      launch: LAUNCH,
    },
  },

  // ─── Settings (/dashboard/settings) ────────────────────────────────────────
  settings: {
    label: { fr: "Guide des paramètres", en: "Settings guide" },
    steps: [
      {
        id: "tabs",
        targets: ["settings-tabs"],
        icon: Settings2,
        ...HUE.cyan,
        badge: { fr: "Paramètres", en: "Settings" },
        title: { fr: "Tout se règle ici", en: "Everything is set here" },
        body: { fr: "Profil & Cursus, Moteur IA, Rappels, Apparence et Appareils.", en: "Profile & curriculum, AI engine, reminders, appearance and devices." },
      },
      {
        id: "profile",
        targets: ["settings-profile"],
        optional: true,
        icon: GraduationCap,
        ...HUE.emerald,
        badge: { fr: "Cursus", en: "Curriculum" },
        title: { fr: "Ton cursus", en: "Your curriculum" },
        body: {
          fr: "Ta faculté, ta spécialité et ton année adaptent tes modules. Vérifie-les bien : certains champs se verrouillent une fois enregistrés.",
          en: "Your faculty, specialty and year shape your modules. Check them carefully: some fields lock once saved.",
        },
      },
      {
        id: "guides",
        targets: [],
        icon: CircleHelp,
        ...HUE.violet,
        badge: { fr: "Guides", en: "Guides" },
        title: { fr: "Un guide sur chaque page", en: "A guide on every page" },
        body: { fr: "Le bouton ? à côté du titre d'une page relance son guide quand tu veux.", en: "The ? button next to a page's title replays its guide whenever you want." },
      },
    ],
    finale: {
      title: { fr: "Tout est en place !", en: "All set!" },
      body: { fr: "Vérifie ton cursus, puis retourne réviser.", en: "Check your curriculum, then get back to studying." },
      launch: LAUNCH,
    },
  },

  // ─── Subscription (/dashboard/billing) ─────────────────────────────────────
  billing: {
    label: { fr: "Guide de l'abonnement", en: "Subscription guide" },
    steps: [
      {
        id: "current",
        targets: ["billing-current"],
        icon: CreditCard,
        ...HUE.emerald,
        badge: { fr: "Abonnement", en: "Subscription" },
        title: { fr: "Ton abonnement", en: "Your subscription" },
        body: { fr: "Ta formule actuelle et ce qu'elle débloque.", en: "Your current plan and what it unlocks." },
      },
      {
        id: "plans",
        targets: ["billing-plans"],
        optional: true,
        icon: Layers,
        ...HUE.violet,
        badge: { fr: "Formules", en: "Plans" },
        title: { fr: "Choisis ta formule", en: "Choose your plan" },
        body: {
          fr: "Individuel, Groupe de 5 ou Groupe de 10, pour 1 mois, 4 mois ou l'année (8 mois).",
          en: "Individual, Group of 5 or Group of 10, for 1 month, 4 months or the year (8 months).",
        },
      },
      {
        id: "payment",
        targets: ["billing-payment"],
        icon: ShieldCheck,
        ...HUE.cyan,
        badge: { fr: "Paiement", en: "Payment" },
        title: { fr: "Paiement sécurisé", en: "Secure payment" },
        body: { fr: "En DZD, par Edahabia (Algérie Poste) ou carte CIB, via Chargily Pay.", en: "In DZD, by Edahabia (Algérie Poste) or CIB card, through Chargily Pay." },
      },
      {
        id: "usage",
        targets: ["billing-usage"],
        icon: Gauge,
        ...HUE.amber,
        badge: { fr: "Consommation", en: "Usage" },
        title: { fr: "Ta consommation", en: "Your usage" },
        body: { fr: "Ce que tu as utilisé de ta formule, et ce qu'il te reste.", en: "What you've used of your plan, and what's left." },
      },
      {
        id: "invoices",
        targets: ["billing-invoices"],
        optional: true,
        icon: Receipt,
        ...HUE.sky,
        badge: { fr: "Factures", en: "Invoices" },
        title: { fr: "Tes factures", en: "Your invoices" },
        body: { fr: "L'historique de tes paiements.", en: "Your payment history." },
      },
    ],
    finale: {
      title: { fr: "Tout est clair !", en: "All clear!" },
      body: { fr: "Choisis la formule qui te va, seul(e) ou en groupe.", en: "Pick the plan that suits you, alone or as a group." },
      launch: LAUNCH,
    },
  },

  // ─── Group page (/dashboard/billing/pool/[code], also the invite links' landing) ──
  pool: {
    label: { fr: "Guide de ton groupe", en: "Your group guide" },
    steps: [
      {
        id: "steps",
        targets: ["pool-steps"],
        optional: true,
        icon: Users,
        ...HUE.violet,
        badge: { fr: "Groupe", en: "Group" },
        title: { fr: "Comment ça marche", en: "How it works" },
        body: {
          fr: "Chaque membre paie sa place ; dès que le groupe est complet, MedArt AI se débloque pour tout le monde.",
          en: "Each member pays for their seat; as soon as the group is full, MedArt AI unlocks for everyone.",
        },
      },
      {
        id: "gauge",
        targets: ["pool-gauge"],
        icon: Gauge,
        ...HUE.emerald,
        badge: { fr: "Places", en: "Seats" },
        title: { fr: "Le compteur du groupe", en: "The group counter" },
        body: { fr: "Le nombre de places déjà payées.", en: "How many seats are already paid." },
      },
      {
        id: "pay",
        targets: ["pool-pay"],
        icon: CreditCard,
        ...HUE.cyan,
        badge: { fr: "Ta place", en: "Your seat" },
        title: { fr: "Ta place", en: "Your seat" },
        body: { fr: "Ta place se règle ici, en DZD (Edahabia ou CIB).", en: "Your seat is paid here, in DZD (Edahabia or CIB)." },
      },
      {
        id: "invite",
        targets: ["pool-invite"],
        optional: true,
        icon: Share2,
        ...HUE.amber,
        badge: { fr: "Inviter", en: "Invite" },
        title: { fr: "Invite ta promo", en: "Invite your classmates" },
        body: {
          fr: "Partage le lien ou le code du groupe : chaque ami rejoint et paie sa place.",
          en: "Share the group's link or code: each friend joins and pays for their seat.",
        },
      },
    ],
    finale: {
      title: { fr: "Ton groupe est lancé !", en: "Your group is under way!" },
      body: { fr: "Réserve ta place et invite tes amis pour compléter le groupe.", en: "Book your seat and invite your friends to fill the group." },
      launch: LAUNCH,
    },
  },

  // ─── Studio tools, on first opening ────────────────────────────────────────
  "tool-explication": {
    label: { fr: "Guide de l'Explication", en: "Explanation guide" },
    steps: [
      {
        id: "toolbar",
        targets: ["exp-toolbar"],
        icon: Type,
        ...HUE.cyan,
        badge: { fr: "Lecture", en: "Reading" },
        title: { fr: "Lis à ton confort", en: "Read your way" },
        body: {
          fr: "Police, taille du texte, sommaire et Mode Zen pour lire sans distraction.",
          en: "Font, text size, table of contents and Zen mode to read without distraction.",
        },
      },
      {
        id: "progress",
        targets: ["exp-progress"],
        optional: true,
        icon: Bookmark,
        ...HUE.emerald,
        badge: { fr: "Progression", en: "Progress" },
        title: { fr: "Où tu en es", en: "Where you are" },
        body: { fr: "La barre suit ta lecture, et le sommaire te mène droit à une partie.", en: "The bar follows your reading, and the table of contents takes you straight to a part." },
      },
      {
        id: "connections",
        targets: ["exp-connections"],
        optional: true,
        icon: Network,
        ...HUE.violet,
        badge: { fr: "Connexions", en: "Connections" },
        title: { fr: "Connexions cliniques", en: "Clinical connections" },
        body: { fr: "En fin de lecture, relie ce cours aux autres cours de ton module.", en: "At the end, link this course to the other courses in your module." },
      },
    ],
  },

  "tool-resume": {
    label: { fr: "Guide du Résumé", en: "Summary guide" },
    steps: [
      {
        id: "modes",
        targets: ["res-modes"],
        icon: Layers,
        ...HUE.cyan,
        badge: { fr: "Résumé", en: "Summary" },
        title: { fr: "Six formats", en: "Six formats" },
        body: {
          fr: "Smart Summary, Exam Summary, Cheat Sheet, Guideline Summary, Professor Notes et Astuces : change de format d'un appui.",
          en: "Smart Summary, Exam Summary, Cheat Sheet, Guideline Summary, Professor Notes and Tips: switch format in one tap.",
        },
      },
      {
        id: "score",
        targets: ["res-score"],
        optional: true,
        icon: Target,
        ...HUE.amber,
        badge: { fr: "Examen", en: "Exam" },
        title: { fr: "Tombabilité à l'examen", en: "Exam likelihood" },
        body: { fr: "L'estimation des chances que ce cours tombe à l'examen.", en: "How likely this course is to come up in the exam." },
      },
    ],
  },

  "tool-cas": {
    label: { fr: "Guide du cas clinique", en: "Clinical case guide" },
    steps: [
      {
        id: "cases",
        targets: ["cas-cases"],
        optional: true,
        icon: Stethoscope,
        ...HUE.cyan,
        badge: { fr: "Cas", en: "Cases" },
        title: { fr: "Plusieurs cas", en: "Several cases" },
        body: { fr: "Passe d'un cas clinique à l'autre ici.", en: "Switch between clinical cases here." },
      },
      {
        id: "acts",
        targets: ["cas-acts"],
        optional: true,
        icon: ListTree,
        ...HUE.emerald,
        badge: { fr: "Actes", en: "Acts" },
        title: { fr: "Le cas, acte par acte", en: "The case, act by act" },
        body: { fr: "Ouvre les actes un par un, et réfléchis à la suite avant de la découvrir.", en: "Open the acts one by one, and think ahead before revealing the next." },
      },
    ],
  },

  "tool-qcm": {
    label: { fr: "Guide des QCM", en: "MCQ guide" },
    steps: [
      {
        id: "mode",
        targets: ["qcm-mode"],
        icon: Gauge,
        ...HUE.cyan,
        badge: { fr: "Mode Concours", en: "Exam mode" },
        title: { fr: "Choisis ton rythme", en: "Pick your pace" },
        body: {
          fr: "Libre pour t'entraîner sans chrono ; Concours ou Sprint lancent un compte à rebours au rythme du concours.",
          en: "Free to practise without a clock; Concours or Sprint start a countdown at exam pace.",
        },
      },
      {
        id: "confidence",
        targets: ["qcm-confidence"],
        optional: true,
        icon: Target,
        ...HUE.amber,
        badge: { fr: "Certitude", en: "Confidence" },
        title: { fr: "Avant de répondre", en: "Before you answer" },
        body: {
          fr: "Dis si tu es sûr(e), hésitant(e) ou si tu réponds au hasard : à la fin, un bilan montre les erreurs commises avec assurance, les vrais pièges de l'examen.",
          en: "Say whether you're sure, unsure or guessing: at the end, a report shows the mistakes made with confidence — the real exam traps.",
        },
      },
      {
        id: "card",
        targets: ["qcm-card"],
        optional: true,
        icon: ListChecks,
        ...HUE.emerald,
        badge: { fr: "QCM", en: "MCQ" },
        title: { fr: "Réponds, puis valide", en: "Answer, then confirm" },
        body: {
          fr: "Coche ta ou tes réponses ; pour les questions à plusieurs réponses, appuie sur « Valider mes réponses ».",
          en: "Tick your answer(s); for multi-answer questions, press the button that validates your answers.",
        },
      },
    ],
  },

  "tool-analogies": {
    label: { fr: "Guide des exemples et analogies", en: "Examples & analogies guide" },
    steps: [
      {
        id: "views",
        targets: ["ana-views"],
        optional: true,
        icon: Layers,
        ...HUE.violet,
        badge: { fr: "Analogies", en: "Analogies" },
        title: { fr: "Trois vues", en: "Three views" },
        body: { fr: "Cartes, Focus (une analogie à la fois) ou Tableau.", en: "Cards, Focus (one analogy at a time) or Table." },
      },
      {
        id: "actions",
        targets: ["ana-actions"],
        optional: true,
        icon: Bookmark,
        ...HUE.emerald,
        badge: { fr: "Retenir", en: "Remember" },
        title: { fr: "Garde les meilleures", en: "Keep the best ones" },
        body: {
          fr: "Copie une analogie, transforme-la en flashcard ou marque-la comme comprise.",
          en: "Copy an analogy, turn it into a flashcard or mark it as understood.",
        },
      },
    ],
  },

  "tool-podcast": {
    label: { fr: "Guide du podcast", en: "Podcast guide" },
    steps: [
      {
        id: "player",
        targets: ["pod-player"],
        icon: Headphones,
        ...HUE.pink,
        badge: { fr: "Podcast", en: "Podcast" },
        title: { fr: "Ton cours en podcast", en: "Your course as a podcast" },
        body: { fr: "Écoute ton cours ; avance, recule et règle la vitesse de lecture.", en: "Listen to your course; skip, rewind and set the playback speed." },
      },
      {
        id: "moments",
        targets: ["pod-moments"],
        optional: true,
        icon: Bookmark,
        ...HUE.amber,
        badge: { fr: "Moments clés", en: "Key moments" },
        title: { fr: "Marque les moments clés", en: "Mark key moments" },
        body: { fr: "Ajoute un repère à l'instant précis pour y revenir plus tard.", en: "Add a marker at the exact moment to come back to it later." },
      },
      {
        id: "download",
        targets: ["pod-download"],
        optional: true,
        icon: Download,
        ...HUE.cyan,
        badge: { fr: "Hors ligne", en: "Offline" },
        title: { fr: "Écoute partout", en: "Listen anywhere" },
        body: { fr: "Télécharge le podcast pour l'écouter hors connexion.", en: "Download the podcast to listen offline." },
      },
    ],
  },

  // ─── Lab tools, on first opening ───────────────────────────────────────────
  "tool-case": {
    label: { fr: "Guide du patient virtuel", en: "Virtual patient guide" },
    steps: [
      {
        id: "level",
        targets: ["case-level"],
        icon: Gauge,
        ...HUE.lime,
        badge: { fr: "Patient virtuel", en: "Virtual patient" },
        title: { fr: "Choisis le niveau", en: "Choose the level" },
        body: { fr: "Externe, Interne ou Concours : la difficulté du cas s'adapte.", en: "Extern, Resident or Concours: the case's difficulty adapts." },
      },
      {
        id: "start",
        targets: ["case-start"],
        icon: Stethoscope,
        ...HUE.emerald,
        badge: { fr: "Consultation", en: "Consultation" },
        title: { fr: "Mène la consultation", en: "Run the consultation" },
        body: {
          fr: "Lance le cas, demande les examens utiles, puis propose ton diagnostic : tu reçois un score sur 100 et la correction.",
          en: "Start the case, order the useful tests, then give your diagnosis: you get a score out of 100 and the correction.",
        },
      },
    ],
  },

  "tool-matrix": {
    label: { fr: "Guide de la matrice", en: "Matrix guide" },
    steps: [
      {
        id: "kind",
        targets: ["matrix-kind"],
        icon: Table2,
        ...HUE.emerald,
        badge: { fr: "Matrice", en: "Matrix" },
        title: { fr: "Deux matrices", en: "Two matrices" },
        body: { fr: "Pharmacologie ou Diagnostic différentiel, construites à partir de ton cours.", en: "Pharmacology or Differential diagnosis, built from your course." },
      },
      {
        id: "explore",
        targets: ["matrix-generate", "matrix-toolbar"],
        optional: true,
        icon: Search,
        ...HUE.cyan,
        badge: { fr: "Explorer", en: "Explore" },
        title: { fr: "Génère et explore", en: "Generate and explore" },
        body: {
          fr: "Génère la matrice, puis cherche, choisis tes colonnes et exporte-la (Markdown ou CSV).",
          en: "Generate the matrix, then search, choose your columns and export it (Markdown or CSV).",
        },
      },
    ],
  },

  "tool-mindmap": {
    label: { fr: "Guide de la carte mentale", en: "Mind map guide" },
    steps: [
      {
        id: "map",
        targets: ["mindmap-generate", "mindmap-canvas"],
        icon: Network,
        ...HUE.violet,
        badge: { fr: "Carte mentale", en: "Mind map" },
        title: { fr: "Ta carte mentale", en: "Your mind map" },
        body: {
          fr: "Génère la carte du cours, puis déplace-toi, zoome et touche une idée pour l'explorer.",
          en: "Generate the course map, then pan, zoom and tap an idea to explore it.",
        },
      },
      {
        id: "toolbar",
        targets: ["mindmap-toolbar"],
        optional: true,
        icon: Expand,
        ...HUE.cyan,
        badge: { fr: "Outils", en: "Tools" },
        title: { fr: "Déplie et exporte", en: "Expand and export" },
        body: { fr: "Tout déplier, tout replier, ou exporter en SVG ou PNG.", en: "Expand all, collapse all, or export as SVG or PNG." },
      },
    ],
  },
};
