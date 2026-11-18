import type { ExamStyleProfile } from "./exam-schemas";
import { EXAM_FORMATS, type ExamFormat, type FormatCounts } from "@/lib/exam-formats";

export interface ExamCourseInput {
  title: string;
  text: string;
}

function formatCoursesBlock(courses: ExamCourseInput[]): string {
  return courses.map((course, i) => `--- Cours ${i + 1} : "${course.title}" ---\n${course.text}`).join("\n\n");
}

/**
 * The three question formats (lib/exam-formats.ts), described ONCE and shared
 * by the default and the style-adapted prompts, so both always ask for the
 * same JSON that ExamQuestionSchema (lib/ai/exam-schemas.ts) validates. The
 * worked example places each correct answer away from "A" on purpose.
 */
const EXAM_FORMATS_RULES = `LES TROIS FORMATS DE QUESTIONS (comme aux examens des facultés de médecine algériennes) — chaque question indique son "format" et sa "polarity" :
1. "qcs" (QCS, choix simple) : 5 propositions A à E, UNE SEULE réponse à cocher. "polarity" : "rj" (la seule proposition exacte) ou "rf" (la seule proposition inexacte). L'énoncé se termine par « (RJ) » ou « (RF) ». Exactement UNE option a "isCorrect": true — celle à cocher (pour une RF, c'est la proposition fausse).
2. "qcm" (QCM, choix multiples) : 5 propositions A à E, PLUSIEURS réponses à cocher (2 à 4, jamais 1 ni 5). "polarity" : "rj" (cocher toutes les propositions exactes) ou "rf" (cocher toutes les propositions inexactes). L'énoncé se termine par « (RJ) » ou « (RF) ». Entre 2 et 4 options ont "isCorrect": true — exactement celles à cocher.
3. "combinaison" (propositions numérotées) : l'énoncé ("vignette") se termine par « (RJ) : » ou « (RF) : » et NE contient PAS les propositions. Le champ "propositions" contient EXACTEMENT 5 propositions, numérotées 1 à 5 dans l'ordre, chacune avec "isTrue" (exacte ou non) et une "explanation". Les 5 options A à E ont pour "text" une combinaison de numéros écrite uniquement avec des chiffres de 1 à 5 et des « + » (ex : "1+3", "1+2+4", "2+4+5", "3+4+5", "1+2"), toutes différentes. Exactement UNE option a "isCorrect": true : celle dont la combinaison contient TOUTES et SEULEMENT les propositions exactes (RJ) ou inexactes (RF) ; les 4 autres sont des pièges plausibles (une proposition en trop ou en moins). L'"explanation" de chaque option dit pourquoi la combinaison est juste, ou quelle proposition la rend fausse.

Dans chaque format, une explication pour CHAQUE option (pourquoi elle est juste ou fausse), avec une terminologie médicale précise. Varie la polarité (environ une question sur quatre en RF, les autres en RJ) et la position des bonnes réponses. Avant de répondre, vérifie chaque question à combinaisons : la combinaison marquée juste contient-elle exactement les propositions à cocher ?`;

const EXAM_OUTPUT_FORMAT = `Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après — les 5 options de chaque question sont toujours A, B, C, D et E, dans cet ordre :
{"questions": [{"format": "qcs", "polarity": "rj", "vignette": "... (RJ)", "options": [{"label": "A", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "C", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "D", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "E", "text": "...", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, {"format": "qcm", "polarity": "rf", "vignette": "... (RF)", "options": [{"label": "A", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "C", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "D", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "E", "text": "...", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, {"format": "combinaison", "polarity": "rj", "vignette": "Parmi les propositions suivantes, quelle(s) est(sont) celle(s) qui ... (RJ) :", "propositions": [{"text": "...", "isTrue": false, "explanation": "..."}, {"text": "...", "isTrue": true, "explanation": "..."}, {"text": "...", "isTrue": false, "explanation": "..."}, {"text": "...", "isTrue": true, "explanation": "..."}, {"text": "...", "isTrue": true, "explanation": "..."}], "options": [{"label": "A", "text": "1+3", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "1+2+4", "isCorrect": false, "explanation": "..."}, {"label": "C", "text": "2+4+5", "isCorrect": true, "explanation": "..."}, {"label": "D", "text": "3+4+5", "isCorrect": false, "explanation": "..."}, {"label": "E", "text": "1+2", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, ...]}`;

