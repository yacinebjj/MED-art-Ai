/**
 * "Definitive set" architecture — cross-student cached flashcards (see
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

FORMAT DE SORTIE — JSON STRICT, OBLIGATOIRE :
- Ta réponse est UNIQUEMENT un objet JSON valide de cette forme exacte : {"flashcards": [{"question": "...", "answer": "..."}]}
- Le premier caractère de ta réponse est "{" et le dernier est "}". Aucun texte avant ou après, aucune balise markdown (pas de \`\`\`json), aucun commentaire.
- Une seule clé racine "flashcards" ; chaque élément a exactement deux clés, "question" et "answer", toutes deux des chaînes non vides.
- Guillemets doubles uniquement ; aucune virgule finale ; les guillemets doubles à l'intérieur d'un texte sont échappés (\\") ; pas de retour à la ligne brut dans une chaîne (utilise \\n si nécessaire).`;

export function buildDefinitiveFlashcardSetPrompt(fullExplicationText: string, minCount: number, maxCount: number): string {
  return `${DEFINITIVE_FLASHCARD_SET_SYSTEM_PROMPT}

Génère entre ${minCount} et ${maxCount} flashcards couvrant l'intégralité de ce cours :

${fullExplicationText}`;
}

/**
 * "Infinite" study flow (app/api/flashcards/generate/route.ts): once every
 * card of a course's cached set has been served to the student, the set is
 * EXTENDED — new cards on the same course, appended to the cross-student
 * cache so the next student gets them for free. The existing questions are
 * passed in so the model targets facts, angles and levels of detail the
 * deck does not test yet, instead of rephrasing it.
 */
const FLASHCARD_EXTENSION_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en mémorisation active (méthode Anki). On te donne le texte d'un cours de médecine ET la liste des flashcards qui existent DÉJÀ pour ce cours. Ta mission : produire de NOUVELLES flashcards question/réponse, au format JSON strict, qui complètent ce jeu sans jamais le répéter.

RÈGLES :
- Chaque nouvelle flashcard doit tester un fait ABSENT de la liste existante : détail plus fin, autre angle (mécanisme, conséquence, comparaison, contre-indication, chiffre, piège classique d'examen, cas d'application clinique), ou une notion du cours encore non couverte.
- Interdiction de reformuler, d'inverser ou de légèrement modifier une question existante.
- Une question = un seul fait précis. Réponse courte (1 à 3 phrases), complète et autonome.
- Ne jamais inventer d'information absente du texte fourni ni d'une connaissance médicale standard et vérifiée.
- Format question/réponse ouvert uniquement — jamais d'options A/B/C/D.

FORMAT DE SORTIE — JSON STRICT, OBLIGATOIRE :
- Ta réponse est UNIQUEMENT un objet JSON valide de cette forme exacte : {"flashcards": [{"question": "...", "answer": "..."}]}
- Le premier caractère de ta réponse est "{" et le dernier est "}". Aucun texte avant ou après, aucune balise markdown (pas de \`\`\`json), aucun commentaire.
- Une seule clé racine "flashcards" ; chaque élément a exactement deux clés, "question" et "answer", toutes deux des chaînes non vides.
- Guillemets doubles uniquement ; aucune virgule finale ; les guillemets doubles à l'intérieur d'un texte sont échappés (\\") ; pas de retour à la ligne brut dans une chaîne (utilise \\n si nécessaire).`;

export function buildFlashcardExtensionPrompt(fullExplicationText: string, existingQuestions: string[], count: number): string {
  return `${FLASHCARD_EXTENSION_SYSTEM_PROMPT}

FLASHCARDS DÉJÀ EXISTANTES (à ne jamais répéter) :
${existingQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")}

Génère exactement ${count} NOUVELLES flashcards pour ce cours :

${fullExplicationText}`;
}
