import type { ExamStyleProfile } from "./exam-schemas";
import { type FormatCounts } from "@/lib/exam-formats";
import {
  STUDIO_QCM_CLINICAL_RULES,
  STUDIO_QCM_CLINICAL_SCOPE,
  STUDIO_QCM_NATURE,
  STUDIO_QCM_PERSONA,
  studioQcmFairness,
  studioQcmReading,
  studioQcmTraps,
} from "@/lib/ai/studio-prompts";
import { accentLine, zoneBlock } from "@/lib/ai/studio-qcm-focus";

export interface ExamCourseInput {
  title: string;
  text: string;
}

function formatCoursesBlock(courses: ExamCourseInput[]): string {
  return courses.map((course, i) => `--- Cours ${i + 1} : "${course.title}" ---\n${course.text}`).join("\n\n");
}

/**
 * THE MODULE EXAM IS THE STUDIO « EXAMEN QCM » (2026-11-18, product order:
 * difficulty and question format IDENTICAL to the Studio, at 100 %).
 *
 * The 2026-11-19 parity copied the Studio's blocks, but the exam kept its own
 * scaffolding around them, and that scaffolding is what made it « scolaire »:
 *  - a paragraph making SHORT DIRECT questions « la majorité de chaque lot »,
 *    « SANS mise en situation clinique », and a per-job order of EXACTLY one
 *    clinical case (the old 90 % / 10 % rule) — where the Studio asks for at
 *    least 2 vignettes per batch of 5 on a clinical course;
 *  - no focus zone and no accent: the model picked the most obvious notions,
 *    where every Studio batch is aimed at one zone of the course and one angle
 *    (mechanisms, predictions, situations, distinctions, integration, nuances);
 *  - a format mix of 40 % QCS / 35 % QCM / 25 % combinations and « about one
 *    question in four » in RF — the Studio's batch is 2 type K combinations,
 *    1 RF, 1 multi-answer QCM, 1 QCS;
 *  - a « PRÉFÉRENCES DE L'ÉTUDIANT » block the Studio does not have;
 *  - and (lib/exam-generation.ts, app/api/exam/run) the source text: the
 *    student's simplified Explication instead of the course itself, cut to a
 *    24k-char slice per job.
 * Now the method blocks are IMPORTED from the Studio prompt
 * (lib/ai/studio-prompts.ts), never copied, so the two can never drift apart
 * again; each job gets the Studio's zone and accent (lib/ai/studio-qcm-focus.ts)
 * and the Studio's composition. Only what the exam's JSON or its several
 * courses require is the exam's own: the three formats' JSON, the correction's
 * fields, the weak-point tag, the attribution of a question to its course.
 */

/**
 * The three question formats' JSON (lib/exam-formats.ts), described ONCE and
 * shared by the default and the style-adapted prompts, so both always ask for
 * the same JSON that ExamQuestionSchema (lib/ai/exam-schemas.ts) validates. The
 * worked example places each correct answer away from "A" on purpose.
 */
const EXAM_FORMATS_RULES = `LES TROIS FORMATS DE QUESTIONS (comme aux examens des facultés de médecine algériennes) — chaque question indique son "format" et sa "polarity" :
1. "qcs" (QCS, choix simple) : 5 propositions A à E, UNE SEULE réponse à cocher. "polarity" : "rj" (la seule proposition exacte) ou "rf" (la seule proposition inexacte). L'énoncé se termine par « (RJ) » ou « (RF) ». Exactement UNE option a "isCorrect": true — celle à cocher (pour une RF, c'est la proposition fausse).
2. "qcm" (QCM, choix multiples) : 5 propositions A à E, PLUSIEURS réponses à cocher (2 à 4, jamais 1 ni 5). "polarity" : "rj" (cocher toutes les propositions exactes) ou "rf" (cocher toutes les propositions inexactes). L'énoncé se termine par « (RJ) » ou « (RF) ». Entre 2 et 4 options ont "isCorrect": true — exactement celles à cocher.
3. "combinaison" (propositions numérotées) : l'énoncé ("vignette") se termine par « (RJ) : » ou « (RF) : » et NE contient PAS les propositions. Le champ "propositions" contient EXACTEMENT 5 propositions, numérotées 1 à 5 dans l'ordre, chacune avec "isTrue" (exacte ou non) et une "explanation". Les 5 options A à E ont pour "text" une combinaison de numéros écrite uniquement avec des chiffres de 1 à 5 et des « + » (ex : "1+3", "1+2+4", "2+4+5", "3+4+5", "1+2"), toutes différentes. Exactement UNE option a "isCorrect": true : celle dont la combinaison contient TOUTES et SEULEMENT les propositions exactes (RJ) ou inexactes (RF) ; les 4 autres sont des pièges plausibles (une proposition en trop ou en moins). L'"explanation" de chaque option dit pourquoi la combinaison est juste, ou quelle proposition la rend fausse.

Dans chaque format, une explication pour CHAQUE option (pourquoi elle est juste ou fausse), avec une terminologie médicale précise. Les polarités (RJ ou RF) sont celles de la composition du lot ; varie la position des bonnes réponses. Avant de répondre, vérifie chaque question à combinaisons : la combinaison marquée juste contient-elle exactement les propositions à cocher ?`;

