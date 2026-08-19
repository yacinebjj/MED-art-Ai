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

/**
 * "Definitive set" architecture — replaces the random-excerpt sampling
 * above for cross-student cached flashcards (see
 * lib/flashcards-content-cache.ts and app/api/flashcards/generate/route.ts).
 * Deliberately NOT the same prompt with a bigger excerpt: this asks for
 * EXHAUSTIVE, DEDUPLICATED coverage of the whole explication in one shot,
 * since the result is now generated ONCE ever per course and reused by
 * every student who studies it — a random-sample instruction would produce
 * a worse, less representative deck for everyone downstream of the first
 * student, not just a differently-sampled one.
 */
const DEFINITIVE_FLASHCARD_SET_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en pédagogie par mémorisation active (méthode Anki). On te donne le texte COMPLET de l'explication d'un cours de médecine. Ta mission : produire l'ensemble DÉFINITIF et exhaustif de flashcards question/réponse pour CE COURS ENTIER, au format JSON strict.

RÈGLES :
- Couvre l'ENSEMBLE du cours, pas un extrait ni un échantillon — chaque notion clé (définition, mécanisme, valeur seuil, signe clinique, complication, traitement, étape d'un processus...) mérite au moins une flashcard.
- Ne répète JAMAIS deux fois la même information sous deux formulations différentes — chaque flashcard doit tester un fait distinct.
- Chaque question doit tester UN SEUL fait ou concept précis, jamais plusieurs choses à la fois.
- Chaque réponse doit être courte (1 à 3 phrases maximum), complète et autonome (compréhensible sans revoir la question).
- Ne jamais inventer d'information absente du texte fourni.
- Varie le type de questions : définitions, "pourquoi", mécanismes, valeurs chiffrées, signes cliniques, complications, traitements.
- Format question/réponse ouvert uniquement — aucune notation à choix multiples (A/B/C/D), jamais d'options.
- Cet ensemble sera réutilisé tel quel par des centaines d'autres étudiants étudiant le même cours — il doit être la meilleure référence possible, pas un tirage parmi d'autres.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans texte autour, sans balises markdown :
{"flashcards": [{"question": "...", "answer": "..."}]}`;

export function buildDefinitiveFlashcardSetPrompt(fullExplicationText: string, minCount: number, maxCount: number): string {
  return `${DEFINITIVE_FLASHCARD_SET_SYSTEM_PROMPT}

Génère entre ${minCount} et ${maxCount} flashcards couvrant l'intégralité de ce cours :

${fullExplicationText}`;
}
