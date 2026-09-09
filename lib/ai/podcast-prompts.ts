/**
 * Studio "Podcast Audio" tab — a single ~5-6 min narrated episode (SHRUNK
 * from an original ~10-15 min target after a real production incident: the
 * longer script pushed the full script+narration+encode+upload pipeline
 * past this route's platform-enforced time budget often enough that the
 * episode simply never completed — see app/api/studio/podcast/route.ts's
 * own maxDuration comment for the full mechanism, and AUDIO_MAX_TOKENS'
 * comment there for the matching token-budget cut), openai/gpt-audio-mini
 * via OpenRouter (see app/api/studio/podcast/route.ts and
 * lib/ai/openrouter.ts's generateOpenRouterAudio). Same two-stage shape
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
 * The 4 language/dialect options exposed on the Studio "Podcast Audio" tile's
 * pre-generation menu. "fr-darija" is the ORIGINAL, sole hardcoded behavior
 * this feature shipped with — kept as the default so an omitted `dialect`
 * (every call site before this option existed) behaves identically to
 * before, and so it's the only variant studio_podcast_cache still serves
 * cross-student (see app/api/studio/podcast/route.ts's own comment on why
 * the other 3 bypass that cache entirely rather than extending its
 * single-column content_hash key).
 */
export type PodcastDialect = "fr" | "en" | "fr-darija" | "en-darija";
export const DEFAULT_PODCAST_DIALECT: PodcastDialect = "fr-darija";

function isPodcastDialect(value: unknown): value is PodcastDialect {
  return value === "fr" || value === "en" || value === "fr-darija" || value === "en-darija";
}

export function resolvePodcastDialect(value: unknown): PodcastDialect {
  return isPodcastDialect(value) ? value : DEFAULT_PODCAST_DIALECT;
}

const LANGUAGE_STYLE_BY_DIALECT: Record<PodcastDialect, string> = {
  "fr-darija": `un mélange naturel, fluide et vivant entre le FRANÇAIS (pour la rigueur médicale précise — anatomie, noms de pathologies, mécanismes physiopathologiques, médicaments, posologies) et la DARIJA ALGÉRIENNE (écrite en caractères latins, pour les transitions, les analogies de la vie quotidienne, l'humour, l'énergie — comme un grand frère qui explique, pas un cours magistral traduit). N'alterne jamais mécaniquement une phrase en français puis une en darija comme un exercice scolaire : mélange-les à l'intérieur même des phrases, comme parle vraiment un étudiant algérien bilingue passionné de médecine. Interdiction absolue de sonner robotique, scolaire ou traduit mot-à-mot.`,
  "en-darija": `un mélange naturel, fluide et vivant entre l'ANGLAIS MÉDICAL (pour la rigueur précise — anatomie, noms de pathologies, mécanismes physiopathologiques, médicaments, posologies) et la DARIJA ALGÉRIENNE (écrite en caractères latins, pour les transitions, les analogies de la vie quotidienne, l'humour, l'énergie). N'alterne jamais mécaniquement une phrase en anglais puis une en darija comme un exercice scolaire : mélange-les à l'intérieur même des phrases, comme parlerait un étudiant algérien bilingue anglais/darija passionné de médecine. Interdiction absolue de sonner robotique, scolaire ou traduit mot-à-mot.`,
  fr: `un français académique et médical clair, vivant et chaleureux — comme un grand frère qui explique, jamais un cours magistral récité. Rigueur médicale précise (anatomie, noms de pathologies, mécanismes physiopathologiques, médicaments, posologies), mais un ton naturel à l'oral, jamais robotique ni scolaire.`,
  en: `clear, warm, natural spoken English — like a caring older sibling explaining the course, never a recited lecture. Medically precise (anatomy, pathology names, pathophysiological mechanisms, drugs, dosages), but always natural to the ear, never robotic or stilted.`,
};

const STRUCTURE_LABELS_BY_DIALECT: Record<PodcastDialect, { intro: string; points: string; pitfalls: string; conclusion: string }> = {
  "fr-darija": { intro: "INTRODUCTION", points: "POINTS CLÉS", pitfalls: "PIÈGES CLINIQUES", conclusion: "CONCLUSION" },
  "en-darija": { intro: "INTRODUCTION", points: "POINTS CLÉS", pitfalls: "PIÈGES CLINIQUES", conclusion: "CONCLUSION" },
  fr: { intro: "INTRODUCTION", points: "POINTS CLÉS", pitfalls: "PIÈGES CLINIQUES", conclusion: "CONCLUSION" },
  en: { intro: "INTRODUCTION", points: "KEY POINTS", pitfalls: "CLINICAL PITFALLS", conclusion: "CONCLUSION" },
};