/** The Studio's batch (2 type K, 1 RF, 1 multi-answer QCM, 1 QCS), in the exam's three formats. */
const EXAM_LOT_COMPOSITION = `LA COMPOSITION D'UN LOT (celle du Studio) — chaque question a exactement 5 options A, B, C, D, E. Dans CHAQUE lot de 5 questions : exactement 2 questions "combinaison" en RJ (la combinaison de type K, la matrice des examens algériens), exactement 1 question en réponse fausse — un "qcs" RF —, exactement 1 "qcm" à réponses multiples en RJ et exactement 1 "qcs" en RJ. Un lot d'une autre taille garde ces proportions au plus près : la composition exacte de chaque lot est rappelée dans sa consigne.`;

const EXAM_OUTPUT_FORMAT = `Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après — les 5 options de chaque question sont toujours A, B, C, D et E, dans cet ordre :
{"questions": [{"format": "qcs", "polarity": "rj", "vignette": "... (RJ)", "options": [{"label": "A", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "C", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "D", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "E", "text": "...", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, {"format": "qcm", "polarity": "rf", "vignette": "... (RF)", "options": [{"label": "A", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "C", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "D", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "E", "text": "...", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, {"format": "combinaison", "polarity": "rj", "vignette": "Parmi les propositions suivantes, quelle(s) est(sont) celle(s) qui ... (RJ) :", "propositions": [{"text": "...", "isTrue": false, "explanation": "..."}, {"text": "...", "isTrue": true, "explanation": "..."}, {"text": "...", "isTrue": false, "explanation": "..."}, {"text": "...", "isTrue": true, "explanation": "..."}, {"text": "...", "isTrue": true, "explanation": "..."}], "options": [{"label": "A", "text": "1+3", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "1+2+4", "isCorrect": false, "explanation": "..."}, {"label": "C", "text": "2+4+5", "isCorrect": true, "explanation": "..."}, {"label": "D", "text": "3+4+5", "isCorrect": false, "explanation": "..."}, {"label": "E", "text": "1+2", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, ...]}`;

/**
 * The exam's JSON shape: EXAM_OUTPUT_FORMAT with each question's
 * « Commentaire » ("commentaire", a structured mini-cours, optional in
 * ExamQuestionSchema). Derived, not copied, so the two shapes can never drift
 * apart. Both the canonical and the style-adapted prompt ask for it.
 */
const EXAM_COMMENTAIRE_EXAMPLE = String.raw`"commentaire": "Notion testée, en une phrase.\n1- ...\n2- ...\n- ..."`;
const EXAM_OUTPUT_FORMAT_CANONICAL = EXAM_OUTPUT_FORMAT.split(`"weakPointTag": "..."`).join(`"weakPointTag": "...", ${EXAM_COMMENTAIRE_EXAMPLE}`);

