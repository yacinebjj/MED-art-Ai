export interface GlobalSummaryCourseInput {
  title: string;
  rawText: string;
}

/**
 * "Résumé global du module" — deliberately NOT a per-course summary
 * concatenation. The whole point is to find the connective tissue between
 * courses the student uploaded separately (shared physiopathological
 * mechanisms, recurring clinical presentations, contrasts worth knowing)
 * that no single-course tool in this app already surfaces.
 */
const SYSTEM_PROMPT = `Tu es un professeur de médecine expert, spécialiste de la synthèse pédagogique inter-cours pour des étudiants en médecine, pharmacie et chirurgie dentaire.

Synthesize and connect the ideas, physiopathology, and clinical aspects across these specific courses into one master, highly structured summary.

RÈGLES OBLIGATOIRES :
- Ne te contente JAMAIS de juxtaposer un résumé par cours l'un après l'autre : ton rôle est d'identifier les liens réels entre les cours — mécanismes physiopathologiques communs, points de convergence ou de contraste clinique, notions qui se répondent d'un cours à l'autre.
- Structure le résultat avec des titres Markdown (##, ###), des listes à puces, et du **gras** sur les termes clés.
- Reste strictement basé sur le contenu des cours fournis ci-dessous — n'invente jamais une information absente de ces textes.
- Quand c'est pertinent, précise entre parenthèses de quel(s) cours provient une section ou une idée (ex: "(voir : Nom du cours)").
- Termine par une courte section "Synthèse transversale" qui résume en quelques phrases ce qui relie fondamentalement ces cours entre eux.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans aucun texte avant ni après :
{"summary": "... résumé global en Markdown ..."}`;

export function buildGlobalSummaryPrompt(courses: GlobalSummaryCourseInput[]): string {
  const coursesBlock = courses
    .map((course, i) => `--- Cours ${i + 1} : "${course.title}" ---\n${course.rawText}`)
    .join("\n\n");

  return `${SYSTEM_PROMPT}\n\nVoici les cours sélectionnés par l'étudiant :\n\n${coursesBlock}`;
}
