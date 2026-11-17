import type { Language } from "@/providers/LanguageProvider";
import type { TourId } from "@/lib/onboarding/tour-ids";

/**
 * The micro-tutorials' texts and files, played by
 * components/onboarding/HelpVideoDialog.tsx. Loaded with the player only (on
 * the first tap of a « ▶ » button), never with a page. Which pages have a
 * clip is decided in lib/onboarding/help-videos.ts: keep both lists equal.
 *
 * Each clip is a flat, silent screen recording of the real app (a demo
 * account, 390 × 844 at ×2, 30 fps H.264, a keyframe at each step), in
 * public/help/. A step's `at` is the second of the clip where it starts;
 * tapping a step seeks there.
 */

export interface HelpVideoStep {
  at: number;
  text: Record<Language, string>;
}

export interface HelpVideo {
  src: string;
  poster: string;
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  title: Record<Language, string>;
  summary: Record<Language, string>;
  steps: HelpVideoStep[];
}

const clip = (name: string, duration: number, rest: Pick<HelpVideo, "title" | "summary" | "steps">): HelpVideo => ({
  src: `/help/${name}.mp4`,
  poster: `/help/${name}.jpg`,
  width: 780,
  height: 1688,
  duration,
  ...rest,
});

export const HELP_VIDEOS: Partial<Record<TourId, HelpVideo>> = {
  // Dashboard « ? »: the first thing to do in MedArt AI.
  dashboard: clip("import", 16, {
    title: { fr: "Importe ton premier cours", en: "Import your first course" },
    summary: {
      fr: "Choisis ton module et ajoute ton polycopié : MedArt AI en fait un cours prêt à réviser.",
      en: "Pick your module and add your handout: MedArt AI turns it into a course ready to study.",
    },
    steps: [
      { at: 0, text: { fr: "Sur l'accueil, touche ton module (ici Cardiologie).", en: "On the home screen, tap your module (here, Cardiology)." } },
      { at: 5.1, text: { fr: "Ouvre « Sources », puis « Ajouter une source ».", en: "Open Sources, then Add a source." } },
      { at: 8.1, text: { fr: "Choisis ton PDF, Word ou PowerPoint, puis touche « Importer ».", en: "Pick your PDF, Word or PowerPoint, then tap Import." } },
      { at: 13.4, text: { fr: "Ton cours est prêt, et déjà ouvert.", en: "Your course is ready, and already open." } },
    ],
  }),
  // Module workspace: the Studio's « one tap generates, a second opens » rule.
  module: clip("studio", 16.2, {
    title: { fr: "Génère tes outils dans le Studio", en: "Generate your tools in the Studio" },
    summary: {
      fr: "Un appui génère l'outil pour le cours ouvert ; un second l'ouvre dès que son point de couleur apparaît.",
      en: "One tap generates the tool for the open course; tap again to open it once its colored dot appears.",
    },
    steps: [
      { at: 0, text: { fr: "Dans « Sources », ouvre un cours.", en: "In Sources, open a course." } },
      { at: 3.6, text: { fr: "Passe sur l'onglet « Studio ».", en: "Switch to the Studio tab." } },
      { at: 5.2, text: { fr: "Touche un outil, ici Exemples & Analogies : il se génère.", en: "Tap a tool, here Examples & Analogies: it is generated." } },
      { at: 9.8, text: { fr: "Son point de couleur apparaît : touche-le encore pour l'ouvrir.", en: "Its colored dot appears: tap it again to open it." } },
    ],
  }),
  // The Studio's QCM tool (its own « ? », in the open tool's header).
  "tool-qcm": clip("qcm", 13.7, {
    title: { fr: "Réponds aux QCM", en: "Answer the MCQs" },
    summary: {
      fr: "Comme le jour de l'examen : tu réponds, puis la correction t'explique chaque proposition.",
      en: "Just like exam day: you answer, then the correction explains every option.",
    },
    steps: [
      { at: 0, text: { fr: "Lis la question et ses propositions.", en: "Read the question and its options." } },
      { at: 2.8, text: { fr: "Dis si tu es sûr(e), puis touche ta réponse.", en: "Say how sure you are, then tap your answer." } },
      { at: 5.9, text: { fr: "La correction explique chaque proposition.", en: "The correction explains every option." } },
      {
        at: 10.2,
        text: {
          fr: "Question suivante : s'il y a plusieurs bonnes réponses, coche-les toutes puis valide.",
          en: "Next question: if several answers are right, tick them all, then confirm.",
        },
      },
    ],
  }),
  // Module exam (Semaine Bloquée).
  exam: clip("exam", 14.6, {
    title: { fr: "Lance un examen blanc", en: "Start a mock exam" },
    summary: {
      fr: "Des QCM style concours sur tout le module, chronométrés et corrigés.",
      en: "Exam-style MCQs across the whole module, timed and corrected.",
    },
    steps: [
      { at: 0, text: { fr: "Choisis les cours de l'examen (ou « Sélectionner tout »).", en: "Pick the exam's courses (or Select all)." } },
      { at: 2.6, text: { fr: "« Réglages de l'examen » : style du sujet, correction, minuteur.", en: "Exam settings: paper style, correction, timer." } },
      { at: 4.8, text: { fr: "Touche « Générer l'examen », puis confirme.", en: "Tap Generate the exam, then confirm." } },
      {
        at: 11.2,
        text: {
          fr: "Réponds à chaque question, puis « Afficher la correction » : ton score et les explications.",
          en: "Answer each question, then Show the correction: your score and the explanations.",
        },
      },
    ],
  }),
  // MedArt Copilot.
  assistant: clip("copilot", 15.5, {
    title: { fr: "Pose ta question au Copilot", en: "Ask the Copilot" },
    summary: {
      fr: "Une question en pleine révision ? Il répond, explique et structure, à toute heure.",
      en: "A question while studying? It answers, explains and structures, any time.",
    },
    steps: [
      { at: 0, text: { fr: "Écris ta question, ou dicte-la avec le micro.", en: "Type your question, or dictate it with the mic." } },
      { at: 5.6, text: { fr: "Envoie.", en: "Send it." } },
      { at: 7.3, text: { fr: "La réponse arrive, structurée : étapes, tableau, points clés.", en: "The answer arrives, structured: steps, table, key points." } },
      { at: 10.6, text: { fr: "Fais défiler, puis continue la conversation pour creuser.", en: "Scroll, then keep the conversation going to dig deeper." } },
    ],
  }),
  // Espace Étude › Flashcards.
  study: clip("flashcards", 9.2, {
    title: { fr: "Révise avec les flashcards", en: "Review with flashcards" },
    summary: {
      fr: "Réfléchis, retourne la carte, puis note ta réponse : MedArt AI te la reproposera au bon moment.",
      en: "Think, flip the card, then rate your answer: MedArt AI brings it back at the right time.",
    },
    steps: [
      { at: 0, text: { fr: "Lis la question et cherche la réponse dans ta tête.", en: "Read the question and recall the answer." } },
      { at: 2.4, text: { fr: "Touche la carte pour la retourner.", en: "Tap the card to flip it." } },
      { at: 5.1, text: { fr: "Note-toi : Difficile, Moyen ou Facile.", en: "Rate yourself: Hard, Medium or Easy." } },
      { at: 7, text: { fr: "La carte suivante arrive ; ta mémorisation se met à jour.", en: "The next card comes up; your memory stats update." } },
    ],
  }),
  // Abonnement.
  billing: clip("payment", 11.3, {
    title: { fr: "Abonne-toi en dinars", en: "Subscribe in dinars" },
    summary: {
      fr: "Choisis ta formule et paie par carte Edahabia ou CIB, sur la page sécurisée de Chargily.",
      en: "Choose your plan and pay with an Edahabia or CIB card, on Chargily's secure page.",
    },
    steps: [
      { at: 0, text: { fr: "Ton abonnement, et les cartes acceptées : Edahabia ou CIB.", en: "Your plan, and the cards accepted: Edahabia or CIB." } },
      { at: 4.3, text: { fr: "Choisis ta durée : 1 mois, 4 mois ou l'année (jusqu'à −57 %).", en: "Choose your length: 1 month, 4 months or the year (up to −57 %)." } },
      { at: 8.9, text: { fr: "Touche « Payer » : tu finalises sur la page sécurisée Chargily.", en: "Tap Pay: you finish on Chargily's secure page." } },
    ],
  }),
};