/** The Studio's rules for type K, RF, multi-answer QCM and QCS, in the exam's three formats. `lead`: the style-guided exam's precedence note, or "". */
function examMatricesRules(lead: string): string {
  return `MATRICES ET REPLIS (précisions sur ces formats)${lead} :
- En "combinaison" (la matrice des examens algériens), chaque proposition est soit un vrai point d'ancrage, soit un piège de l'ADN ci-dessus ; deux combinaisons ne diffèrent parfois que d'une proposition, pour obliger l'étudiant à trancher sur celle dont il est le moins sûr ; aucune combinaison n'associe deux propositions contradictoires ; varie leur composition d'une question à l'autre et rends parfois juste celle qui réunit les cinq propositions.
- En RF, la négation de la consigne est écrite en MAJUSCULES (« … est FAUSSE », « … SAUF une ») ; en "qcs" RF, quatre propositions vraies et UNE SEULE fausse, subtilement.
- En "qcm", 2 à 4 propositions à cocher, chacune vraie ou fausse indépendamment des autres ; fais varier leur nombre d'une question à l'autre.
- En "qcs", une seule réponse : la MEILLEURE selon le critère de l'énoncé. En "qcs" RJ, l'option E peut être un repli absolu : « Toutes les propositions sont fausses » ou « Aucune proposition n'est exacte » — tantôt la réponse à cocher (les quatre autres sont alors toutes fausses), tantôt un piège (l'une des quatre autres est la réponse). « Toutes les propositions sont justes » n'est jamais la réponse à cocher. Aucun repli absolu en "qcm", en RF ni en "combinaison".
- Le texte des énoncés, des options et des propositions est du texte brut sur une seule ligne : aucun retour à la ligne, aucune liste, aucun formatage markdown. Répartis les réponses à cocher sur toutes les lettres — aucun motif prévisible.`;
}

/** Studio QCM « INTERDIT », in the exam's format names. `fallbackRule`: the line on absolute fallbacks (the style-guided exam defers to the professor's conventions). */
function examForbidden(fallbackRule: string): string {
  return `INTERDIT (rejeté d'office) :
- Une question de pure récitation : phrase recopiée du cours, définition brute, date, nom propre. Un chiffre ou un seuil n'est acceptable qu'avec sa condition d'application, entouré de valeurs voisines tirées du cours, ou s'il faut en tirer une conclusion.
- ${fallbackRule}
- Un énoncé qui donne la réponse ou qui nomme la maladie d'une question diagnostique.
- Des distracteurs absurdes, hors sujet ou faux au premier coup d'œil.
- Deux questions du lot qui testent la même notion.`;
}

const EXAM_FALLBACK_FORBIDDEN = `« Toutes les propositions sont justes » comme réponse à cocher, ou un repli absolu hors d'un "qcs" RJ.`;

/** Studio QCM « LA CORRECTION », in the exam's fields: "commentaire", each option's and each proposition's "explanation". */
const EXAM_CORRECTION_RULES = `LA CORRECTION (le cœur pédagogique) :
- "commentaire" (pour CHAQUE question) : le COMMENTAIRE du professeur, un mini-cours structuré, jamais une phrase paresseuse. Sa première ligne énonce en une phrase la notion que la question teste (pour un cas clinique : le diagnostic et les indices qui le trahissaient ; pour une RF : la réponse attendue était la proposition fausse). Puis, à la ligne, 4 à 7 lignes courtes commençant chacune par « - » ou par une numérotation « 1- », « 2- », « 3- », qui reprennent ce que la question mobilise : la physiopathologie (avec des flèches « → » pour les enchaînements de cause à conséquence), les critères diagnostiques avec leurs seuils exacts, unités et conditions, les règles thérapeutiques (1ère intention, contre-indications, surveillance, escalade). Pour une "combinaison", il donne la règle qui départage les propositions (la correction affiche déjà la valeur de chacune). De 60 à 130 mots ; les lignes sont séparées par des retours à la ligne (\\n dans le JSON) ; aucun markdown (ni astérisques, ni titres).
- "explanation" de CHAQUE option : commence par « Vrai. » ou « Faux. », puis une phrase (30 mots maximum) qui dit pourquoi et nomme le piège (« Piège : seuil exact, mais sans symptômes il faut deux mesures. »). En RF, l'explication de chaque option à cocher commence par « Faux — c'est une proposition à cocher. ». Pour une "combinaison", « Vrai. » ou « Faux. » porte sur la combinaison et nomme la proposition qui la rend fausse. Ne fais jamais référence à une autre option par sa lettre.
- "explanation" de chaque proposition d'une "combinaison" : une phrase (30 mots maximum) qui dit pourquoi elle est exacte ou inexacte et nomme le piège — sans « Vrai. » ni « Faux. » en tête (la correction affiche déjà « Exacte » ou « Inexacte »).
- Le commentaire porte le cours : l'explication d'une option ne le répète pas.`;