/**
 * The exam's JSON shape: EXAM_OUTPUT_FORMAT with each question's
 * « Commentaire » ("commentaire", a structured mini-cours, optional in
 * ExamQuestionSchema). Derived, not copied, so the two shapes can never drift
 * apart. Both the canonical and (since 2026-11-19) the style-adapted prompt
 * ask for it.
 */
const EXAM_COMMENTAIRE_EXAMPLE = String.raw`"commentaire": "Notion testée, en une phrase.\n1- ...\n2- ...\n- ..."`;
const EXAM_OUTPUT_FORMAT_CANONICAL = EXAM_OUTPUT_FORMAT.split(`"weakPointTag": "..."`).join(`"weakPointTag": "...", ${EXAM_COMMENTAIRE_EXAMPLE}`);

/**
 * SEQUENTIAL BATCHING ARCHITECTURE (app/api/exam/generate/route.ts): the
 * 40-question exam is built from several sequential calls of a few questions
 * each (currently 5 batches of 8 — see route.ts's TOTAL_BATCHES/
 * QUESTIONS_PER_BATCH, the single source of truth passed in below) rather
 * than one shot. This persona/style block is shared by every batch and
 * deliberately doesn't hardcode the batch count/size — the per-batch hard
 * limit, ratio split, and verbatim "Batch X of N" instruction are appended
 * separately per call by `buildExamBatchPrompt`, since those numbers are the
 * part most likely to be tuned again.
 *
 * 2026-11-17 (explicit product order): the canonical exam got the "annales
 * DNA" of the Studio QCM (seven named traps, clinical cases in chronological
 * escalation, combination matrices and the « Toutes les propositions sont
 * fausses » fallback, a per-question "commentaire" mini-cours).
 *
 * 2026-11-19 (explicit product order: the Module exam must be built EXACTLY
 * like the Studio's « Examen QCM », lib/ai/studio-prompts.ts): the method is
 * now the Studio QCM prompt's own, block for block — the professor's silent
 * reading of the course, the nature of the course, the seven traps with the
 * same examples, the clinical-case rules, the matrices, the demands and
 * fairness, the forbidden list, the correction (« Vrai. » / « Faux. » + the
 * trap named, ≤ 30 words; the commentaire mini-cours) and the fidelity rule —
 * adapted only to the exam's JSON (formats "qcs" / "qcm" / "combinaison",
 * propositions labelled « Exacte / Inexacte » by the correction screen). The
 * blocks below are SHARED by the canonical prompt and the style-adapted one
 * (a reference exam): both exams get the same method; the style-adapted
 * prompt keeps the professor's own distribution, traps and conventions on
 * top of it.
 */

/** The professor's silent reading of the courses: the raw material of the traps (Studio QCM « LECTURE DU PROFESSEUR »). */
const EXAM_PROFESSOR_READING = `LECTURE DU PROFESSEUR (silencieuse — rien de cette analyse n'apparaît dans ta réponse) : avant d'écrire, relève dans les cours fournis la matière première de tes pièges :
- chaque seuil chiffré AVEC sa condition d'application : unité, à jeun ou non, nombre de mesures, présence ou absence de symptômes, terrain, délai ;
- chaque mécanisme avec son SENS : ce qui stimule ou inhibe, augmente ou diminue, sécrète ou réabsorbe, et à quel niveau ;
- les affirmations du cours qui portent un absolu (« toujours », « jamais », « en premier ») et celles qui n'en portent pas ;
- les complications de la maladie d'un côté, les effets indésirables de ses traitements de l'autre ;
- les examens et traitements indiqués, inutiles ou contre-indiqués selon le terrain (enfant, femme enceinte, sujet âgé, insuffisant rénal ou hépatique) ;
- la séquence de la prise en charge : 1ère intention, surveillance, objectifs, échec, escalade — avec ses doses et ses délais ;
- les formules, scores et classifications qui se calculent ou se dénombrent, quand le cours les donne.
Un détail anecdotique n'est jamais une question.`;

