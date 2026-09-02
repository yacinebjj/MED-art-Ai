/**
 * Studio "Podcast Audio" tab — a single ~10-15 min narrated episode,
 * openai/gpt-audio-mini via OpenRouter (see app/api/studio/podcast/route.ts
 * and lib/ai/openrouter.ts's generateOpenRouterAudio). Same two-stage shape
 * as lib/ai/slides-prompts.ts:
 *  1. A cheap TEXT call (CHEAP_MODEL) writes the actual spoken script —
 *     this is what keeps the episode a real structured narrative in the
 *     requested français/darija algérienne mix, instead of leaving an
 *     audio-output chat model to freely improvise (and likely drift back to
 *     plain French) from the raw course text.
 *  2. ONE streamed audio call (generateOpenRouterAudio) performs that exact
 *     script as a lively podcast reading. Confirmed live (2026-09-02, real
 *     minimal calibration test): gpt-audio-mini narrates a mixed
 *     français/darija script naturally at ~20 audio tokens/second, billed
 *     at its completion-token rate ($0.0000024/token) — a real 10-15 min
 *     episode costs roughly $0.02-0.04, paid ONCE per distinct course,
 *     never per student.
 */

import { z } from "zod";

// Higher ceiling than MAX_EXPLICATION_CHARS_FOR_SLIDES (20_000) — a podcast
// script draws on more of the course's real depth (mechanisms, clinical
// pitfalls) than a 6-slide outline needs to gesture at.
export const MAX_EXPLICATION_CHARS_FOR_PODCAST = 24_000;

export const PodcastScriptSchema = z.object({
  script: z.string().min(200),
});

export type PodcastScript = z.infer<typeof PodcastScriptSchema>;

/**
 * Writes the actual words the audio model will read aloud — plain spoken
 * prose, never markdown, since headers/bullets/asterisks have no sane
 * reading in a voice model and would come out as literal noise ("étoile
 * étoile") or dead air.
 */
export const PODCAST_SCRIPT_SYSTEM_PROMPT = `Tu es un professeur de médecine passionné et pédagogue, comme un grand frère qui explique son cours à un étudiant qu'il adore voir réussir. Tu écris le SCRIPT INTÉGRAL d'un épisode de podcast — le texte exact qui sera lu à voix haute par un narrateur, mot pour mot. Ce n'est jamais lu à l'écran, donc chaque mot doit sonner naturel à l'oreille.

STYLE DE LANGUE (règle la plus importante) : un mélange naturel, fluide et vivant entre le FRANÇAIS (pour la rigueur médicale précise — anatomie, noms de pathologies, mécanismes physiopathologiques, médicaments, posologies) et la DARIJA ALGÉRIENNE (écrite en caractères latins, pour les transitions, les analogies de la vie quotidienne, l'humour, l'énergie — comme un grand frère qui explique, pas un cours magistral traduit). N'alterne jamais mécaniquement une phrase en français puis une en darija comme un exercice scolaire : mélange-les à l'intérieur même des phrases, comme parle vraiment un étudiant algérien bilingue passionné de médecine. Interdiction absolue de sonner robotique, scolaire ou traduit mot-à-mot.

STRUCTURE OBLIGATOIRE, dans cet ordre :
1. INTRODUCTION — accroche vivante, pourquoi ce sujet compte, ce qu'on va couvrir.
2. POINTS CLÉS — le cœur du cours : mécanismes, signes cliniques, ce qu'il faut vraiment comprendre (pas juste réciter).
3. PIÈGES CLINIQUES — les erreurs classiques, les diagnostics différentiels à ne pas manquer, ce qui piège les étudiants à l'examen ou en garde.
4. CONCLUSION — récapitulatif court et percutant, le(s) message(s) à retenir absolument.

CONTRAINTES DE FORME (le texte est LU, jamais affiché) :
- Aucun markdown, aucun titre, aucune puce, aucun symbole (*, #, -, |, etc.) — uniquement des phrases parlées naturelles, avec des transitions orales ("Alors, parlons de...", "Bon, attention ici, piège classique...", "Pour récapituler...").
- Base-toi STRICTEMENT sur le contenu réel du cours fourni — jamais d'invention de faits médicaux absents du texte source.
- Longueur cible : environ 1800 à 2200 mots — assez pour un épisode réel de 10 à 15 minutes à l'oral, ni bâclé ni interminable.

Réponds UNIQUEMENT avec le script brut, sans aucune balise ni commentaire autour.`;