/** Studio QCM « FIDÉLITÉ AU COURS », for several courses. */
const EXAM_FIDELITY = `FIDÉLITÉ AU COURS : chaque fait affirmé (dans l'énoncé, les options, les propositions, les explications et le commentaire) doit être conforme au texte des cours fournis. Le raisonnement peut aller au-delà de la formulation du cours, jamais au-delà de son contenu : n'invente aucune donnée, valeur, seuil, dose, classification ou recommandation absente des textes, et ne remplace jamais une affirmation du cours par ta connaissance générale. Si la zone ou le cours ne contient ni seuil, ni mécanisme, ni prise en charge, construis tes pièges sur ce qu'il contient réellement.`;

/** Rules of both exams: the source texts, the weak-point tag, the spread over the courses. */
const EXAM_GROUND_RULES = `RÈGLES DE FOND :
- Reste strictement basé sur le contenu des cours fournis ci-dessous — n'invente jamais une information absente de ces textes.
- "weakPointTag" : un tag court et précis identifiant la notion testée (ex: "Critères de Light — Transudat vs Exsudat"), pour permettre un repérage des points faibles après correction.
- Répartis les questions de ce lot de façon équilibrée entre tous les cours fournis — ne concentre pas le lot sur un seul cours si plusieurs sont fournis.`;

/** The anti-hallucination rule on explanations and commentaries, read last before answering. */
const EXAM_RIGOR_RULE = `RIGUEUR ABSOLUE SUR LES EXPLICATIONS ET LE COMMENTAIRE (piège fréquent, lu-ceci-avant-de-répondre) : chaque explication d'option et chaque commentaire doivent se baser UNIQUEMENT sur les faits, conventions, classifications, seuils et libellés EXACTS du texte source fourni ci-dessous — même si ta propre connaissance médicale générale suggère une convention différente (par exemple une classification voie aérobie/anaérobie, un mécanisme précis de liaison protéique, une valeur seuil) qui ne correspond pas exactement à ce que dit le texte source. N'introduis JAMAIS un fait, un mécanisme ou une convention venant de ta connaissance générale à la place de ce que dit précisément le texte source, même si tu es certain que ta version est correcte en médecine générale — le texte source fait autorité ici, pas tes connaissances externes. Si le texte source ne précise pas un détail, ne le complète pas avec une connaissance externe : formule plus généralement plutôt que d'ajouter une affirmation non vérifiable dans le texte fourni. Relis chaque explication et chaque commentaire une dernière fois avant de répondre et demande-toi : "cette affirmation précise est-elle vraiment dans le texte source, ou est-ce que je la complète avec ce que je sais par ailleurs ?" — si c'est la seconde option, reformule.`;

/** The Studio's « Tu génères UN LOT … » line, for an exam built lot by lot. */
const EXAM_LOT_LINE = `Tu génères UN LOT de questions à la fois : l'examen complet de « Semaine Bloquée » de tes étudiants est construit lot par lot, exactement comme ton Examen QCM. Le message de l'utilisateur te donne le nombre exact de questions et leur composition, la ZONE DU COURS sur laquelle ce lot se concentre (quand il y en a une) et l'accent du lot.`;

/** Where the professor's silent reading looks: the lot's zone, else the courses given. */
const EXAM_READING_WHERE = "dans la zone du lot (sans zone : dans les cours fournis)";

const EXAM_PERSONA_AND_STYLE = `${STUDIO_QCM_PERSONA}

${EXAM_LOT_LINE}

${studioQcmReading(EXAM_READING_WHERE)}

${STUDIO_QCM_NATURE}

${studioQcmTraps("les cours fournis")}

LE CAS CLINIQUE (${STUDIO_QCM_CLINICAL_SCOPE}) :
${STUDIO_QCM_CLINICAL_RULES}

${EXAM_LOT_COMPOSITION}

${EXAM_FORMATS_RULES}

${examMatricesRules("")}

${studioQcmFairness("des cours fournis")}

${examForbidden(EXAM_FALLBACK_FORBIDDEN)}

${EXAM_CORRECTION_RULES}

${EXAM_FIDELITY}

${EXAM_GROUND_RULES}

${EXAM_RIGOR_RULE}

${EXAM_OUTPUT_FORMAT_CANONICAL}`;

/**
 * Only applied when `variation: true` — the exact verbatim instruction
 * specified for this feature. Not cacheable, not deduplicated: every
 * regeneration is a genuine new paid call by design, since the whole point
 * is a DIFFERENT exam from the one already saved.
 */
