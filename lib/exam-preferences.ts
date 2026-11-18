/**
 * The "Générateur d'Examen" exam profile. Students have no settings.
 *
 * Since 2026-11-18 NO directive of this file reaches a prompt: the canonical
 * exam is the Studio « Examen QCM » at 100 % (lib/ai/exam-prompts.ts), whose
 * prompt has no « PRÉFÉRENCES DE L'ÉTUDIANT » block — canonicalExamSystemPrompt
 * (lib/exam-generation.ts) no longer appends one. The values and their texts
 * stay defined (ExamPreferencesSchema still reads what older pages send, then
 * ignores it); re-attaching a directive changes the canonical prompt: bump
 * CANONICAL_BANK_PROFILE and the exam cache key with it.
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

/**
 * The canonical exam's profile (product decision, 2026-10-23). Its directives
 * were appended to the canonical prompt until 2026-11-18 — no longer (see this
 * file's header): the exam's level is the Studio « Examen QCM »'s.
 */
export const DEFAULT_EXAM_PREFERENCES: ExamPreferences = {
  difficulty: "examen_blanc",
  questionFocus: "equilibre",
  explanationDepth: "approfondie",
};

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
    "TYPE DE QUESTIONS : au moins 70 % des questions sont des CAS CLINIQUES — une vignette de patient (âge, terrain, symptômes, examens) suivie d'une question de raisonnement (diagnostic, examen à demander, conduite à tenir) — dans les formats QCS, QCM et combinaisons demandés.",
  connaissances:
    "TYPE DE QUESTIONS : majoritairement des questions de CONNAISSANCE directe (définitions, mécanismes, classifications, chiffres clés), avec des énoncés courts ; au maximum 20 % de vignettes cliniques — dans les formats QCS, QCM et combinaisons demandés.",
};

const EXPLANATION_DIRECTIVES: Record<ExamExplanationDepth, string> = {
  concise: "EXPLICATIONS : une seule phrase claire par option, qui dit pourquoi elle est juste ou fausse.",
  standard: "",
  approfondie:
    "EXPLICATIONS APPROFONDIES : pour CHAQUE option, 2 à 4 phrases — le mécanisme ou la règle qui la rend juste ou fausse, et le piège qu'elle représente — afin que la correction serve de vraie fiche de révision.",
};

function buildDirectiveBlock(directives: string[]): string {
  const parts = directives.filter(Boolean);
  if (parts.length === 0) return "";
  return `PRÉFÉRENCES DE L'ÉTUDIANT POUR CET EXAMEN (prioritaires sur toute consigne de répartition ci-dessus, sans jamais changer le format JSON demandé) :\n- ${parts.join("\n- ")}`;
}

/** Extra system-prompt block for these preferences (empty when every one of them has no directive). */
export function buildExamPreferenceDirective(preferences: ExamPreferences): string {
  return buildDirectiveBlock([DIFFICULTY_DIRECTIVES[preferences.difficulty], FOCUS_DIRECTIVES[preferences.questionFocus], EXPLANATION_DIRECTIVES[preferences.explanationDepth]]);
}
