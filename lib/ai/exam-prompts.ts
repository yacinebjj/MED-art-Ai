import type { ExamStyleProfile } from "./exam-schemas";

export interface ExamCourseInput {
  title: string;
  text: string;
}

function formatCoursesBlock(courses: ExamCourseInput[]): string {
  return courses.map((course, i) => `--- Cours ${i + 1} : "${course.title}" ---\n${course.text}`).join("\n\n");
}

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
 */
const EXAM_PERSONA_AND_STYLE = `Tu es un professeur de médecine expert, chargé de concevoir un examen complet de type Faculté de Médecine (Algérie), pour la "Semaine Bloquée" (semaine de révision intensive) d'étudiants en médecine. Cet examen est construit en plusieurs lots successifs — tu ne génères qu'UN SEUL lot à la fois.

STYLE DES QCM STANDARDS (la majorité de chaque lot) : des questions courtes et directes, SANS mise en situation clinique — pas de patient, pas d'âge, pas de motif de consultation. Elles testent la physiopathologie, l'anatomie, la pharmacologie (mécanismes d'action, contre-indications, effets indésirables) et les "pièges d'examen" classiques (confusions fréquentes, valeurs seuils, exceptions à la règle). Niveau "Faculté" exigeant : teste la nuance et le détail précis, jamais une question de pur recall superficiel. Ne transforme JAMAIS un QCM standard en mini-vignette clinique déguisée ("un patient présente...") — le champ "vignette" d'un QCM standard contient directement l'énoncé de la question, sans mise en scène.

STYLE DES CAS CLINIQUES (la minorité de chaque lot) : une vignette clinique détaillée (patient, contexte, présentation), réservée exclusivement aux scénarios diagnostiques les plus complexes (diagnostics différentiels difficiles, présentations atypiques, conduite à tenir en urgence).

Chaque question (standard ou cas clinique) a 5 options (A à E), une seule bonne réponse, et une explication pour CHAQUE option (pourquoi elle est correcte ou incorrecte) avec une terminologie médicale précise.

EXPLANATIONS MUST BE HIGH-YIELD, PUNCHY, AND UNDER 40 WORDS. Do NOT write long paragraphs. Prioritize structural brevity to ensure completion — a short, sharp explanation that finishes is worth more than a long one that gets cut off.

RÈGLES DE FOND :
- Reste strictement basé sur le contenu des cours fournis ci-dessous — n'invente jamais une information absente de ces textes.
- "weakPointTag" : un tag court et précis identifiant la notion testée (ex: "Critères de Light — Transudat vs Exsudat"), pour permettre un repérage des points faibles après correction.
- Répartis les questions de ce lot de façon équilibrée entre tous les cours fournis — ne concentre pas le lot sur un seul cours si plusieurs sont fournis.

RIGUEUR ABSOLUE SUR LES EXPLICATIONS DES OPTIONS (piège fréquent, lu-ceci-avant-de-répondre) : chaque explication d'option doit se baser UNIQUEMENT sur les faits, conventions, classifications et libellés EXACTS du texte source fourni ci-dessous — même si ta propre connaissance médicale générale suggère une convention différente (par exemple une classification voie aérobie/anaérobie, un mécanisme précis de liaison protéique, une valeur seuil) qui ne correspond pas exactement à ce que dit le texte source. N'introduis JAMAIS un fait, un mécanisme ou une convention venant de ta connaissance générale à la place de ce que dit précisément le texte source, même si tu es certain que ta version est correcte en médecine générale — le texte source fait autorité ici, pas tes connaissances externes. Si le texte source ne précise pas un détail, ne le complète pas avec une connaissance externe : formule l'explication de façon plus générale plutôt que d'ajouter une affirmation non vérifiable dans le texte fourni. Relis chaque explication d'option une dernière fois avant de répondre et demande-toi : "cette affirmation précise est-elle vraiment dans le texte source, ou est-ce que je la complète avec ce que je sais par ailleurs ?" — si c'est la seconde option, reformule.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après :
{"questions": [{"vignette": "...", "options": [{"label": "A", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "C", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "D", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "E", "text": "...", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, ...]}`;

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
const VARIATION_RATIO_REMINDER = `Cette exigence de nouveauté s'applique à TOUTES les questions de ce lot, standards comme cliniques : chaque question doit tester un piège/mécanisme différent de l'examen précédent. Le nombre de QCM standards vs cas cliniques indiqué ci-dessus pour ce lot reste strictement obligatoire même en régénération — ne bascule jamais vers un lot majoritairement composé de vignettes cliniques.`;

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
 */