export function buildPodcastScriptUserMessage(courseTitle: string, explicationExcerpt: string): string {
  return `Titre du cours : "${courseTitle}"\n\nContenu du cours :\n"""\n${explicationExcerpt}\n"""\n\nÉcris le script complet de l'épisode de podcast demandé sur ce cours.`;
}

/**
 * Sent to the AUDIO model (openai/gpt-audio-mini), not the script-writing
 * one above — its only job is to PERFORM the already-written script exactly
 * as given, never to compose or shorten it. A conversational audio-output
 * model left unconstrained here would tend to summarize a long user message
 * instead of reading it verbatim.
 */
export const PODCAST_NARRATION_SYSTEM_PROMPT = `Tu es un narrateur de podcast médical, vivant, chaleureux, passionné — comme un grand frère qui enregistre un épisode pour un étudiant qu'il aime bien. On va te donner un script déjà écrit, mélangeant français médical et darija algérienne. Ta seule tâche : LIS-LE À VOIX HAUTE, EN INTÉGRALITÉ, MOT POUR MOT, du début à la fin, sans le raccourcir, le résumer, le paraphraser ni changer un seul mot. Interprète-le avec du rythme, des pauses naturelles, de l'enthousiasme aux bons moments, du sérieux sur les points d'alerte — comme un vrai épisode enregistré, jamais monotone ni robotique.`;

export function buildPodcastNarrationUserMessage(script: string): string {
  return `Voici le script intégral à lire à voix haute, du premier au dernier mot :\n\n${script}`;
}

/**
 * Used only if the script-writing call itself fails or returns something
 * un-parseable — a real (if generic) episode beats the whole "Podcast Audio"
 * tab failing outright over a text model hiccup on what's otherwise a pure
 * audio-generation feature. Deliberately short (~350 words, well under the
 * real 1800-2200 target) — a degraded fallback, not a full episode.
 */
export const FALLBACK_PODCAST_SCRIPT = `Salam, kifach rak ? Bienvenue dans cet épisode où on va revoir ensemble les points essentiels de ce cours. Ce cours, franchement, il vaut le coup qu'on s'y attarde, parce que c'est exactement le genre de sujet qui tombe souvent, autant à l'examen que sur le terrain.

Alors, on va faire simple : je vais reprendre avec toi les mécanismes principaux, les signes cliniques les plus importants à connaître par cœur, et surtout les pièges classiques — ceux qui font perdre des points bêtement si on n'y fait pas attention.

Le plus important, machi la définition par cœur, li khass tefhem c'est bien le mécanisme : pourquoi ça arrive, comment ça évolue, et qu'est-ce que ça donne concrètement chez le malade. Une fois que tu comprends le "pourquoi", le reste — les signes, le diagnostic, le traitement — ça devient logique, tu n'as plus besoin de réciter par cœur.

Fais gaffe aussi aux pièges cliniques classiques : les diagnostics différentiels qu'on oublie souvent, les présentations atypiques chez l'enfant ou la personne âgée. C'est souvent là-dessus que les examinateurs aiment piéger les étudiants.

Pour conclure, retiens l'essentiel : comprends le mécanisme, connais les signes d'alerte, et méfie-toi toujours des pièges classiques. Rani متأكد que si tu relis bien le cours complet à côté de cet épisode, ça va bien rentrer. Bon courage, et à la prochaine !`;