/**
 * Writes the actual words the audio model will read aloud — plain spoken
 * prose, never markdown, since headers/bullets/asterisks have no sane
 * reading in a voice model and would come out as literal noise ("étoile
 * étoile") or dead air.
 */
export function buildPodcastScriptSystemPrompt(dialect: PodcastDialect): string {
  const isEnglishBase = dialect === "en" || dialect === "en-darija";
  const labels = STRUCTURE_LABELS_BY_DIALECT[dialect];
  return isEnglishBase
    ? `You are a passionate, pedagogical medicine professor, like an older sibling explaining their course to a student they truly want to see succeed. You write the FULL SCRIPT of a podcast episode — the exact text a narrator will read aloud, word for word. It is never read on screen, so every word must sound natural to the ear.

LANGUAGE STYLE (the most important rule): ${LANGUAGE_STYLE_BY_DIALECT[dialect]}

MANDATORY STRUCTURE, in this order:
1. ${labels.intro} — a lively hook, why this topic matters, what will be covered.
2. ${labels.points} — the heart of the course: mechanisms, clinical signs, what really needs to be understood (not just recited).
3. ${labels.pitfalls} — classic mistakes, differential diagnoses not to miss, what trips students up on exams or on call.
4. ${labels.conclusion} — a short, punchy recap, the one or two things to absolutely remember.

FORM CONSTRAINTS (the text is READ, never displayed):
- No markdown, no headers, no bullets, no symbols (*, #, -, |, etc.) — only natural spoken sentences, with oral transitions ("So, let's talk about...", "Now, watch out here, classic trap...", "To recap...").
- Base yourself STRICTLY on the real course content provided — never invent medical facts absent from the source text.
- Target length: roughly 700 to 900 words — enough for a real, focused 5-6 minute spoken episode. Do NOT exceed this — a real production incident showed a longer (1800-2200 word) script pushed the full generation pipeline past its platform time budget and the episode never completed at all; a shorter, reliable episode is far better than a longer one that fails.

Respond ONLY with the raw script, no tags or commentary around it.`
    : `Tu es un professeur de médecine passionné et pédagogue, comme un grand frère qui explique son cours à un étudiant qu'il adore voir réussir. Tu écris le SCRIPT INTÉGRAL d'un épisode de podcast — le texte exact qui sera lu à voix haute par un narrateur, mot pour mot. Ce n'est jamais lu à l'écran, donc chaque mot doit sonner naturel à l'oreille.

STYLE DE LANGUE (règle la plus importante) : ${LANGUAGE_STYLE_BY_DIALECT[dialect]}

STRUCTURE OBLIGATOIRE, dans cet ordre :
1. ${labels.intro} — accroche vivante, pourquoi ce sujet compte, ce qu'on va couvrir.
2. ${labels.points} — le cœur du cours : mécanismes, signes cliniques, ce qu'il faut vraiment comprendre (pas juste réciter).
3. ${labels.pitfalls} — les erreurs classiques, les diagnostics différentiels à ne pas manquer, ce qui piège les étudiants à l'examen ou en garde.
4. ${labels.conclusion} — récapitulatif court et percutant, le(s) message(s) à retenir absolument.

CONTRAINTES DE FORME (le texte est LU, jamais affiché) :
- Aucun markdown, aucun titre, aucune puce, aucun symbole (*, #, -, |, etc.) — uniquement des phrases parlées naturelles, avec des transitions orales ("Alors, parlons de...", "Bon, attention ici, piège classique...", "Pour récapituler...").
- Base-toi STRICTEMENT sur le contenu réel du cours fourni — jamais d'invention de faits médicaux absents du texte source.
- Longueur cible : environ 700 à 900 mots — assez pour un épisode réel, focalisé, de 5 à 6 minutes à l'oral. NE DÉPASSE PAS cette longueur : un incident réel en production a montré qu'un script plus long (1800-2200 mots) faisait dépasser au pipeline complet son budget de temps sur la plateforme, et l'épisode ne se terminait jamais du tout — un épisode plus court mais fiable vaut largement mieux qu'un épisode plus long qui échoue.

Réponds UNIQUEMENT avec le script brut, sans aucune balise ni commentaire autour.`;
}