const VARIATION_INSTRUCTION = `CRITICAL: This is a REGENERATION. You must create COMPLETELY NEW clinical scenarios. Focus on atypical presentations, rare complications, severe diagnostic traps, and complex differential diagnoses. DO NOT repeat standard questions from previous exams.`;

/** Keeps the lot's composition at the exact point where regeneration is discussed — novelty never changes the lot's make-up. */
const VARIATION_COMPOSITION_REMINDER = `Cette exigence de nouveauté s'applique à TOUTES les questions de ce lot : chaque question doit tester un piège ou un mécanisme différent de l'examen précédent. La composition du lot indiquée ci-dessus (formats et polarités) et la part de vignettes cliniques de la méthode restent strictement obligatoires même en régénération.`;

/**
 * The STATIC half of the exam prompt — the method + the course content itself —
 * byte-identical across every job of one exam over the same courses. The
 * per-lot instruction (buildExamLotInstruction) goes in the user message.
 */
export function buildExamStaticSystemPrompt(courses: ExamCourseInput[]): string {
  return `${EXAM_PERSONA_AND_STYLE}\n\nCours à couvrir :\n\n${formatCoursesBlock(courses)}`;
}

/** How one lot is aimed — the Studio batch's zone and accent. */
export interface ExamLotFocus {
  /** The lot's zone of its single course (lib/ai/studio-qcm-focus.ts splitIntoFocusZones), or null: the lot covers its course(s) whole. */
  zone?: string | null;
  /** Index of the lot's accent among the Studio's six (any integer, wraps around). */
  accent: number;
  /** 1-based position of the lot among the exam's lots, and their number, when known. */
  lot?: [number, number];
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * The lot's composition, from its format tally (lib/exam-formats.ts): the
 * Studio's batch — combinations in RJ, ONE "qcs" in RF per five questions,
 * the multi-answer "qcm" and the other "qcs" in RJ. `followStyle`: a
 * style-guided exam, where the professor's own distribution (style profile)
 * takes precedence over this default.
 */
function describeComposition(count: number, formats: FormatCounts | undefined, followStyle: boolean): string {
  if (!formats) return "";
  const rf = formats.qcs > 0 && count >= 3 ? Math.min(formats.qcs, Math.max(1, Math.round(count / 5))) : 0;
  const parts = [
    formats.combinaison > 0 ? `${plural(formats.combinaison, 'question "combinaison"', 'questions "combinaison"')} en RJ (combinaison de type K)` : "",
    rf > 0 ? `${plural(rf, 'question "qcs"', 'questions "qcs"')} en RF` : "",
    formats.qcm > 0 ? `${plural(formats.qcm, 'question "qcm"', 'questions "qcm"')} à réponses multiples en RJ` : "",
    formats.qcs - rf > 0 ? `${plural(formats.qcs - rf, 'question "qcs"', 'questions "qcs"')} en RJ` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts[0];
  return followStyle
    ? `COMPOSITION DE CE LOT, PAR DÉFAUT : ${list}. Si le profil de style de l'examen de référence décrit une autre répartition entre QCS, QCM et questions à combinaisons (ou entre RJ et RF), suis plutôt celle du profil, pour le même nombre total de questions.`
    : `COMPOSITION DE CE LOT : exactement ${list} — aucune autre.`;
}

/** A lot without a zone: its course (or courses) whole, under the lot's accent — the Studio's text for a batch without zone, for one or several courses. */
const WHOLE_COURSES_BLOCK =
  "Couvre le ou les cours fournis en entier, en choisissant leurs notions centrales sous l'angle de l'accent ci-dessous — les autres lots, avec d'autres accents, testent d'autres notions sous d'autres angles, donc ne te contente pas de l'angle le plus évident.";

/**
 * The per-lot instruction (user message) — the Studio batch's own: the exact
 * number of questions, the composition, the focus zone (or the whole
 * course(s)) and the accent; then, for the sequential one-shot route, the
 * notions earlier lots of this exam already tested, and the regeneration
 * demand. Clinical vignettes are not counted here: the method's own rule
 * (at least 2 per lot of 5 on a clinical course) applies, as in the Studio.
 */
export function buildExamLotInstruction(
  count: number,
  formats: FormatCounts | undefined,
  focus: ExamLotFocus,
  options: { isVariation: boolean; previousTopics?: string[]; followStyle?: boolean }
): string {
  const header = focus.lot
    ? `LOT ${focus.lot[0]} sur ${focus.lot[1]} — génère EXACTEMENT ${count} questions, ni plus ni moins.`
    : `CE LOT — génère EXACTEMENT ${count} questions, ni plus ni moins.`;
  const composition = describeComposition(count, formats, Boolean(options.followStyle));
  const aim = focus.zone ? zoneBlock(focus.zone, count) : WHOLE_COURSES_BLOCK;
  const topics = options.previousTopics ?? [];
  const topicsBlock =
    topics.length > 0
      ? `\n\nNotions déjà testées dans les lots précédents de CET EXAMEN — ne les reteste PAS, choisis d'autres notions/pièges dans les mêmes cours : ${topics.join(", ")}.`
      : "";
  const variationBlock = options.isVariation ? `\n\n${VARIATION_INSTRUCTION}\n\n${VARIATION_COMPOSITION_REMINDER}` : "";
  return `${header}${composition ? `\n\n${composition}` : ""}\n\n${aim}\n\n${accentLine(focus.accent)}${topicsBlock}${variationBlock}`;
}

/**
 * Appended to the user turn of a MULTI-course job of the client-orchestrated
 * run (app/api/exam/run) whose questions feed a shared bank — the canonical
 * exam and sealed reference-exam (archetype) runs, never an unsealed one:
 * each question names the course it is written from, so it can be filed
 * under that course (lib/exam-question-bank.ts verifies every claim before
 * filing). ExamQuestionSchema drops the field — a stored exam never carries it.
 * Numbers match formatCoursesBlock's « --- Cours N : ... --- » headers.
 */
export function buildExamSourceAttributionInstruction(courseCount: number): string {
  return `ATTRIBUTION OBLIGATOIRE : chaque question porte sur UN SEUL des ${courseCount} cours fournis. Ajoute à chaque question le champ "sourceCourse" : le numéro de ce cours (de 1 à ${courseCount}), tel qu'indiqué dans « --- Cours N : ... --- ».`;
}

/**
 * Vision system prompt for app/api/exam/analyze-reference/route.ts — the
 * ONLY call site. Extracts the "ADN de style" of a student-uploaded
 * reference exam (old partiel, correction type) so it can later be cloned
 * onto a brand-new exam covering different courses. Deliberately asks for
 * the FORM only (question types, trap patterns, format conventions,
 * register), never the reference exam's own medical content — the style
 * profile is folded into buildExamStyleAdaptedSystemPrompt below as plain
 * prompt text, matching ExamStyleProfileSchema (lib/ai/exam-schemas.ts)
 * field-for-field.
 */
export const EXAM_STYLE_EXTRACTION_SYSTEM_PROMPT = `Tu es un expert en analyse pédagogique d'examens médicaux universitaires. On te fournit un examen de référence (ancien partiel, série de QCM, ou correction type) rédigé par un professeur de médecine. Analyse-le en détail et extrais son "ADN de style" précis, pour qu'un autre examen puisse être généré en clonant fidèlement sa structure et son esprit — PAS son contenu médical exact (les nouvelles questions porteront sur d'autres cours), mais sa FORME : types de questions, style des pièges, conventions de formulation.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après :
{"questionTypeDistribution": "description précise de la répartition observée des formats de questions — QCS (une seule réponse, RJ ou RF), QCM à réponses multiples (RJ ou RF), questions à combinaisons numérotées (propositions 1 à 5, réponses du type A(1+3)), QROC — ainsi qu'entre questions directes et cas cliniques longs, en pourcentages approximatifs si possible", "trapPatterns": ["piège observé 1, avec un exemple concret cité du document si possible", "piège observé 2"], "optionFormatConventions": "conventions de formatage des propositions observées (nombre d'options, présence d'options du type 'Toutes ces réponses sont exactes', combinaisons 'A et C', etc.)", "difficultyAndVocabulary": "niveau de difficulté et registre de vocabulaire médical/chirurgical typique observé", "summary": "résumé en une phrase courte et lisible pour l'étudiant (ex: '78% QCM directs, pièges sémantiques fréquents, niveau exigeant')"}

Base-toi UNIQUEMENT sur ce que tu observes réellement dans le document fourni — ne généralise jamais à partir d'un examen type générique que tu connaîtrais par ailleurs. Si le document ne ressemble pas à un examen médical (pages illisibles, contenu hors sujet), renvoie quand même le JSON demandé en décrivant honnêtement ce que tu peux observer.`;

/** The (fixed, non-file) user turn accompanying the reference-exam attachment — kept as its own export so the route doesn't inline a magic string. */
export const EXAM_STYLE_EXTRACTION_USER_TEXT = "Voici l'examen de référence à analyser. Extrais son profil de style au format JSON demandé.";

/**
 * Same task as EXAM_STYLE_EXTRACTION_USER_TEXT when the reference exam
 * arrives as TEXT (a PDF's own text layer, or a scanned PDF read by OCR)
 * instead of as an attachment — the document is inlined, and the model is
 * told its layout may have been flattened by the extraction. `isSample`:
 * only the first pages are included (a professor's style shows there).
 */
export function buildExamStyleExtractionTextMessage(examText: string, isSample: boolean): string {
  return `Voici le texte de l'examen de référence à analyser${isSample ? " (ses premières pages, suffisantes pour en dégager le style)" : ""}, extrait du document fourni par l'étudiant. La mise en page d'origine (colonnes, cases à cocher, numérotation) a pu être aplatie par l'extraction : reconstitue la structure des questions et des propositions à partir du texte.
"""
${examText}
"""

Extrais son profil de style au format JSON demandé.`;
}

/**
 * Style-adapted replacement for buildExamStaticSystemPrompt, used ONLY when
 * a student attached a reference exam (app/api/exam/run, and the sequential
 * app/api/exam/generate). The SAME Studio method as the canonical exam — the
 * same imported blocks — applied INSIDE the professor's own style: their
 * distribution of question types, their traps and their option conventions
 * come first. Same JSON as the canonical exam (with "commentaire").
 */
export function buildExamStyleAdaptedSystemPrompt(courses: ExamCourseInput[], styleProfile: ExamStyleProfile): string {
  return `${STUDIO_QCM_PERSONA}

${EXAM_LOT_LINE}

MISSION PRIORITAIRE — CLONAGE DE STYLE : un étudiant a fourni un examen de référence rédigé par SON PROPRE PROFESSEUR. Tu dois cloner FIDÈLEMENT la structure et l'esprit de cet examen de référence — PAS son contenu médical (les nouvelles questions portent sur les cours ci-dessous, pas sur le sujet de l'examen de référence), mais sa FORME EXACTE. Ce profil de style prime sur toute description générique de style par défaut :
- Répartition des types de questions : ${styleProfile.questionTypeDistribution}
- Pièges à reproduire : ${styleProfile.trapPatterns.join(" ; ")}
- Conventions de formatage des options : ${styleProfile.optionFormatConventions}
- Niveau de difficulté et vocabulaire : ${styleProfile.difficultyAndVocabulary}

LA MÉTHODE DU JURY — elle s'applique à chaque question, DANS le style de ce professeur : sa répartition des questions, ses pièges et ses conventions priment chaque fois qu'ils en disposent autrement.

${studioQcmReading(EXAM_READING_WHERE)}

${STUDIO_QCM_NATURE}

${studioQcmTraps("les cours fournis")}
Avec cet examen de référence, les pièges de ce professeur passent en premier ; ces sept familles servent ensuite à varier le lot.

LE CAS CLINIQUE (leur part suit le profil de style ci-dessus ; à défaut, ${STUDIO_QCM_CLINICAL_SCOPE}) :
${STUDIO_QCM_CLINICAL_RULES}

${EXAM_LOT_COMPOSITION} Avec cet examen de référence, cette composition est une composition par défaut : si le profil de style ci-dessus décrit une répartition différente entre QCS, QCM et questions à combinaisons (ou entre RJ et RF), applique plutôt celle du profil, dans les mêmes formats JSON.

${EXAM_FORMATS_RULES}

${examMatricesRules(" — les conventions de formatage de ce professeur priment quand elles en disposent autrement")}

${studioQcmFairness("des cours fournis")}

${examForbidden(`« Toutes les propositions sont justes » comme réponse à cocher, ou un repli absolu hors d'un "qcs" RJ — sauf si les conventions de ce professeur l'utilisent.`)}

${EXAM_CORRECTION_RULES}

${EXAM_FIDELITY}

${EXAM_GROUND_RULES}

${EXAM_RIGOR_RULE}

${EXAM_OUTPUT_FORMAT_CANONICAL}

Cours à couvrir :

${formatCoursesBlock(courses)}`;
}