/** Clinical vs basic-science courses (Studio QCM « NATURE DU COURS », with the exam's per-batch number of clinical cases). */
const EXAM_COURSE_NATURE = `NATURE DU COURS : pour un cours CLINIQUE (pathologie, sémiologie, thérapeutique), les cas cliniques demandés pour le lot sont de vrais dossiers de patients. Pour un cours de SCIENCES FONDAMENTALES (anatomie, histologie, embryologie, physiologie, biochimie, biophysique, génétique…), transpose la même exigence — valeurs normales et seuils, mécanismes et régulations, rapports anatomiques, exceptions et confusions classiques, situations physiologiques ou expérimentales à interpréter — et un « cas clinique » demandé devient une situation physiologique ou expérimentale à interpréter, jamais un cas clinique plaqué artificiellement.`;

/** The seven traps, with the Studio QCM's own examples. `lead`: how the traps apply (the canonical exam's rule, or the style-guided exam's). */
function examTrapDna(lead: string): string {
  return `L'ADN DES PIÈGES — ${lead} :
1. Conditionnalité : le seuil est EXACT, c'est sa condition qui est faussée — avec ou sans symptômes, à jeun ou post-prandial, une mesure ou deux, adulte ou femme enceinte, régime normosodé ou désodé, avant ou après traitement. Ex. : « Une glycémie aléatoire ≥ 2 g/L, même sans symptômes, suffit au diagnostic. » Le chiffre ne trahit rien : l'étudiant doit savoir dans quelle condition il s'applique.
2. Inversion physiopathologique : une phrase exacte dont UN SEUL mécanisme est retourné — inhibe ou stimule, augmente ou diminue, hyper ou hypo, haute ou basse, T3 ou T4, freinable ou non freinable. Ex. : « L'insuline stimule la néoglucogenèse hépatique. » Tout le reste de la phrase est rigoureusement juste.
3. Modificateurs absolus : « toujours », « jamais », « exclusivement », « uniquement », « seul », « constant », « systématique », « d'emblée » rendent fausse une notion vraie (« Le diabète de type 2 est exclusivement dû à une insulinorésistance »). Mais l'absolu est parfois VRAI quand le cours l'affirme (« L'hydrocortisone est toujours introduite avant la lévothyroxine ») : l'étudiant ne doit jamais pouvoir éliminer par réflexe.
4. Maladie ou iatrogénie : mêle les complications de la maladie et celles de son traitement (acidose lactique sous biguanide ou acidocétose, hypoglycémie sous sulfamide, prise de poids sous insuline), ou demande lesquelles relèvent du traitement.
5. Fausse piste plausible : un examen ou un traitement logique pour la spécialité mais inutile ou contre-indiqué dans CE cas précis (dosage systématique du peptide C dans un diabète de type 2 typique, antithyroïdiens de synthèse dans une thyroïdite subaiguë, bicarbonates systématiques dans une acidocétose). À l'inverse, une proposition qui ressemble à une fausse piste peut être juste quand le cours la recommande.
6. Escalade chronologique (cas clinique) : la vignette raconte la prise en charge initiale puis l'évolution (« Trois mois plus tard, sous metformine 850 mg deux fois par jour et règles hygiéno-diététiques bien suivies, l'HbA1c est à 7,9 % ») et demande l'étape suivante. Distracteurs : l'étape prématurée, l'étape dépassée, la bonne molécule à la mauvaise dose ou au mauvais moment, l'arrêt du mauvais traitement, l'option contre-indiquée sur ce terrain.
7. Calcul ou valeur trompeuse : quand le cours donne la formule ou la classification, fais calculer ou dénombrer (IMC à partir du poids et de la taille, nombre de facteurs de risque, objectif adapté au profil du patient) ; ou donne une valeur dans les normes mais inappropriée dans ce contexte (PTH normale malgré une hypercalcémie).
Ces exemples illustrent une mécanique : n'en reprends jamais le contenu, sauf s'il figure dans les cours fournis.`;
}