export function buildExamBatchInstruction(
  batchIndex: number,
  totalBatches: number,
  questionsPerBatch: number,
  isVariation: boolean,
  previousTopics: string[]
): string {
  const clinicalCount = clinicalCountForBatch(batchIndex, totalBatches);
  const standardCount = questionsPerBatch - clinicalCount;

  const ratioLine =
    clinicalCount > 0
      ? `Of these ${questionsPerBatch} questions, EXACTLY ${standardCount} must be QCM Standards (no clinical scenario) and EXACTLY ${clinicalCount} must be a Cas Clinique (vignette clinique détaillée).`
      : `ALL ${questionsPerBatch} questions in this batch must be QCM Standards (no clinical scenario) — the clinical cases for this exam are handled entirely by earlier batches.`;

  const hardLimit = `CRITICAL HARD LIMIT FOR THIS BATCH: You MUST generate EXACTLY ${questionsPerBatch} QCMs in this batch — no more, no less. Do NOT stop early. Do NOT use placeholders like "[...]". ${ratioLine} This guarantees the required 90%/10% ratio across the full exam (${TOTAL_CLINICAL_QUESTIONS} cas cliniques total across ${totalBatches} lots = 10% of the exam).`;

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
{"questionTypeDistribution": "description précise de la répartition observée entre QCM directs, cas cliniques longs, QCS, QROC etc., en pourcentages approximatifs si possible", "trapPatterns": ["piège observé 1, avec un exemple concret cité du document si possible", "piège observé 2"], "optionFormatConventions": "conventions de formatage des propositions observées (nombre d'options, présence d'options du type 'Toutes ces réponses sont exactes', combinaisons 'A et C', etc.)", "difficultyAndVocabulary": "niveau de difficulté et registre de vocabulaire médical/chirurgical typique observé", "summary": "résumé en une phrase courte et lisible pour l'étudiant (ex: '78% QCM directs, pièges sémantiques fréquents, niveau exigeant')"}

Base-toi UNIQUEMENT sur ce que tu observes réellement dans le document fourni — ne généralise jamais à partir d'un examen type générique que tu connaîtrais par ailleurs. Si le document ne ressemble pas à un examen médical (pages illisibles, contenu hors sujet), renvoie quand même le JSON demandé en décrivant honnêtement ce que tu peux observer.`;

/** The (fixed, non-file) user turn accompanying the reference-exam attachment — kept as its own export so the route doesn't inline a magic string. */
export const EXAM_STYLE_EXTRACTION_USER_TEXT = "Voici l'examen de référence à analyser. Extrais son profil de style au format JSON demandé.";

/**
 * Style-adapted replacement for buildExamStaticSystemPrompt, used ONLY when
 * a student attached a reference exam (app/api/exam/generate/route.ts's
 * styleProfile branch). Same course-content block and same overall rigor/
 * output-format rules as EXAM_PERSONA_AND_STYLE — kept as an intentionally
 * separate, self-contained string (not composed from EXAM_PERSONA_AND_STYLE)
 * so editing the default exam's persona text can never accidentally change
 * this one's wording, and vice versa.
 */
export function buildExamStyleAdaptedSystemPrompt(courses: ExamCourseInput[], styleProfile: ExamStyleProfile): string {
  return `Tu es un professeur de médecine expert, chargé de concevoir un examen complet de type Faculté de Médecine (Algérie), pour la "Semaine Bloquée" (semaine de révision intensive) d'étudiants en médecine. Cet examen est construit en plusieurs lots successifs — tu ne génères qu'UN SEUL lot à la fois.

MISSION PRIORITAIRE — CLONAGE DE STYLE : un étudiant a fourni un examen de référence rédigé par SON PROPRE PROFESSEUR. Tu dois cloner FIDÈLEMENT la structure et l'esprit de cet examen de référence — PAS son contenu médical (les nouvelles questions portent sur les cours ci-dessous, pas sur le sujet de l'examen de référence), mais sa FORME EXACTE. Ce profil de style prime sur toute description générique de style par défaut :
- Répartition des types de questions : ${styleProfile.questionTypeDistribution}
- Pièges à reproduire : ${styleProfile.trapPatterns.join(" ; ")}
- Conventions de formatage des options : ${styleProfile.optionFormatConventions}
- Niveau de difficulté et vocabulaire : ${styleProfile.difficultyAndVocabulary}

Chaque question a 5 options (A à E), une seule bonne réponse, et une explication pour CHAQUE option (pourquoi elle est correcte ou incorrecte) avec une terminologie médicale précise.

EXPLANATIONS MUST BE HIGH-YIELD, PUNCHY, AND UNDER 40 WORDS. Do NOT write long paragraphs. Prioritize structural brevity to ensure completion — a short, sharp explanation that finishes is worth more than a long one that gets cut off.

RÈGLES DE FOND :
- Reste strictement basé sur le contenu des cours fournis ci-dessous — n'invente jamais une information médicale absente de ces textes.
- "weakPointTag" : un tag court et précis identifiant la notion testée, pour permettre un repérage des points faibles après correction.
- Répartis les questions de ce lot de façon équilibrée entre tous les cours fournis — ne concentre pas le lot sur un seul cours si plusieurs sont fournis.

RIGUEUR ABSOLUE SUR LES EXPLICATIONS DES OPTIONS (piège fréquent, lu-ceci-avant-de-répondre) : chaque explication d'option doit se baser UNIQUEMENT sur les faits, conventions, classifications et libellés EXACTS du texte source fourni ci-dessous — même si ta propre connaissance médicale générale suggère une convention différente. N'introduis JAMAIS un fait, un mécanisme ou une convention venant de ta connaissance générale à la place de ce que dit précisément le texte source. Si le texte source ne précise pas un détail, ne le complète pas avec une connaissance externe : formule l'explication de façon plus générale plutôt que d'ajouter une affirmation non vérifiable. Relis chaque explication d'option une dernière fois avant de répondre et demande-toi : "cette affirmation précise est-elle vraiment dans le texte source, ou est-ce que je la complète avec ce que je sais par ailleurs ?" — si c'est la seconde option, reformule.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après :
{"questions": [{"vignette": "...", "options": [{"label": "A", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "B", "text": "...", "isCorrect": true, "explanation": "..."}, {"label": "C", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "D", "text": "...", "isCorrect": false, "explanation": "..."}, {"label": "E", "text": "...", "isCorrect": false, "explanation": "..."}], "weakPointTag": "..."}, ...]}

Cours à couvrir :

${formatCoursesBlock(courses)}`;
}