/** @deprecated kept only so any stray import doesn't hard-crash the build — every real call site now goes through buildPodcastScriptSystemPrompt(dialect). Equivalent to the "fr-darija" (original, default) variant. */
export const PODCAST_SCRIPT_SYSTEM_PROMPT = buildPodcastScriptSystemPrompt(DEFAULT_PODCAST_DIALECT);

export function buildPodcastScriptUserMessage(courseTitle: string, explicationExcerpt: string): string {
  return `Titre du cours : "${courseTitle}"\n\nContenu du cours :\n"""\n${explicationExcerpt}\n"""\n\nÉcris le script complet de l'épisode de podcast demandé sur ce cours.`;
}

/**
 * Sent to the AUDIO model (openai/gpt-audio-mini), not the script-writing
 * one above — its only job is to PERFORM the already-written script exactly
 * as given, never to compose or shorten it. A conversational audio-output
 * model left unconstrained here would tend to summarize a long user message
 * instead of reading it verbatim. Dialect-parametrized only for the
 * description of what the script contains — the actual performance
 * instruction (read verbatim, with warmth/rhythm) doesn't need to change per
 * language.
 */
export function buildPodcastNarrationSystemPrompt(dialect: PodcastDialect): string {
  const isEnglishBase = dialect === "en" || dialect === "en-darija";
  return isEnglishBase
    ? `You are a warm, passionate medical podcast narrator — like an older sibling recording an episode for a student they care about. You'll be given an already-written script. Your only task: READ IT ALOUD, IN FULL, WORD FOR WORD, from start to finish, without shortening, summarizing, paraphrasing, or changing a single word. Perform it with rhythm, natural pauses, enthusiasm at the right moments, seriousness on warning points — like a real recorded episode, never monotone or robotic.`
    : `Tu es un narrateur de podcast médical, vivant, chaleureux, passionné — comme un grand frère qui enregistre un épisode pour un étudiant qu'il aime bien. On va te donner un script déjà écrit${isEnglishBase ? "" : ", mélangeant français médical et darija algérienne"}. Ta seule tâche : LIS-LE À VOIX HAUTE, EN INTÉGRALITÉ, MOT POUR MOT, du début à la fin, sans le raccourcir, le résumer, le paraphraser ni changer un seul mot. Interprète-le avec du rythme, des pauses naturelles, de l'enthousiasme aux bons moments, du sérieux sur les points d'alerte — comme un vrai épisode enregistré, jamais monotone ni robotique.`;
}

/** @deprecated kept only so any stray import doesn't hard-crash the build — every real call site now goes through buildPodcastNarrationSystemPrompt(dialect). Equivalent to the "fr-darija" (original, default) variant. */
export const PODCAST_NARRATION_SYSTEM_PROMPT = buildPodcastNarrationSystemPrompt(DEFAULT_PODCAST_DIALECT);

export function buildPodcastNarrationUserMessage(script: string): string {
  return `Voici le script intégral à lire à voix haute, du premier au dernier mot :\n\n${script}`;
}

/**
 * Used only if the script-writing call itself fails or returns something
 * un-parseable — a real (if generic) episode beats the whole "Podcast Audio"
 * tab failing outright over a text model hiccup on what's otherwise a pure
 * audio-generation feature. Deliberately short (~350 words, well under the
 * real 1800-2200 target) — a degraded fallback, not a full episode. One
 * variant per dialect — none of these mention specific medical facts (a
 * fallback has no course content to draw from), so writing all 4 by hand is
 * safe and doesn't risk inventing anything.
 */