/** How a clinical case is written (Studio QCM « LE CAS CLINIQUE »). `count`: where the number of cases comes from. */
function examClinicalCaseRules(count: string): string {
  return `LE CAS CLINIQUE (${count}) :
- La vignette tient en 3 à 6 phrases (100 mots maximum, 130 pour une escalade chronologique) : le patient (« Monsieur B., 59 ans », « Mme S., 69 ans »), son terrain et ses antécédents, son traitement en cours avec les doses, le mode de début et la chronologie, l'examen avec les constantes (et le poids, la taille ou le tour de taille quand ils servent), les résultats bruts chiffrés avec leurs unités.
- De préférence en ESCALADE CHRONOLOGIQUE quand le cours décrit une prise en charge : la prise en charge initiale, puis l'évolution (« Trois mois plus tard, sous… »), et l'étape suivante à décider.
- Question diagnostique : ne nomme JAMAIS la maladie à trouver — décris les signes et donne les valeurs sans les interpréter. Question de prise en charge : la maladie connue du patient peut être nommée, jamais la réponse.
- Glisse UN élément trompeur et, quand c'est utile, un élément négatif qui écarte un diagnostic voisin. Contexte algérien réaliste quand il sert le raisonnement, sans jamais inventer de donnée épidémiologique.
- Chaque question est autonome : tout ce qu'il faut pour répondre est dans sa propre vignette.`;
}

/** The answer-matrix rules (Studio QCM « FORMATS », in the exam's three formats). `lead`: the style-guided exam's precedence note, or "". */
function examMatricesRules(lead: string): string {
  return `MATRICES ET REPLIS (précisions sur ces formats)${lead} :
- En "combinaison" (la matrice des examens algériens), chaque proposition est soit un vrai point d'ancrage, soit un piège de l'ADN ci-dessus ; deux combinaisons ne diffèrent parfois que d'une proposition, pour obliger l'étudiant à trancher sur celle dont il est le moins sûr ; aucune combinaison n'associe deux propositions contradictoires ; varie leur composition d'une question à l'autre et rends parfois juste celle qui réunit les cinq propositions.
- En RF, la négation de la consigne est écrite en MAJUSCULES (« … est FAUSSE », « … SAUF une ») ; en "qcs" RF, quatre propositions vraies et UNE SEULE fausse, subtilement.
- En "qcm", 2 à 4 propositions à cocher, chacune vraie ou fausse indépendamment des autres ; fais varier leur nombre d'une question à l'autre.
- En "qcs", une seule réponse : la MEILLEURE selon le critère de l'énoncé. En "qcs" RJ, l'option E peut être un repli absolu : « Toutes les propositions sont fausses » ou « Aucune proposition n'est exacte » — tantôt la réponse à cocher (les quatre autres sont alors toutes fausses), tantôt un piège (l'une des quatre autres est la réponse). « Toutes les propositions sont justes » n'est jamais la réponse à cocher. Aucun repli absolu en "qcm", en RF ni en "combinaison".
- Le texte des énoncés, des options et des propositions est du texte brut sur une seule ligne : aucun retour à la ligne, aucune liste, aucun formatage markdown. Répartis les réponses à cocher sur toutes les lettres — aucun motif prévisible.`;
}

/** Studio QCM « EXIGENCE ET ÉQUITÉ » — the exam's jobs are 5 questions at most. */
const EXAM_FAIRNESS_RULES = `EXIGENCE ET ÉQUITÉ :
- Dans un lot de 5 questions : 1 question classique (notion centrale, distracteurs voisins), 3 questions discriminantes (application, interprétation, intégration, cas clinique) et 1 question redoutable (format exigeant + piège) — toutes justes ; dans un lot plus court, garde ces proportions au plus près.
- Chaque question est entièrement résoluble à partir des cours fournis, avec une seule clé de réponse défendable : aucune ambiguïté qu'un étudiant brillant pourrait contester.
- La difficulté teste la médecine, jamais la lecture : pas de double négation dans une même proposition, et la négation d'une consigne RF est toujours en MAJUSCULES.`;

/** Studio QCM « INTERDIT ». `fallbackRule`: the line on absolute fallbacks (the style-guided exam defers to the professor's conventions). */
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
const EXAM_FIDELITY = `FIDÉLITÉ AU COURS : chaque fait affirmé (dans l'énoncé, les options, les propositions, les explications et le commentaire) doit être conforme au texte des cours fournis. Le raisonnement peut aller au-delà de la formulation du cours, jamais au-delà de son contenu : n'invente aucune donnée, valeur, seuil, dose, classification ou recommandation absente des textes, et ne remplace jamais une affirmation du cours par ta connaissance générale. Si un cours ne contient ni seuil, ni mécanisme, ni prise en charge, construis tes pièges sur ce qu'il contient réellement.`;

