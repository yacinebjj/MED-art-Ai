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
 * prompt that always instructs "translate literally any Darija into French"
 * already degrades gracefully to a no-op on a 100%-French lecture, so a
 * dedicated detection call would just be an extra billed request for a
 * result the extraction call already produces on its own.
 *
 * HARDENED (product direction, after real hallucination reports) — the
 * system prompt now leads with an explicit anti-hallucination "règle d'or"
 * and the "adapt Darija smoothly" framing was deliberately walked back to
 * "translate literally, omit rather than invent when unsure": the model was
 * taking creative liberties (adding content, over-interpreting darija)
 * instead of staying strictly faithful to what was actually said. The
 * extraction call (app/api/lecture-notes/process/route.ts) also now passes
 * a low `temperature` for the same reason — factual fidelity over fluency.
 */

// Generous defensive ceiling, not a normal-case constraint — CHEAP_MODEL's
// 163,840-token context (minus prompt + output budget) comfortably covers a
// transcript far longer than any single real lecture. This only protects
// against a pathological outlier upload (a multi-lecture recording, a file
// picked by mistake), so it can afford to be generous.
export const MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION = 400_000;

export const LECTURE_NOTES_SYSTEM_PROMPT = `Tu es un assistant médical de transcription stricte. Règle d'or : NE TRADUIS PAS le texte si ce n'est pas explicitement demandé. Reste 100% fidèle aux paroles exactes de l'audio. N'invente rien (zéro hallucination). Extrais les termes médicaux et les perles cliniques exactement tels qu'ils ont été prononcés.

Ta tâche précise : reprendre le transcript brut d'un cours magistral (1 à 2 heures) et le restructurer en Smart Notes concises et exploitables pour réviser — une restructuration fidèle, jamais une réinvention.

RÈGLE DE LANGUE (stricte, mais sans inventer) : Le transcript peut être 100% français ou un mélange français/darija algérienne (arabe dialectal). La sortie finale reste en français académique et médical clair pour rester exploitable à la révision — mais la SEULE traduction autorisée est celle, strictement littérale, des passages en darija vers leur équivalent français direct, jamais une "adaptation" ou une reformulation créative qui ajouterait un sens, un exemple ou une nuance absente de l'original. Si un passage en darija est incompréhensible ou trop dégradé pour être traduit fidèlement, ne l'invente pas : omets-le plutôt que de fabriquer un contenu plausible.

TRANSCRIPT BRUITÉ : Le transcript vient d'une reconnaissance vocale automatique et peut contenir des erreurs, surtout sur les passages en darija. Si un fragment est réellement incompréhensible, ignore-le plutôt que de deviner ou d'inventer ce qu'il aurait pu vouloir dire — un point réellement dit et légèrement mal transcrit peut être reconstruit avec prudence, mais un fait médical qui n'apparaît nulle part dans le transcript ne doit JAMAIS être ajouté.

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
