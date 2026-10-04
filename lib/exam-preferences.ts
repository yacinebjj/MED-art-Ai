/**
 * "Générateur d'Examen" customization — shared by the page (controls) and
 * app/api/exam/generate (prompt directives). Default preferences produce
 * exactly the original exam (cache + question pooling untouched); any other
 * combination is generated fresh, like a style-guided exam.
 */
import { z } from "zod";

export const EXAM_DIFFICULTIES = ["debutant", "intermediaire", "examen_blanc"] as const;
export const EXAM_QUESTION_FOCUS = ["equilibre", "cas_cliniques", "connaissances"] as const;
export const EXAM_EXPLANATION_DEPTHS = ["concise", "standard", "approfondie"] as const;

export type ExamDifficulty = (typeof EXAM_DIFFICULTIES)[number];
export type ExamQuestionFocus = (typeof EXAM_QUESTION_FOCUS)[number];
export type ExamExplanationDepth = (typeof EXAM_EXPLANATION_DEPTHS)[number];

export const ExamPreferencesSchema = z.object({
  difficulty: z.enum(EXAM_DIFFICULTIES),
  questionFocus: z.enum(EXAM_QUESTION_FOCUS),
  explanationDepth: z.enum(EXAM_EXPLANATION_DEPTHS),
});
export type ExamPreferences = z.infer<typeof ExamPreferencesSchema>;

export const DEFAULT_EXAM_PREFERENCES: ExamPreferences = {
  difficulty: "intermediaire",
  questionFocus: "equilibre",
  explanationDepth: "standard",
};

export function isDefaultExamPreferences(preferences: ExamPreferences): boolean {
  return (
    preferences.difficulty === DEFAULT_EXAM_PREFERENCES.difficulty &&
    preferences.questionFocus === DEFAULT_EXAM_PREFERENCES.questionFocus &&
    preferences.explanationDepth === DEFAULT_EXAM_PREFERENCES.explanationDepth
  );
}

export const EXAM_PREFERENCE_LABELS = {
  difficulty: { debutant: "Débutant", intermediaire: "Intermédiaire", examen_blanc: "Examen blanc facultaire" },
  questionFocus: { equilibre: "Équilibré", cas_cliniques: "Cas cliniques", connaissances: "Connaissances" },
  explanationDepth: { concise: "Concise", standard: "Standard", approfondie: "Approfondie" },
} as const;

const DIFFICULTY_DIRECTIVES: Record<ExamDifficulty, string> = {
  debutant:
    "NIVEAU DÉBUTANT : questions centrées sur les notions fondamentales et leur compréhension directe ; énoncés courts et sans ambiguïté ; distracteurs clairement distincts de la bonne réponse ; aucune question piège.",
  intermediaire: "",
  examen_blanc:
    "NIVEAU EXAMEN BLANC FACULTAIRE : niveau d'un véritable examen de fin de module en faculté de médecine algérienne ; questions d'intégration qui croisent plusieurs notions ; distracteurs très plausibles construits sur les confusions classiques ; détails discriminants (seuils, chronologie, contre-indications) qui départagent les étudiants.",
};

const FOCUS_DIRECTIVES: Record<ExamQuestionFocus, string> = {
  equilibre: "",
  cas_cliniques:
    "FORMAT : au moins 70 % des questions sont des CAS CLINIQUES — une vignette de patient (âge, terrain, symptômes, examens) suivie d'une question de raisonnement (diagnostic, examen à demander, conduite à tenir).",
  connaissances:
    "FORMAT : majoritairement des questions de CONNAISSANCE directe (définitions, mécanismes, classifications, chiffres clés), avec des énoncés courts ; au maximum 20 % de vignettes cliniques.",
};

const EXPLANATION_DIRECTIVES: Record<ExamExplanationDepth, string> = {
  concise: "EXPLICATIONS : une seule phrase claire par option, qui dit pourquoi elle est juste ou fausse.",
  standard: "",
  approfondie:
    "EXPLICATIONS APPROFONDIES : pour CHAQUE option, 2 à 4 phrases — le mécanisme ou la règle qui la rend juste ou fausse, et le piège qu'elle représente — afin que la correction serve de vraie fiche de révision.",
};

/** Extra system-prompt block for non-default preferences (empty for the defaults). */
export function buildExamPreferenceDirective(preferences: ExamPreferences): string {
  const parts = [DIFFICULTY_DIRECTIVES[preferences.difficulty], FOCUS_DIRECTIVES[preferences.questionFocus], EXPLANATION_DIRECTIVES[preferences.explanationDepth]].filter(Boolean);
  if (parts.length === 0) return "";
  return `PRÉFÉRENCES DE L'ÉTUDIANT POUR CET EXAMEN (prioritaires sur toute consigne de répartition ci-dessus, sans jamais changer le format JSON demandé) :\n- ${parts.join("\n- ")}`;
}