/** Rules of both exams: the source texts, the weak-point tag, the spread over the courses. */
const EXAM_GROUND_RULES = `RÈGLES DE FOND :
- Reste strictement basé sur le contenu des cours fournis ci-dessous — n'invente jamais une information absente de ces textes.
- "weakPointTag" : un tag court et précis identifiant la notion testée (ex: "Critères de Light — Transudat vs Exsudat"), pour permettre un repérage des points faibles après correction.
- Répartis les questions de ce lot de façon équilibrée entre tous les cours fournis — ne concentre pas le lot sur un seul cours si plusieurs sont fournis.`;

/** The anti-hallucination rule on explanations and commentaries, read last before answering. */
const EXAM_RIGOR_RULE = `RIGUEUR ABSOLUE SUR LES EXPLICATIONS ET LE COMMENTAIRE (piège fréquent, lu-ceci-avant-de-répondre) : chaque explication d'option et chaque commentaire doivent se baser UNIQUEMENT sur les faits, conventions, classifications, seuils et libellés EXACTS du texte source fourni ci-dessous — même si ta propre connaissance médicale générale suggère une convention différente (par exemple une classification voie aérobie/anaérobie, un mécanisme précis de liaison protéique, une valeur seuil) qui ne correspond pas exactement à ce que dit le texte source. N'introduis JAMAIS un fait, un mécanisme ou une convention venant de ta connaissance générale à la place de ce que dit précisément le texte source, même si tu es certain que ta version est correcte en médecine générale — le texte source fait autorité ici, pas tes connaissances externes. Si le texte source ne précise pas un détail, ne le complète pas avec une connaissance externe : formule plus généralement plutôt que d'ajouter une affirmation non vérifiable dans le texte fourni. Relis chaque explication et chaque commentaire une dernière fois avant de répondre et demande-toi : "cette affirmation précise est-elle vraiment dans le texte source, ou est-ce que je la complète avec ce que je sais par ailleurs ?" — si c'est la seconde option, reformule.`;

/** The jury professor (Studio QCM persona), for a whole exam built batch by batch. */
const EXAM_PROFESSOR_PERSONA = `Tu es Professeur de médecine, chef de service et membre du jury d'examen d'une faculté de médecine algérienne depuis plus de vingt ans. Tu conçois l'examen complet de « Semaine Bloquée » (semaine de révision intensive) de tes étudiants exactement comme les sujets d'EMD et de résidanat que tu conçois depuis des années : des propositions courtes et précises, chacune bâtie autour d'un piège réel, qui récompensent l'étudiant qui a COMPRIS le cours et piègent celui qui l'a survolé ou appris par cœur sans comprendre — toujours justes, jamais ambiguës, jamais hors programme. Cet examen est construit en plusieurs lots successifs — tu ne génères qu'UN SEUL lot à la fois.`;

const EXAM_PERSONA_AND_STYLE = `${EXAM_PROFESSOR_PERSONA}

${EXAM_PROFESSOR_READING}

${EXAM_COURSE_NATURE}

QUESTIONS STANDARDS (la majorité de chaque lot) : courtes et directes, SANS mise en situation clinique — pas de patient, pas d'âge, pas de motif de consultation. Elles testent la physiopathologie, les critères diagnostiques et leurs seuils, la pharmacologie (mécanismes d'action, indications, contre-indications, effets indésirables) et la stratégie thérapeutique. Ne transforme JAMAIS une question standard en mini-vignette clinique déguisée (« un patient présente… ») : le champ "vignette" d'une question standard contient directement l'énoncé de la question.

${examClinicalCaseRules("leur nombre exact est donné avec la consigne du lot")}

${examTrapDna("chaque question repose sur au moins un de ces pièges (deux au plus) ; varie-les dans le lot")}

Questions standards comme cas cliniques peuvent prendre chacun des trois formats ci-dessous.

${EXAM_FORMATS_RULES}

${examMatricesRules("")}

${EXAM_FAIRNESS_RULES}

${examForbidden(EXAM_FALLBACK_FORBIDDEN)}

${EXAM_CORRECTION_RULES}

${EXAM_FIDELITY}

${EXAM_GROUND_RULES}

${EXAM_RIGOR_RULE}

${EXAM_OUTPUT_FORMAT_CANONICAL}`;

