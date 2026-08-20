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
 * Builds ONE batch's system prompt. `questionsPerBatch`/`totalBatches` come
 * from the route (the single source of truth for the batching shape) rather
 * than being duplicated as constants here, so the two files can't drift out
 * of sync. `previousTopics` carries forward every weakPointTag already
 * produced by earlier batches in this same exam (sequential calls, not
 * parallel — see the route's own comment) so later batches can honor the
 * "logical flow and topic distribution" instruction for real, by explicitly
 * avoiding re-testing the exact same notion, rather than independently
 * guessing at non-overlap.
 */
export function buildExamBatchPrompt(
  courses: ExamCourseInput[],
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

  return `${EXAM_PERSONA_AND_STYLE}\n\n${hardLimit}\n\n${batchInstruction}${topicsBlock}${variationBlock}\n\nCours à couvrir :\n\n${formatCoursesBlock(courses)}`;
}
