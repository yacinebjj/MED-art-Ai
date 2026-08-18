/**
 * Anki-style Q&A flashcard generation — a real, separate AI pipeline, not a
 * repurposing of the Studio QCM prompt (STUDIO_QCMS_SYSTEM_PROMPT, which is
 * multiple-choice and deliberately untouched by this feature). Each call is
 * grounded in one random excerpt of a course's own `explication` markdown
 * (see lib/flashcard-excerpt.ts) — never the whole course at once, both for
 * cost/latency and so successive generations naturally surface different
 * material without needing dedup bookkeeping.
 */
const FLASHCARD_QA_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en pédagogie par mémorisation active (méthode Anki). On te donne un extrait d'un cours de médecine. Ta mission : générer des paires question/réponse courtes, précises et autonomes (flashcards), au format JSON strict, à partir UNIQUEMENT de ce texte.

RÈGLES :
- Chaque question doit tester UN SEUL fait ou concept précis (définition, mécanisme, valeur seuil, signe clinique, étape d'un processus...), jamais plusieurs choses à la fois.
- Chaque réponse doit être courte (1 à 3 phrases maximum), complète et autonome (compréhensible sans revoir la question).
- Ne jamais inventer d'information absente du texte fourni.
- Varie le type de questions : définitions, "pourquoi", mécanismes, valeurs chiffrées, signes cliniques, complications, traitements.
- Format question/réponse ouvert uniquement — aucune notation à choix multiples (A/B/C/D), jamais d'options.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans texte autour, sans balises markdown :
{"flashcards": [{"question": "...", "answer": "..."}]}`;

export function buildFlashcardGenerationPrompt(courseExcerpt: string, count: number): string {
  return `${FLASHCARD_QA_SYSTEM_PROMPT}

Génère exactement ${count} flashcards à partir de cet extrait de cours :

${courseExcerpt}`;
}