/**
 * Total clinical cases across the WHOLE exam — unchanged by the 4×10 -> 5×8
 * batching pivot (still 4/40 = 10%). What changes is how they're spread: 8
 * per batch doesn't divide evenly into a 90/10 split (0.8 clinical/batch
 * isn't an integer), so the 4 cases are front-loaded one-per-batch across
 * the first 4 batches, leaving the 5th batch all-standard. Still lands
 * exactly on 4/40 = 10%, just not perfectly even across every single batch.
 */
const TOTAL_CLINICAL_QUESTIONS = 4;

function clinicalCountForBatch(batchIndex: number, totalBatches: number): number {
  return batchIndex <= TOTAL_CLINICAL_QUESTIONS && batchIndex <= totalBatches ? 1 : 0;
}

/**
 * Only applied when `variation: true` — the exact verbatim instruction
 * specified for this feature. Not cacheable, not deduplicated: every
 * regeneration is a genuine new paid call by design, since the whole point
 * is a DIFFERENT exam from the one already saved.
 */
const VARIATION_INSTRUCTION = `CRITICAL: This is a REGENERATION. You must create COMPLETELY NEW clinical scenarios. Focus on atypical presentations, rare complications, severe diagnostic traps, and complex differential diagnoses. DO NOT repeat standard questions from previous exams.`;

/**
 * Same reasoning as before the batching pivot: VARIATION_INSTRUCTION talks
 * exclusively about "clinical scenarios", which could read as license to
 * abandon the standard/clinical split on a regenerated batch. Keeps the
 * split explicit at the exact point where regeneration is discussed —
 * novelty applies to the standard questions too (different pièges/
 * mécanismes), not just the clinical case(s).
 */
const VARIATION_RATIO_REMINDER = `Cette exigence de nouveauté s'applique à TOUTES les questions de ce lot, standards comme cliniques : chaque question doit tester un piège/mécanisme différent de l'examen précédent. Le nombre de questions standards vs cas cliniques et la répartition des formats indiqués ci-dessus pour ce lot restent strictement obligatoires même en régénération — ne bascule jamais vers un lot majoritairement composé de vignettes cliniques.`;

const FORMAT_NAMES: Record<ExamFormat, [singular: string, plural: string]> = {
  qcs: ['question "qcs"', 'questions "qcs"'],
  qcm: ['question "qcm"', 'questions "qcm"'],
  combinaison: ['question "combinaison"', 'questions "combinaison"'],
};

/**
 * "EXACTEMENT 2 questions "qcs", 2 questions "qcm" et 1 question "combinaison"" — formats with a zero
 * count are left out. `followStyle` (style-guided exam): the same mix, given as the default that the
 * professor's own distribution replaces whenever the style profile describes one.
 */
function describeFormatQuota(formats: FormatCounts, followStyle: boolean): string {
  const parts = EXAM_FORMATS.filter((format) => formats[format] > 0).map((format) => `${formats[format]} ${FORMAT_NAMES[format][formats[format] > 1 ? 1 : 0]}`);
  if (parts.length === 0) return "";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}` : parts[0];
  if (followStyle) {
    return `RÉPARTITION DES FORMATS POUR CE LOT, PAR DÉFAUT : ${list}. Si le profil de style de l'examen de référence décrit une autre répartition entre QCS, QCM et questions à combinaisons, suis plutôt celle du profil, pour le même nombre total de questions.`;
  }
  return `RÉPARTITION DES FORMATS POUR CE LOT : EXACTEMENT ${list}, aucune question d'un autre format.`;
}

