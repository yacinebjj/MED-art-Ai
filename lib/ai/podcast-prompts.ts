/**
 * Studio "Podcast Audio" tab — a single ~9-10 min narrated episode. RAISED
 * from a ~5-6 min target (SHRUNK, in turn, from an original ~10-15 min
 * target after a real production incident: that longer script pushed the
 * full script+narration+encode+upload pipeline past this route's
 * platform-enforced time budget often enough that the episode simply never
 * completed — see app/api/studio/podcast/route.ts's own maxDuration comment
 * for the full mechanism). Product feedback on the 5-6 min cut: too short to
 * feel like a real study session, and it forced the script into recap-only
 * mode rather than genuinely teaching anything. ~9-10 min was chosen
 * specifically because it sits comfortably BELOW the ~15 min point that
 * actually failed (a ~15 min episode's narration alone, at this model's
 * calibrated ~20 audio-tokens/second output rate and ~3.7x-faster-than-
 * real-time generation speed, needs ≈243s of generation time against a
 * 270s per-call timeout and a 300s route-wide platform ceiling — almost no
 * margin left for the script call, mp3 encode, and upload that also share
 * that budget; ~10 min's narration needs only ≈162s, leaving real margin).
 * See app/api/studio/podcast/route.ts's AUDIO_MAX_TOKENS comment for the
 * exact token-budget math this length target is paired with.
 *
 * openai/gpt-audio-mini via OpenRouter (see app/api/studio/podcast/route.ts
 * and lib/ai/openrouter.ts's generateOpenRouterAudio). Same two-stage shape
 * as lib/ai/slides-prompts.ts:
 *  1. A cheap TEXT call (PODCAST_SCRIPT_MODEL in the route) writes the actual spoken script —
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
// pitfalls) than a 6-slide outline needs to gesture at. RAISED 24_000 ->
// 32_000 alongside the script's own length target moving from ~700-900 to
// ~1300-1500 words — the script writer needs proportionally more real
// source material to teach genuinely NEW content at that length instead of
// padding/repeating the same handful of points it was given.
export const MAX_EXPLICATION_CHARS_FOR_PODCAST = 32_000;

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
/** Pure French — the darija variants are retired (product decision: no code-switching). */
export const DEFAULT_PODCAST_DIALECT: PodcastDialect = "fr";

function isPodcastDialect(value: unknown): value is PodcastDialect {
  return value === "fr" || value === "en" || value === "fr-darija" || value === "en-darija";
}

export function resolvePodcastDialect(value: unknown): PodcastDialect {
  // Retired mixed variants map to their pure base language (old clients / links).
  if (value === "fr-darija") return "fr";
  if (value === "en-darija") return "en";
  return isPodcastDialect(value) ? value : DEFAULT_PODCAST_DIALECT;
}