const FALLBACK_PODCAST_SCRIPT_BY_DIALECT: Record<PodcastDialect, string> = {
  "fr-darija": `Salam, kifach rak ? Bienvenue dans cet épisode où on va revoir ensemble les points essentiels de ce cours. Ce cours, franchement, il vaut le coup qu'on s'y attarde, parce que c'est exactement le genre de sujet qui tombe souvent, autant à l'examen que sur le terrain.

Alors, on va faire simple : je vais reprendre avec toi les mécanismes principaux, les signes cliniques les plus importants à connaître par cœur, et surtout les pièges classiques — ceux qui font perdre des points bêtement si on n'y fait pas attention.

Le plus important, machi la définition par cœur, li khass tefhem c'est bien le mécanisme : pourquoi ça arrive, comment ça évolue, et qu'est-ce que ça donne concrètement chez le malade. Une fois que tu comprends le "pourquoi", le reste — les signes, le diagnostic, le traitement — ça devient logique, tu n'as plus besoin de réciter par cœur.

Fais gaffe aussi aux pièges cliniques classiques : les diagnostics différentiels qu'on oublie souvent, les présentations atypiques chez l'enfant ou la personne âgée. C'est souvent là-dessus que les examinateurs aiment piéger les étudiants.

Pour conclure, retiens l'essentiel : comprends le mécanisme, connais les signes d'alerte, et méfie-toi toujours des pièges classiques. Rani متأكد que si tu relis bien le cours complet à côté de cet épisode, ça va bien rentrer. Bon courage, et à la prochaine !`,
  fr: `Bonjour et bienvenue dans cet épisode, où on va revoir ensemble les points essentiels de ce cours. Ce cours vaut vraiment le coup qu'on s'y attarde, parce que c'est exactement le genre de sujet qui tombe souvent, aussi bien à l'examen que sur le terrain.

Faisons simple : je vais reprendre avec toi les mécanismes principaux, les signes cliniques les plus importants à connaître par cœur, et surtout les pièges classiques — ceux qui font perdre des points bêtement si on n'y fait pas attention.

Le plus important, ce n'est jamais la définition apprise par cœur, c'est bien le mécanisme : pourquoi ça arrive, comment ça évolue, et ce que ça donne concrètement chez le malade. Une fois que tu comprends le "pourquoi", le reste — les signes, le diagnostic, le traitement — devient logique, tu n'as plus besoin de réciter par cœur.

Fais attention aussi aux pièges cliniques classiques : les diagnostics différentiels qu'on oublie souvent, les présentations atypiques chez l'enfant ou la personne âgée. C'est souvent là-dessus que les examinateurs aiment piéger les étudiants.

Pour conclure, retiens l'essentiel : comprends le mécanisme, connais les signes d'alerte, et méfie-toi toujours des pièges classiques. Je suis certain que si tu relis bien le cours complet à côté de cet épisode, ça va bien rentrer. Bon courage, et à la prochaine !`,
  en: `Hi, and welcome to this episode, where we'll go over the essential points of this course together. This course is genuinely worth the attention — it's exactly the kind of topic that comes up often, both on exams and in practice.

Let's keep it simple: I'll walk you through the main mechanisms, the most important clinical signs to know by heart, and above all the classic traps — the ones that make you lose points needlessly if you're not careful.

The most important thing is never the definition learned by rote — it's the mechanism: why it happens, how it evolves, and what it concretely looks like in the patient. Once you understand the "why", the rest — the signs, the diagnosis, the treatment — becomes logical, and you no longer need to recite it from memory.

Watch out too for the classic clinical pitfalls: the differential diagnoses that often get overlooked, the atypical presentations in children or the elderly. That's usually where examiners love to trip students up.

To conclude, remember the essentials: understand the mechanism, know the warning signs, and always be wary of the classic traps. I'm confident that if you go back over the full course alongside this episode, it will really sink in. Good luck, and see you next time!`,
  "en-darija": `Hi, kifach rak? Welcome to this episode, where we're going to go over the essential points of this course together. This course is genuinely worth the attention, wallah — it's exactly the kind of topic that comes up often, both on exams and in practice.

Let's keep it simple: I'll walk you through the main mechanisms, the most important clinical signs to know by heart, and above all the classic traps — the ones that make you lose points for nothing if you're not careful.

The most important thing, machi the definition by heart, li khass tefhem is the mechanism: why it happens, how it evolves, and what it concretely looks like in the patient. Once you understand the "why", the rest — the signs, the diagnosis, the treatment — becomes logical, and you no longer need to recite it from memory.

Watch out too for the classic clinical pitfalls: the differential diagnoses that often get overlooked, the atypical presentations in children or the elderly. That's usually where examiners love to trip students up.

To conclude, remember the essentials: understand the mechanism, know the warning signs, and always be wary of the classic traps. Rani sure that if you go back over the full course alongside this episode, it will really sink in. Good luck, and see you next time!`,
};

export function getFallbackPodcastScript(dialect: PodcastDialect): string {
  return FALLBACK_PODCAST_SCRIPT_BY_DIALECT[dialect];
}

/** @deprecated kept only so any stray import doesn't hard-crash the build — every real call site now goes through getFallbackPodcastScript(dialect). Equivalent to the "fr-darija" (original, default) variant. */
export const FALLBACK_PODCAST_SCRIPT = FALLBACK_PODCAST_SCRIPT_BY_DIALECT[DEFAULT_PODCAST_DIALECT];