/**
 * The STATIC half of the exam prompt — persona/style + the course content
 * itself — byte-identical across all TOTAL_BATCHES calls for one exam (the
 * course inputs never change between batches). Deliberately split out from
 * the per-batch instructions below so the route can send this as its own
 * `cache_control: ephemeral`-marked system block: Anthropic's prompt cache
 * then only charges full price for this (often large — a full course's
 * source text) block on batch 1, and serves batches 2-N a cheap cache read
 * instead of repricing the same course text from scratch every single time.
 * See app/api/exam/generate/route.ts's generateExamBatch for the call site.
 */
export function buildExamStaticSystemPrompt(courses: ExamCourseInput[]): string {
  return `${EXAM_PERSONA_AND_STYLE}\n\nCours à couvrir :\n\n${formatCoursesBlock(courses)}`;
}

/**
 * The DYNAMIC half — everything that legitimately changes from one batch to
 * the next (batch index, the accumulating previousTopics list, the
 * variation flag) — sent as the USER message rather than folded into the
 * cached system prompt, since mixing dynamic content into a cache-marked
 * block would break the exact-prefix match caching depends on.
 * `questionsPerBatch`/`totalBatches` come from the route (the single source
 * of truth for the batching shape) rather than being duplicated as constants
 * here, so the two files can't drift out of sync. `previousTopics` carries
 * forward every weakPointTag already produced by earlier batches in this
 * same exam (sequential calls, not parallel — see the route's own comment)
 * so later batches can honor the "logical flow and topic distribution"
 * instruction for real, by explicitly avoiding re-testing the exact same
 * notion, rather than independently guessing at non-overlap.
 *
 * `formats`: how many questions of each format (lib/exam-formats.ts) this
 * batch must contain — set by the caller from the exam-level mix, so the
 * whole exam combines QCS, QCM and combinations. Omitted: no quota line.
 * `followStyle`: a style-guided exam, where the professor's own distribution
 * (style profile) takes precedence over this default mix.
 * `clinicalCases`: this job's number of clinical cases, set by the caller
 * instead of the sequential route's batch rule (the run's jobs,
 * lib/exam-generation.ts generateExamJob) — exact for the canonical exam, a
 * default under the professor's own share for a style-guided one
 * (`followStyle`). Omitted: the text is byte-identical to what it always was.
 */