const LANGUAGE_STYLE_BY_DIALECT: Record<PodcastDialect, string> = {
  "fr-darija": `un mélange naturel, fluide et vivant entre le FRANÇAIS (pour la rigueur médicale précise — anatomie, noms de pathologies, mécanismes physiopathologiques, médicaments, posologies) et la DARIJA ALGÉRIENNE (écrite en caractères latins, pour les transitions, les analogies de la vie quotidienne, l'humour, l'énergie — comme un grand frère qui explique, pas un cours magistral traduit). N'alterne jamais mécaniquement une phrase en français puis une en darija comme un exercice scolaire : mélange-les à l'intérieur même des phrases, comme parle vraiment un étudiant algérien bilingue passionné de médecine. Interdiction absolue de sonner robotique, scolaire ou traduit mot-à-mot.`,
  "en-darija": `un mélange naturel, fluide et vivant entre l'ANGLAIS MÉDICAL (pour la rigueur précise — anatomie, noms de pathologies, mécanismes physiopathologiques, médicaments, posologies) et la DARIJA ALGÉRIENNE (écrite en caractères latins, pour les transitions, les analogies de la vie quotidienne, l'humour, l'énergie). N'alterne jamais mécaniquement une phrase en anglais puis une en darija comme un exercice scolaire : mélange-les à l'intérieur même des phrases, comme parlerait un étudiant algérien bilingue anglais/darija passionné de médecine. Interdiction absolue de sonner robotique, scolaire ou traduit mot-à-mot.`,
  fr: `un FRANÇAIS fluide, clair, élégant et accessible — et UNIQUEMENT du français. INTERDICTION ABSOLUE d'utiliser de l'arabe, de la darija, du franco-arabe ou tout autre mélange de langues (aucun « wallah », « kifach », « sahbi », etc.) : pas un seul mot hors du français, à l'exception des termes médicaux internationaux. Phrases simples et bien construites, ton posé, calme et bienveillant, comme un excellent enseignant qui prend le temps d'expliquer. Rigueur médicale précise (anatomie, pathologies, mécanismes physiopathologiques, médicaments, posologies), jamais robotique ni scolaire.`,
  en: `clear, warm, natural spoken ENGLISH only — never any Arabic, darija or mixed-language words. Simple, well-built sentences at a calm, steady pace, like an excellent teacher taking the time to explain. Medically precise (anatomy, pathology names, pathophysiological mechanisms, drugs, dosages), but always natural to the ear, never robotic or stilted.`,
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

MANDATORY STRUCTURE — 6 chapters, in this order, each one announced orally ("First chapter: the pathophysiology..."):
1. INTRODUCTION — a short, direct hook (2-3 sentences): why this topic matters, what the episode will cover. Never a long greeting or self-introduction.
2. PATHOPHYSIOLOGY — the mechanisms, step by step, with the reasoning behind each one and a concrete analogy that makes it click.
3. DIAGNOSIS — clinical presentation, key signs, the investigations and how to interpret them, the differential diagnoses not to miss.
4. TREATMENT — the therapeutic strategy and its rationale, first-line choices, monitoring, what changes in special situations — only what the course actually contains.
5. EXAM TRAPS (QCM) — the classic traps and confusions, the details examiners love, how to recognise the right answer.
6. CONCLUSION — a calm recap of the three to five things to remember.
If the course doesn't cover one of chapters 2-4 (e.g. no treatment section), say so in one sentence and spend that time deepening the chapters the course does cover — never invent content.

FORM CONSTRAINTS (the text is READ aloud, never displayed):
- No markdown, no headers, no bullets, no symbols (*, #, -, |, etc.) — only natural spoken sentences, with oral transitions between chapters and a short natural pause marker in the wording ("Let's take a breath and move on to the diagnosis.").
- Calm, steady pace: short-to-medium sentences, one idea at a time, never a rushed enumeration.
- Base yourself STRICTLY on the real course content provided — never invent medical facts absent from the source text.
- Target length: 1400 to 1600 words — a deep, academic 10 to 12 minute episode at a calm speaking pace. The length must come from genuinely covering more real content in more depth, never from repetition, filler or a long greeting. Do NOT exceed 1650 words: a longer script pushes the audio generation past its platform time budget and the episode never completes.

Respond ONLY with the raw script, no tags or commentary around it.`
    : `Tu es un professeur de médecine passionné et pédagogue, comme un grand frère qui explique son cours à un étudiant qu'il adore voir réussir. Tu écris le SCRIPT INTÉGRAL d'un épisode de podcast — le texte exact qui sera lu à voix haute par un narrateur, mot pour mot. Ce n'est jamais lu à l'écran, donc chaque mot doit sonner naturel à l'oreille.

STYLE DE LANGUE (règle la plus importante) : ${LANGUAGE_STYLE_BY_DIALECT[dialect]}

STRUCTURE OBLIGATOIRE — 6 chapitres, dans cet ordre, chacun annoncé à l'oral (« Premier chapitre : la physiopathologie... ») :
1. INTRODUCTION — une accroche courte et directe (2-3 phrases) : pourquoi ce sujet compte, ce que l'épisode va couvrir. Jamais de longue salutation ni d'auto-présentation.
2. PHYSIOPATHOLOGIE — les mécanismes, étape par étape, avec le raisonnement derrière chacun et une analogie concrète qui fait vraiment comprendre.
3. DIAGNOSTIC — présentation clinique, signes clés, examens complémentaires et leur interprétation, diagnostics différentiels à ne pas manquer.
4. TRAITEMENT — la stratégie thérapeutique et sa logique, les choix de première intention, la surveillance, ce qui change dans les situations particulières — uniquement ce que contient réellement le cours.
5. PIÈGES QCM — les pièges et confusions classiques, les détails que les examinateurs adorent, comment reconnaître la bonne réponse.
6. CONCLUSION — un récapitulatif posé des trois à cinq choses à retenir.
Si le cours ne traite pas l'un des chapitres 2 à 4 (par exemple pas de partie thérapeutique), dis-le en une phrase et consacre ce temps à approfondir les chapitres que le cours couvre réellement — n'invente jamais de contenu.

CONTRAINTES DE FORME (le texte est LU à voix haute, jamais affiché) :
- Aucun markdown, aucun titre, aucune puce, aucun symbole (*, #, -, |, etc.) — uniquement des phrases parlées naturelles, avec des transitions orales entre les chapitres et une respiration naturelle dans la formulation (« Prenons une petite respiration, et passons au diagnostic. »).
- Rythme calme et régulier : phrases courtes à moyennes, une idée à la fois, jamais d'énumération précipitée.
- Base-toi STRICTEMENT sur le contenu réel du cours fourni — jamais d'invention de faits médicaux absents du texte source.
- Longueur cible : 1400 à 1600 mots — un épisode académique et approfondi de 10 à 12 minutes à un rythme de parole posé. Cette longueur doit venir de couvrir réellement plus de contenu, plus en profondeur — jamais de répétition, de remplissage ou de longue salutation. NE DÉPASSE PAS 1650 mots : un script plus long fait dépasser à la génération audio son budget de temps sur la plateforme, et l'épisode ne se termine jamais.

Réponds UNIQUEMENT avec le script brut, sans aucune balise ni commentaire autour.`;
}

/** @deprecated kept only so any stray import doesn't hard-crash the build — every real call site now goes through buildPodcastScriptSystemPrompt(dialect). Equivalent to the "fr-darija" (original, default) variant. */
export const PODCAST_SCRIPT_SYSTEM_PROMPT = buildPodcastScriptSystemPrompt(DEFAULT_PODCAST_DIALECT);

/**
 * Anti-hallucination guard, placed right after the course text (closest to
 * the generation, where it weighs most — same placement as Explication's
 * GROUNDING_INSTRUCTION in lib/studio-explication-delta.ts). The reported
 * failure: episodes that talked about "ce cours" without ever naming
 * anything in it.
 */
const PODCAST_GROUNDING_INSTRUCTION = `CADRAGE STRICT (prioritaire) :
- Parle UNIQUEMENT du cours ci-dessus. Chaque chapitre doit s'appuyer sur des notions qui figurent réellement dans ce texte (mécanismes, signes, examens, traitements, chiffres) et les nommer explicitement.
- N'ajoute aucune maladie, aucun chapitre, aucun traitement ni aucun sujet absent du texte. Pas de conseils de méthode de travail génériques à la place du contenu du cours.
- N'invente aucun chiffre, aucune dose, aucune classification, aucune référence. En cas de doute sur un fait, ne le dis pas.`;

// The length is restated last because the script model (qwen3.8-flash, see
// PODCAST_SCRIPT_MODEL in the route) stopped at ~960 words with the system
// prompt's target alone; with it here, 1,158-1,593 words in 32-44 s (live, 2026-10-12).
export function buildPodcastScriptUserMessage(courseTitle: string, explicationExcerpt: string): string {
  return `Titre du cours : "${courseTitle}"\n\nContenu du cours :\n"""\n${explicationExcerpt}\n"""\n\n${PODCAST_GROUNDING_INSTRUCTION}\n\nÉcris le script complet de l'épisode de podcast demandé sur ce cours : les 6 chapitres, 1400 à 1600 mots au total — ne t'arrête pas avant d'avoir couvert chaque chapitre en profondeur avec le contenu réel du cours.`;
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
    : `Tu es un narrateur de podcast médical, vivant, chaleureux, passionné — comme un grand frère qui enregistre un épisode pour un étudiant qu'il aime bien. On va te donner un script déjà écrit${isEnglishBase ? "" : ", mélangeant français médical et darija algérienne"}. Ta seule tâche : LIS-LE À VOIX HAUTE, EN INTÉGRALITÉ, MOT POUR MOT, du début à la fin, sans le raccourcir, le résumer, le paraphraser ni changer un seul mot. Lis-le en FRANÇAIS uniquement, avec une prononciation claire, d'une voix calme, posée et régulière : ne te presse jamais, marque une vraie pause entre les chapitres et après chaque idée importante, souligne les points d'alerte avec sérieux — comme un excellent enseignant qui enregistre un épisode soigné, jamais monotone, jamais précipité, jamais robotique.`;
}

/** @deprecated kept only so any stray import doesn't hard-crash the build — every real call site now goes through buildPodcastNarrationSystemPrompt(dialect). Equivalent to the "fr-darija" (original, default) variant. */
export const PODCAST_NARRATION_SYSTEM_PROMPT = buildPodcastNarrationSystemPrompt(DEFAULT_PODCAST_DIALECT);

export function buildPodcastNarrationUserMessage(script: string): string {
  return `Voici le script intégral à lire à voix haute, du premier au dernier mot :\n\n${script}`;
}
