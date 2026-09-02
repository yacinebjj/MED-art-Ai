/**
 * Dashboard "Audio to Smart Notes" — Phase 2 (extraction). Takes the raw
 * transcript from OpenRouter's transcription endpoint (lib/ai/openrouter.ts's
 * transcribeAudioViaOpenRouter) of a 1-2h lecture and restructures it into
 * concise, exam-focused Smart Notes, entirely in French, via CHEAP_MODEL
 * (deepseek/deepseek-v3.2) — see app/api/lecture-notes/process/route.ts.
 *
 * Deliberately ONE call over the FULL transcript, never chunked: a 2h
 * lecture is ~22-24k tokens, and CHEAP_MODEL's context window is 163,840
 * tokens — chunking here would only add cost (the system prompt re-billed
 * per chunk) and risk fragmenting a lecture's continuous narrative across
 * chunk boundaries, for zero real benefit.
 *
 * No separate "detect French vs French/Darija mix" step either — a single
 * prompt that always instructs "translate/adapt any Darija into French"
 * already degrades gracefully to a no-op on a 100%-French lecture, so a
 * dedicated detection call would just be an extra billed request for a
 * result the extraction call already produces on its own.
 */

// Generous defensive ceiling, not a normal-case constraint — CHEAP_MODEL's
// 163,840-token context (minus prompt + output budget) comfortably covers a
// transcript far longer than any single real lecture. This only protects
// against a pathological outlier upload (a multi-lecture recording, a file
// picked by mistake), so it can afford to be generous.
export const MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION = 400_000;

export const LECTURE_NOTES_SYSTEM_PROMPT = `Tu es un professeur de médecine qui reprend le transcript brut d'un cours magistral (1 à 2 heures) et le transforme en Smart Notes concises et exploitables pour réviser.

RÈGLE DE LANGUE (stricte) : Le transcript peut être 100% français ou un mélange français/darija algérienne (arabe dialectal). Ta sortie est TOUJOURS entièrement en français académique et médical clair — traduis et adapte proprement tout passage en darija (analogies, explications orales du professeur) dans ce français, sans jamais le laisser brut ni le signaler explicitement (pas de "[en darija]" ou équivalent) — intègre-le naturellement comme si le cours avait été donné en français depuis le début.

TRANSCRIPT BRUITÉ : Le transcript vient d'une reconnaissance vocale automatique et peut contenir des erreurs, surtout sur les passages en darija — reconstruis le sens probable à partir du contexte médical plutôt que de bloquer sur un fragment incohérent.

FILTRAGE (obligatoire) : Ignore complètement le bruit de fond, les discussions d'étudiants hors-sujet, les répétitions, et le remplissage oral ("euh", "donc voilà", "d'accord ?"). N'inclus QUE le contenu médical réel du cours.

INDICES D'EXAMEN (priorité absolue) : Repère chaque moment où le professeur signale explicitement l'importance d'un point pour l'examen ("ça c'est important", "je vais vous poser cette question", "retenez bien ça", "c'est tombé l'année dernière", etc.) et mets-le en évidence dans une section dédiée — c'est l'information la plus précieuse de toute la note.

STRUCTURE DE SORTIE (Markdown, avec ces 3 titres exacts) :
## Résumé du cours
Synthèse structurée des points médicaux réellement enseignés, en paragraphes courts ou listes à puces.

## Points cliniques clés
Les mécanismes, signes cliniques, diagnostics et traitements les plus importants, en liste à puces.

## Indices d'examen
Chaque signal d'importance repéré dans le cours, reformulé clairement. Si le professeur n'en a donné aucun, écris "Aucun indice d'examen explicite repéré dans ce cours."

LONGUEUR : 800 à 1200 mots au total — une vraie synthèse condensée, jamais une paraphrase proportionnelle à la durée du cours source.`;

export function buildLectureNotesUserMessage(transcript: string): string {
  return `Voici le transcript brut du cours magistral. Génère les Smart Notes demandées.\n\n"""\n${transcript}\n"""`;
}