export function buildExamBatchInstruction(
  batchIndex: number,
  totalBatches: number,
  questionsPerBatch: number,
  isVariation: boolean,
  previousTopics: string[],
  formats?: FormatCounts,
  followStyle = false,
  clinicalCases?: number
): string {
  const ownCount = clinicalCases !== undefined;
  const clinicalCount = ownCount ? Math.max(0, Math.min(clinicalCases, questionsPerBatch)) : clinicalCountForBatch(batchIndex, totalBatches);
  const standardCount = questionsPerBatch - clinicalCount;

  const styleDefault = ownCount && followStyle;
  const ratioLine = styleDefault
    ? `BY DEFAULT, ${clinicalCount > 0 ? `${standardCount} of these ${questionsPerBatch} questions are standard questions (no clinical scenario) and ${clinicalCount} ${clinicalCount > 1 ? "are Cas Cliniques" : "is a Cas Clinique"} (vignette clinique détaillée)` : `all ${questionsPerBatch} questions are standard questions (no clinical scenario)`} — if the reference exam's style profile describes another share of clinical cases, follow the profile instead, for the same total number of questions.`
    : clinicalCount > 0
      ? `Of these ${questionsPerBatch} questions, EXACTLY ${standardCount} must be standard questions (no clinical scenario) and EXACTLY ${clinicalCount} must be a Cas Clinique (vignette clinique détaillée).`
      : ownCount
        ? `ALL ${questionsPerBatch} questions in this batch must be standard questions (no clinical scenario).`
        : `ALL ${questionsPerBatch} questions in this batch must be standard questions (no clinical scenario) — the clinical cases for this exam are handled entirely by earlier batches.`;
  const ratioGuarantee = ownCount
    ? ""
    : ` This guarantees the required 90%/10% ratio across the full exam (${TOTAL_CLINICAL_QUESTIONS} cas cliniques total across ${totalBatches} lots = 10% of the exam).`;

  const formatQuota = formats ? describeFormatQuota(formats, followStyle) : "";
  const hardLimit = `CRITICAL HARD LIMIT FOR THIS BATCH: You MUST generate EXACTLY ${questionsPerBatch} questions in this batch — no more, no less. Do NOT stop early. Do NOT use placeholders like "[...]". ${ratioLine}${ratioGuarantee}${formatQuota ? `\n\n${formatQuota}` : ""}`;

  // The user's own verbatim instruction template, with X/N and the
  // per-batch question count filled in dynamically.
  const batchInstruction = `Batch ${batchIndex} of ${totalBatches}. Ensure logical flow and topic distribution. Strictly output ONLY the ${questionsPerBatch} requested questions in JSON format.`;

  const topicsBlock =
    previousTopics.length > 0
      ? `\n\nNotions déjà testées dans les lots précédents de CET EXAMEN — ne les reteste PAS, choisis d'autres notions/pièges dans les mêmes cours : ${previousTopics.join(", ")}.`
      : "";

  const variationBlock = isVariation ? `\n\n${VARIATION_INSTRUCTION}\n\n${VARIATION_RATIO_REMINDER}` : "";

  return `${hardLimit}\n\n${batchInstruction}${topicsBlock}${variationBlock}`;
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
 * app/api/exam/generate). Since 2026-11-19 (product order: every Module exam
 * is built like the Studio's « Examen QCM ») it carries the SAME method as
 * the canonical exam — the shared blocks above: the professor's silent
 * reading, the nature of the course, the seven traps, the clinical-case
 * rules, the matrices, demands and fairness, the forbidden list, the
 * correction with its « Commentaire », the fidelity rule — applied INSIDE
 * the professor's own style: their distribution of question types, their
 * traps and their option conventions come first. Same JSON as the canonical
 * exam (with "commentaire").
 */
export function buildExamStyleAdaptedSystemPrompt(courses: ExamCourseInput[], styleProfile: ExamStyleProfile): string {
  return `${EXAM_PROFESSOR_PERSONA}

MISSION PRIORITAIRE — CLONAGE DE STYLE : un étudiant a fourni un examen de référence rédigé par SON PROPRE PROFESSEUR. Tu dois cloner FIDÈLEMENT la structure et l'esprit de cet examen de référence — PAS son contenu médical (les nouvelles questions portent sur les cours ci-dessous, pas sur le sujet de l'examen de référence), mais sa FORME EXACTE. Ce profil de style prime sur toute description générique de style par défaut :
- Répartition des types de questions : ${styleProfile.questionTypeDistribution}
- Pièges à reproduire : ${styleProfile.trapPatterns.join(" ; ")}
- Conventions de formatage des options : ${styleProfile.optionFormatConventions}
- Niveau de difficulté et vocabulaire : ${styleProfile.difficultyAndVocabulary}

LA MÉTHODE DU JURY — elle s'applique à chaque question, DANS le style de ce professeur : sa répartition des questions, ses pièges et ses conventions priment chaque fois qu'ils en disposent autrement.

${EXAM_PROFESSOR_READING}

${EXAM_COURSE_NATURE}

${examClinicalCaseRules("leur part suit le profil de style ci-dessus ; à défaut, celle donnée avec la consigne du lot")}

${examTrapDna("chaque question repose sur au moins un piège (deux au plus) : d'abord ceux de ce professeur, puis ces sept familles pour varier le lot")}

Questions directes comme cas cliniques peuvent prendre chacun des trois formats ci-dessous.

${EXAM_FORMATS_RULES}

La répartition des formats indiquée pour chaque lot est une répartition par défaut : si le profil de style ci-dessus décrit une répartition différente entre QCS, QCM et questions à combinaisons (ou entre RJ et RF), applique plutôt celle du profil, dans les mêmes formats JSON.

${examMatricesRules(" — les conventions de formatage de ce professeur priment quand elles en disposent autrement")}

${EXAM_FAIRNESS_RULES}

${examForbidden(`« Toutes les propositions sont justes » comme réponse à cocher, ou un repli absolu hors d'un "qcs" RJ — sauf si les conventions de ce professeur l'utilisent.`)}

${EXAM_CORRECTION_RULES}

${EXAM_FIDELITY}

${EXAM_GROUND_RULES}

${EXAM_RIGOR_RULE}

${EXAM_OUTPUT_FORMAT_CANONICAL}

Cours à couvrir :

${formatCoursesBlock(courses)}`;
}
