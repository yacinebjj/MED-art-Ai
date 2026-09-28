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
1. ${labels.intro} — a SHORT, direct hook (2-3 sentences, no more): why this topic matters, what's coming next. NEVER a long greeting, self-introduction, or "welcome to the show" preamble — that's dead airtime, not teaching, and the single laziest way a script pads itself out to hit a target length.
2. ${labels.points} — the heart of the episode, and where most of its length should genuinely live: walk through each major mechanism/concept from the course, and for EACH one, actually TEACH it — the underlying reasoning, why it happens physiologically, a concrete clinical example or analogy that makes it click. Don't just name a concept and move on to the next one. A student who already read the written course should still come away understanding something more deeply, or noticing something they'd glossed over, from hearing this — not just hear the same headline points read aloud back at them.
3. ${labels.pitfalls} — classic mistakes, differential diagnoses not to miss, what trips students up on exams or on call.
4. ${labels.conclusion} — a short, punchy recap, the one or two things to absolutely remember.

FORM CONSTRAINTS (the text is READ, never displayed):
- No markdown, no headers, no bullets, no symbols (*, #, -, |, etc.) — only natural spoken sentences, with oral transitions ("So, let's talk about...", "Now, watch out here, classic trap...", "To recap...").
- Base yourself STRICTLY on the real course content provided — never invent medical facts absent from the source text.
- Target length: roughly 1300 to 1500 words — enough for a real, substantial 9-10 minute spoken episode that actually teaches something, not a rushed recap. This length must come from genuinely covering more real content in more depth, NEVER from stretching: no repeating the same idea in different words, no restating what was "just said" every few sentences, no filler transitions, no padding through a long greeting or self-introduction (see point 1 above). If the course genuinely doesn't have enough real substance to reach this length while staying dense and useful, a shorter but genuinely substantive episode is ALWAYS better than an artificially padded one — never pad just to hit a number. Do NOT exceed roughly 1500-1600 words either — a real production incident showed a much longer (1800-2200 word) script pushed the full generation pipeline past its platform time budget and the episode never completed at all.

Respond ONLY with the raw script, no tags or commentary around it.`
    : `Tu es un professeur de médecine passionné et pédagogue, comme un grand frère qui explique son cours à un étudiant qu'il adore voir réussir. Tu écris le SCRIPT INTÉGRAL d'un épisode de podcast — le texte exact qui sera lu à voix haute par un narrateur, mot pour mot. Ce n'est jamais lu à l'écran, donc chaque mot doit sonner naturel à l'oreille.

STYLE DE LANGUE (règle la plus importante) : ${LANGUAGE_STYLE_BY_DIALECT[dialect]}

STRUCTURE OBLIGATOIRE, dans cet ordre :
1. ${labels.intro} — accroche COURTE et directe (2-3 phrases maximum) : pourquoi ce sujet compte, ce qu'on va couvrir. JAMAIS de longue salutation, d'auto-présentation ou de "bienvenue dans cet épisode" à rallonge — c'est du temps mort, pas de l'enseignement, et c'est la façon la plus paresseuse de gonfler artificiellement un script pour atteindre une longueur cible.
2. ${labels.points} — le cœur de l'épisode, là où doit vraiment vivre l'essentiel de la longueur : reprends chaque mécanisme/concept important du cours, et pour CHACUN, explique-le vraiment — le raisonnement sous-jacent, pourquoi ça se produit physiologiquement, un exemple clinique concret ou une analogie qui fait vraiment comprendre. Ne te contente jamais de nommer un concept pour passer au suivant. Un étudiant qui a déjà lu le cours écrit doit quand même repartir en comprenant quelque chose plus en profondeur, ou en remarquant un point qu'il avait survolé — pas juste entendre les mêmes points clés lus à voix haute.
3. ${labels.pitfalls} — les erreurs classiques, les diagnostics différentiels à ne pas manquer, ce qui piège les étudiants à l'examen ou en garde.
4. ${labels.conclusion} — récapitulatif court et percutant, le(s) message(s) à retenir absolument.

CONTRAINTES DE FORME (le texte est LU, jamais affiché) :
- Aucun markdown, aucun titre, aucune puce, aucun symbole (*, #, -, |, etc.) — uniquement des phrases parlées naturelles, avec des transitions orales ("Alors, parlons de...", "Bon, attention ici, piège classique...", "Pour récapituler...").
- Base-toi STRICTEMENT sur le contenu réel du cours fourni — jamais d'invention de faits médicaux absents du texte source.
- Longueur cible : environ 1300 à 1500 mots — assez pour un épisode réel et substantiel de 9 à 10 minutes à l'oral qui enseigne vraiment quelque chose, pas un simple récapitulatif expédié. Cette longueur doit venir de couvrir réellement plus de contenu, plus en profondeur — JAMAIS d'étirement artificiel : pas de répétition de la même idée avec d'autres mots, pas de reformulation de ce qui vient d'être dit toutes les deux phrases, pas de transitions creuses, pas de longue salutation/auto-présentation pour gagner du temps (voir point 1 ci-dessus). Si le cours n'a vraiment pas assez de matière réelle pour atteindre cette longueur en restant dense et utile, un épisode plus court mais réellement substantiel vaut TOUJOURS mieux qu'un épisode artificiellement gonflé — n'étire jamais juste pour atteindre un chiffre. NE DÉPASSE PAS non plus environ 1500-1600 mots : un incident réel en production a montré qu'un script bien plus long (1800-2200 mots) faisait dépasser au pipeline complet son budget de temps sur la plateforme, et l'épisode ne se terminait jamais du tout.

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
 * audio-generation feature.
 *
 * LENGTHENED from a ~350-word draft (which, read aloud, produced only ~3
 * minutes of audio) to a genuinely substantive ~950-1050 words per dialect —
 * a REAL production incident (2026-09-28) showed the fallback was being hit
 * far more often than "last resort" implied (see planPodcastScript's own
 * comment in app/api/studio/podcast/route.ts: its 30s timeout was tighter
 * than this app's OWN documented 60s OpenRouter connect-phase allowance —
 * see OPENROUTER_CONNECT_TIMEOUT_MS in lib/ai/openrouter.ts — so a plain,
 * healthy-but-slow connect could exhaust the whole budget before the model
 * ever started writing), meaning students were regularly getting this ~3
 * minute fallback instead of the intended ~9-10 minute episode. The product
 * requirement is a HARD minimum of 7 real minutes of audio even in the
 * degraded fallback path, not just in the happy path. At this narration
 * model's real spoken pace (the original ~350-word script measured at ~3
 * minutes, i.e. ~117 words/minute), ~950-1050 words clears 7 minutes with
 * real margin (~8-9 minutes) without needing to invent any course-specific
 * content. Still one variant per dialect, still zero specific medical facts
 * (a fallback has no course content to draw from) — the added length comes
 * entirely from generic, reusable exam-technique and study-method content
 * (how to structure any medicine topic, categories of classic exam traps,
 * active recall / spaced repetition, MCQ-reading technique, comparison-based
 * retention, practical listening advice), safe to write by hand across all 4
 * dialects without risking a fabricated fact. See PODCAST_PROMPT_VERSION's
 * own comment in app/api/studio/podcast/route.ts — bumped alongside this
 * change so already-cached episodes generated under the old short fallback
 * aren't served forever from cache.
 */
const FALLBACK_PODCAST_SCRIPT_BY_DIALECT: Record<PodcastDialect, string> = {
  "fr-darija": `Salam, kifach rak ? Bienvenue dans cet épisode où on va revoir ensemble les points essentiels de ce cours. Ce cours, franchement, il vaut le coup qu'on s'y attarde, parce que c'est exactement le genre de sujet qui tombe souvent, autant à l'examen que sur le terrain.

Alors, on va faire ça bien, pas à la va-vite. Je vais reprendre avec toi les mécanismes principaux, les signes cliniques les plus importants à connaître par cœur, les pièges classiques qui font perdre des points bêtement, et aussi la méthode pour vraiment RETENIR tout ça sur le long terme, machi juste pour un examen dans deux semaines.

Le plus important, machi la définition par cœur, li khass tefhem c'est bien le mécanisme : pourquoi ça arrive, comment ça évolue, et qu'est-ce que ça donne concrètement chez le malade. Une fois que tu comprends le "pourquoi", le reste — les signes, le diagnostic, le traitement — ça devient logique, tu n'as plus besoin de réciter par cœur, rak ghadi tfham b'la ma thefedh.

Une bonne façon de structurer n'importe quel cours de médecine dans ta tête, wahda tsala7 m3a tous les sujets : commence toujours par l'étiologie, ch7al mn cause momkin, pourquoi ça se déclenche chez tel patient et pas un autre. Après, passe au mécanisme physiopathologique — la chaîne d'événements à l'intérieur du corps. Ensuite seulement, la présentation clinique, ya3ni ki ybane 3end le malade concrètement, les symptômes, les signes à l'examen. Après ça, le diagnostic : quels examens demander en premier, dans quel ordre, qu'est-ce qui confirme, qu'est-ce qui élimine. Et enfin, la prise en charge et les complications possibles si on rate le coche. Had l'ordre, kif tdiro dima nafss, ywali automatique, et tqder tappliqui-h 3la wa7ad n'importe quel sujet nouveau li tsib fih rassek perdu.

Daba, nkhemou 3la les pièges cliniques. Rani gha3 nqoulek les catégories li lezm dima redd balek 3lihom : loulla, les présentations atypiques — 3end les enfants, 3end les personnes âgées, ou 3end une femme enceinte, souvent had les cas mayb3itch nafss le tableau classique, wa hadi exactement li l'examinateur ybghi ychouf wach fhemti wella t7fedh ghi. Thanya, les diagnostics différentiels li kayfout — kayn des maladies qui se ressemblent bezaf 3la l'examen clinique mais li ghadi ykhtalfou f la prise en charge, donc dima sowel rassek "wach kayn 7aja o5ra li tetbayan bhad chakl?". Thaletha, les signes d'alerte, les "red flags" — les combinaisons de symptômes li lezm ta3mel a3lihom vite, machi tsanaha l'ghdha. Rab3a, les pièges de chiffres — dosages, unités, délais, seuils — li l'examinateurs y7abou ybadlou ghi chwiya bach ychoufou wach rak concentré wella la. Wa fi l'akhir, les interactions ou les contre-indications li dima ynsawhom talaba, surtout m3a des terrains particuliers.

O ma nensawch chi haja o5ra : b3d ma tsma3 wtefham l'mécanisme, khass tdir wahda petite fiche résumé, ghi 2-3 lignes 3la kol nqta importante, bach tkoun 3andek sari3a bach traja3ha nhar l'examen bla ma tdaye3 wa9t traja3 l'cours kamel. Had la fiche, ki tkoun maktouba bklamek nta (machi copier-coller mn le cours), hia f nafsha wahda mn les meilleures façons bach tzid tfham o tab9a l'info, parce que ki tketbha bklamek, khass tkoun fhemtha l'awal.

Alors kifach tsta3mel had l'épisode bach ma ykounch ghi info tsma3ha o tensa? El fikra hia l'active recall : b3d ma tsma3 l'épisode, sedd le cours, o 7awel tketb wella tgoul b sotek 3ali les points principaux bla ma tchouf. Wach tqder tefsser le mécanisme b klamek nta? Wach tqder tsemmi 3lech had signe ybane f had l'7ala? Ida ma tqderch, ma mochkilach, hadi normal, rj3 l'cours, mais l'point houwa dima tjarreb tsta5rej l'information mn rassek 9bel ma techouf la réponse, machi ghi tqra o tensa. O kamel taleb ki y3awd nafss l'cours plusieurs fois b des intervalles — nhar, ba3d yomayen, ba3d semana — hadi li tsemmiw spaced repetition, o hia exactement li tban3l l'info tab9a f la mémoire à long terme, machi ghi jusqu'à l'examen o tetnsa.

Kayna nqta ta5ra muhimma, surtout ki tji l'examen taht chakl QCM wella vignettes cliniques : 9ra la vignette kamla 9bel ma tqfez 3la les propositions, hadi wahda mn les erreurs li kthar men talaba ydiro, ykhesro points ghi 3la 9raya sri3a machi 3la nqas f'l3ilm. Chouf mizan : wach la question tsowel 3la le diagnostic le plus probable, wach 3la l'examen li lezm tdemandeh l'awal, wella 3la la prise en charge immédiate ? Ma homach nafss chi, o l'énoncé souvent ykoun fih des données zaydin li ma tkhassnich, ghi bach ychoufou wach rak capable tfarez l'info importante mn l'info secondaire. O ida la question tsowel 3la "l'étape suivante la plus adaptée", hadi mab9ach nafss "le diagnostic définitif" — deux réponses momkin ykounou correctes mn wjhat nadhar mokhtalifa, mais wahda fihom biha li exactement tjaweb 3la la question kima tsowel bezzabt.

Wahda o5ra méthode qawiya bach tzid tab9a l'info : dima 9aren bin le sujet li 9ra daba o des sujets o5rin li ychabhouh. Ki tfham 3lech had l'maladie tban b'hadchakl o wahda o5ra tban bchakl mokhtalif mais tmess nafss l'organe, had la comparaison twali plus solide fel mémoire mn ay définition wahda b rassha. L'3a9el ytzakkar mlih les différences o les contrastes, machi les listes plates li ma3endhomch rabt bin b3adhoum.

O f l'akhir, khass tel3ab ana m3ak b'fikra o5ra : rak momkin tsma3 had l'épisode ki tkoun f'la route, f'la cuisine, wella 9bel ma trqod — hadi exactement l'avantage dyal l'audio, tqder tsta3mel des lahdhat "mortes" li b'la had l'format makanch ghi tdaye3. Mais ma tensach : had l'épisode howa un complément, machi un remplaçant total dyal l'cours écrit — l'écoute twalik tfham l'image générale o t7fedh les liens, mais les détails précis, les chiffres, o le vocabulaire exact, lezm tsib f'le cours nafso.

Pour conclure, retiens l'essentiel : comprends le mécanisme avant tout, connais les signes d'alerte, méfie-toi toujours des pièges classiques — présentations atypiques, diagnostics qui se ressemblent, chiffres modifiés, o pièges dyal l'énoncé f'les QCM — et n'oublie jamais l'active recall et la répétition espacée bach l'information tab9a m3ak fel mdawla, machi ghi f un coin de ta tête jusqu'à l'examen. Rani mota2ked que si tu relis bien le cours complet à côté de cet épisode, o tsta3mel had la méthode, ça va bien rentrer, o ghadi tji l'examen b confiance blâ ma t5af. Bon courage, et à la prochaine !`,
  fr: `Bonjour et bienvenue dans cet épisode, où on va revoir ensemble les points essentiels de ce cours. Ce cours vaut vraiment le coup qu'on s'y attarde, parce que c'est exactement le genre de sujet qui tombe souvent, aussi bien à l'examen que sur le terrain.

Faisons les choses sérieusement, pas à la va-vite. Je vais reprendre avec toi les mécanismes principaux, les signes cliniques les plus importants à connaître par cœur, les pièges classiques qui font perdre des points bêtement, et surtout la méthode pour vraiment retenir tout ça sur le long terme, pas seulement pour un examen dans deux semaines.

Le plus important, ce n'est jamais la définition apprise par cœur, c'est bien le mécanisme : pourquoi ça arrive, comment ça évolue, et ce que ça donne concrètement chez le malade. Une fois que tu comprends le "pourquoi", le reste — les signes, le diagnostic, le traitement — devient logique, tu n'as plus besoin de réciter par cœur, tu vas comprendre au lieu de mémoriser.

Voici une façon de structurer n'importe quel cours de médecine dans ta tête, une méthode qui marche pour tous les sujets : commence toujours par l'étiologie, les causes possibles, pourquoi ça se déclenche chez tel patient et pas chez un autre. Passe ensuite au mécanisme physiopathologique — la chaîne d'événements à l'intérieur du corps. Puis seulement, la présentation clinique : comment ça se manifeste concrètement chez le malade, les symptômes, les signes à l'examen. Ensuite, le diagnostic : quels examens demander en premier, dans quel ordre, qu'est-ce qui confirme, qu'est-ce qui élimine. Et enfin, la prise en charge et les complications possibles si on passe à côté. Cet ordre, si tu l'appliques systématiquement, devient automatique, et tu peux le réutiliser sur n'importe quel sujet nouveau où tu te sens perdu.

Parlons maintenant des pièges cliniques. Voici les catégories auxquelles il faut toujours faire attention : d'abord, les présentations atypiques — chez l'enfant, chez la personne âgée, ou chez une femme enceinte, ces cas ne suivent souvent pas le tableau classique, et c'est exactement ce que l'examinateur veut tester : as-tu vraiment compris, ou as-tu seulement appris par cœur ? Ensuite, les diagnostics différentiels qui se ressemblent — certaines pathologies ont une présentation clinique proche mais nécessitent une prise en charge différente, donc demande-toi toujours : "existe-t-il autre chose qui pourrait ressembler à ça ?". Troisième catégorie, les signes d'alerte, les "red flags" — les combinaisons de symptômes qui imposent d'agir vite, sans attendre. Quatrième catégorie, les pièges de chiffres — dosages, unités, délais, seuils — que les examinateurs adorent légèrement modifier pour vérifier ta concentration. Et enfin, les interactions ou contre-indications que les étudiants oublient souvent, surtout chez des terrains particuliers.

Alors, comment utiliser cet épisode pour que ce ne soit pas juste une information que tu écoutes puis que tu oublies ? L'idée, c'est le rappel actif : après avoir écouté cet épisode, ferme le cours, et essaie d'écrire ou de dire à voix haute les points principaux sans regarder. Es-tu capable d'expliquer le mécanisme avec tes propres mots ? Peux-tu dire pourquoi tel signe apparaît dans telle situation ? Si tu n'y arrives pas, ce n'est pas grave, c'est normal, retourne au cours — mais l'essentiel est de toujours essayer d'extraire l'information de ta mémoire avant de vérifier la réponse, plutôt que de simplement relire et oublier. Et reviens sur ce même cours plusieurs fois à intervalles espacés — un jour, puis deux jours après, puis une semaine après — c'est ce qu'on appelle la répétition espacée, et c'est exactement ce qui fait que l'information reste en mémoire à long terme, au lieu de disparaître juste après l'examen.

Il y a un dernier point important, surtout pour le jour de l'examen sous forme de QCM ou de vignettes cliniques : lis toujours l'énoncé en entier avant de te précipiter sur les propositions — c'est l'une des erreurs les plus fréquentes chez les étudiants, perdre des points par lecture trop rapide, pas par manque de connaissances. Regarde bien ce qu'on te demande exactement : la question porte-t-elle sur le diagnostic le plus probable, sur l'examen à demander en premier, ou sur la prise en charge immédiate ? Ce n'est jamais la même chose, et l'énoncé contient souvent des informations superflues, justement pour vérifier que tu sais distinguer l'essentiel de l'accessoire. Et si la question porte sur "la meilleure étape suivante", ce n'est pas la même chose que "le diagnostic définitif" — deux réponses peuvent sembler correctes selon l'angle, mais une seule répond précisément à ce qui est demandé.

Une autre méthode puissante pour mieux retenir : compare toujours le sujet que tu viens d'étudier à d'autres sujets qui lui ressemblent. Comprendre pourquoi une pathologie se présente d'une certaine façon et une autre, touchant le même organe, se présente différemment, rend cette comparaison bien plus solide en mémoire qu'une définition isolée. Le cerveau retient mieux les différences et les contrastes qu'une liste plate de faits sans lien entre eux.

Et pour finir sur l'usage pratique : tu peux très bien écouter cet épisode dans les transports, en cuisinant, ou avant de dormir — c'est justement l'avantage de l'audio, récupérer des moments autrement perdus. Mais garde en tête que cet épisode est un complément, jamais un remplacement total du cours écrit : l'écoute t'aide à saisir la vue d'ensemble et à retenir les liens logiques, mais les détails précis, les chiffres exacts et le vocabulaire technique, il faut aller les revérifier directement dans le cours.

Pour conclure, retiens l'essentiel : comprends le mécanisme avant tout, connais les signes d'alerte, méfie-toi toujours des pièges classiques — présentations atypiques, diagnostics qui se ressemblent, chiffres modifiés, pièges de lecture dans les énoncés — et n'oublie jamais le rappel actif et la répétition espacée pour que l'information reste vraiment avec toi, pas seulement jusqu'à l'examen. Je suis certain que si tu relis bien le cours complet à côté de cet épisode, et que tu appliques cette méthode, ça va bien rentrer, et tu arriveras à l'examen avec confiance. Bon courage, et à la prochaine !`,
  en: `Hi, and welcome to this episode, where we'll go over the essential points of this course together. This course is genuinely worth the attention — it's exactly the kind of topic that comes up often, both on exams and in practice.

Let's do this properly, not rushed. I'll walk you through the main mechanisms, the most important clinical signs to know by heart, the classic traps that make you lose points needlessly, and also the method for actually retaining all of this long-term, not just for an exam two weeks from now.

The most important thing is never the definition learned by rote — it's the mechanism: why it happens, how it evolves, and what it concretely looks like in the patient. Once you understand the "why", the rest — the signs, the diagnosis, the treatment — becomes logical, and you no longer need to recite it from memory, you actually understand it instead.

Here's a way to structure any medicine course in your head, a method that works across every topic: always start with etiology — the possible causes, why this happens in one patient and not another. Then move to the pathophysiological mechanism — the chain of events happening inside the body. Only then, the clinical presentation: how it concretely shows up in the patient, the symptoms, the signs on examination. After that, diagnosis: which tests to order first, in what order, what confirms it, what rules it out. And finally, management and the possible complications if it's missed. If you apply this same order every time, it becomes automatic, and you can reuse it on any new topic where you feel lost.

Now let's talk about clinical pitfalls. Here are the categories you should always watch for: first, atypical presentations — in children, in the elderly, or in a pregnant patient, these cases often don't follow the textbook picture, and that's exactly what examiners like to test: did you really understand it, or did you just memorize it? Second, look-alike differential diagnoses — some conditions look clinically similar but need a completely different management approach, so always ask yourself: "is there something else that could look like this?". Third, warning signs, the "red flags" — combinations of symptoms that demand acting fast, not waiting it out. Fourth, number traps — dosages, units, timeframes, thresholds — that examiners love to tweak slightly just to check whether you're really paying attention. And finally, interactions or contraindications that students often forget, especially in specific patient populations.

So how should you actually use this episode so it isn't just information you hear and then forget? The idea is active recall: after listening to this episode, close the course material, and try to write down or say out loud the main points without looking anything up. Can you explain the mechanism in your own words? Can you say why a particular sign shows up in a particular situation? If you can't, that's fine, that's normal — go back to the course. But the key is always trying to pull the information out of your own memory before checking the answer, rather than just rereading and forgetting. And come back to this same course again several times at spaced intervals — a day later, then two days after that, then a week later — that's what's called spaced repetition, and it's exactly what makes information stick in long-term memory instead of vanishing right after the exam.

There's one more important point, especially for exam day when questions come as MCQs or clinical vignettes: always read the whole stem before jumping to the answer choices — that's one of the most common ways students lose points, not from lacking knowledge, but from reading too fast. Look carefully at what's actually being asked: is the question about the most likely diagnosis, the test to order first, or the immediate management step? Those are never the same thing, and the stem often includes extra information on purpose, precisely to test whether you can separate what matters from what doesn't. And if the question asks for "the best next step", that's not the same as "the definitive diagnosis" — two answers can both look correct depending on the angle, but only one actually answers what was asked.

Another powerful way to retain material: always compare the topic you just studied to other topics that resemble it. Understanding why one condition presents a certain way, and another affecting the same organ presents differently, makes that comparison stick in memory far better than any single isolated definition. The brain remembers differences and contrasts much better than a flat list of disconnected facts.

And on practical use: you can absolutely listen to this episode while commuting, cooking, or before falling asleep — that's exactly the advantage of audio, reclaiming moments that would otherwise be lost. But keep in mind this episode is a complement, never a full replacement for the written course: listening helps you grasp the big picture and the logical connections, but the precise details, exact numbers, and technical vocabulary still need to be double-checked directly in the course material.

To conclude, remember the essentials: understand the mechanism above all, know the warning signs, always be wary of the classic traps — atypical presentations, look-alike diagnoses, altered numbers, reading traps in exam stems — and never forget active recall and spaced repetition so the information genuinely stays with you, not just until the exam. I'm confident that if you go back over the full course alongside this episode, and apply this method, it will really sink in, and you'll walk into the exam with real confidence. Good luck, and see you next time!`,
  "en-darija": `Hi, kifach rak? Welcome to this episode, where we're going to go over the essential points of this course together. This course is genuinely worth the attention, wallah — it's exactly the kind of topic that comes up often, both on exams and in practice.

Let's do this properly, machi bezrba. I'll walk you through the main mechanisms, the most important clinical signs to know by heart, the classic traps that make you lose points for nothing, and also the method to really retain all this long-term, machi ghi for an exam in two weeks.

The most important thing, machi the definition by heart, li khass tefhem is the mechanism: why it happens, how it evolves, and what it concretely looks like in the patient. Once you understand the "why", the rest — the signs, the diagnosis, the treatment — becomes logical, rak ghadi tfham instead of just memorizing.

Here's a way to structure any medicine course in your head, wahda tekhdem m3a kol topic: always start with etiology — ch7al mn cause momkin, why this happens in one patient and not another. Then move to the pathophysiological mechanism — the chain of events happening inside the body. Only then, the clinical presentation: kifach ybane 3end le malade concretely, the symptoms, the signs on examination. After that, diagnosis: which tests to order first, in what order, what confirms it, what rules it out. And finally, management and the possible complications if it's missed. Had l'ordre, ida ddirih dima nafss, ywali automatique, and you can reuse it on any new topic where you feel lost.

Now let's talk about clinical pitfalls, les catégories li lezm dima treddo balkom 3lihom. First, atypical presentations — in children, in the elderly, or in a pregnant patient, hadouk les cas ma yb3ithch nafss le tableau classique, and that's exactly what examiners like to test: wach fhemti wella ghi t7fedh? Second, look-alike differential diagnoses — kayn des maladies li ychabhou bezaf clinically but need a completely different management, so always ask yourself: "wach kayn 7aja o5ra li tetbayan b'hadchakl?". Third, warning signs, the "red flags" — combinations of symptoms li lezm ta3mel 3lihom vite, machi tsanaha. Fourth, number traps — dosages, units, timeframes, thresholds — li l'examinateurs y7ebbou ybaddlou chwiya just to check wach rak concentré. And finally, interactions or contraindications li talaba dima ynsawhom, especially f des terrains particuliers.

O ma tensach kifach kamla: once you've listened and understood the mechanism, make yourself a short summary sheet, ghi 2-3 lines par point important, so you have something quick to review on exam day bla ma tdaye3 wa9t rereading the whole course. That sheet, ki tkoun written in your own words (machi copy-paste mn le cours), hia one of the best ways bach tzid tfham o tretain the material, parce que ki tketbha bklamek, khass tkoun fhemtha l'awal, machi ghi copiée bla ma tefham.

So how should you actually use this episode bach ma ykounch ghi info tsma3ha o tensa? The idea is active recall: after listening, close the course, and try to write or say out loud the main points bla ma tchouf. Can you explain the mechanism in your own words? Can you say why a sign shows up in a specific situation? Ida ma qderchi, ma mochkilach, that's normal, go back to the course — but the key is always trying to pull the information out of your own memory before checking the answer, machi ghi tqra o tensa. And come back to this same course several times at spaced intervals — a day later, then two days after, then a week later — that's spaced repetition, o hia exactly li tkhalli l'information tab9a f la mémoire à long terme, machi ghi jusqu'à l'examen.

There's one more important point, khassni ngoulha, especially for exam day when questions come as MCQs or clinical vignettes: always read the whole stem kamel before jumping to the answer choices — hadi one of the most common ways students lose points, machi mn 3adem l'3ilm, mais mn 9raya bzerba. Look carefully wach exactly rah matlouba : is the question about the most likely diagnosis, the test to order first, or the immediate management step? Ma homach nafss chi, and the stem often includes extra information 3la l'9asd, bach ychoufou wach t9der tfarez li important mn li machi important. And if the question asks for "the best next step", hadi mab9ach nafss "the definitive diagnosis" — two answers momkin ybano correctes mn zawya mokhtalifa, mais wahda ghi fihom hia li exactement tjaweb 3la li matlouba.

Wahda o5ra powerful way bach tab9a l'ma3louma: dima 9aren bin le sujet li 9ra daba o des sujets o5rin li ychabhouh. Understanding why one condition presents differently mn wahda o5ra tmess nafss l'organe, makes that comparison twali more solide fel mémoire mn ay isolated definition. The brain remembers differences o les contrastes bezzaf ahsen mn une liste plate dyal facts bla rabt.

And on practical use: tqder tsma3 had l'épisode f'la route, f'la cuisine, wella 9bel ma trqod — hadi exactly l'avantage dyal l'audio, reclaiming moments li b'la hadchi kanou ghadin ytdaye3o. Mais tensach machi: had l'épisode howa a complement, never a full replacement dyal le cours écrit — listening helps you grasp la vue d'ensemble o les liens logiques, mais les détails précis, les chiffres, o le vocabulaire technique, lezm tmchi tverifihom f'le cours nafso.

To conclude, remember the essentials: understand the mechanism above all, know the warning signs, always be wary of the classic traps — atypical presentations, look-alike diagnoses, altered numbers, reading traps f'les énoncés — and never forget active recall and spaced repetition bach l'information tab9a m3ak beja3d. Rani sure that if you go back over the full course alongside this episode, and apply this method, it will really sink in, and you'll walk into the exam with real confidence. Good luck, and see you next time!`,
};

export function getFallbackPodcastScript(dialect: PodcastDialect): string {
  return FALLBACK_PODCAST_SCRIPT_BY_DIALECT[dialect];
}

/** @deprecated kept only so any stray import doesn't hard-crash the build — every real call site now goes through getFallbackPodcastScript(dialect). Equivalent to the "fr-darija" (original, default) variant. */
export const FALLBACK_PODCAST_SCRIPT = FALLBACK_PODCAST_SCRIPT_BY_DIALECT[DEFAULT_PODCAST_DIALECT];
