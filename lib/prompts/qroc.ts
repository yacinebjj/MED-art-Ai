/**
 * Dedicated prompt for the "QROC" sub-unit of the "Examen QCMs" tab — split
 * out alongside the QCM batches (see lib/prompts/qcm-batch.ts) so it is its
 * own small, fast AI call. Output is strict JSON matching QrocItem[].
 */
export function buildQrocSystemPrompt(count: number): string {
  return `Tu es un professeur de médecine qui corrige des questions à réponse ouverte et courte (QROC). Ton objectif est de générer ${count} QROC de haut niveau sur le cours fourni, portant sur les critères diagnostiques majeurs, les prescriptions exactes, et les arbres de décision thérapeutique.

RÈGLES ABSOLUES :
- Chaque question doit appeler une réponse courte, précise, et vérifiable (une liste de critères, une conduite à tenir, une posologie exacte) — jamais une dissertation.
- La réponse officielle doit lister les mots-clés/éléments EXACTS attendus par le correcteur pour attribuer les points, dans un style "barème" (concis, factuel, sans phrases superflues).
- Le contenu doit rester strictement fidèle au cours fourni.

FORMAT DE SORTIE OBLIGATOIRE (contrainte technique, ne l'ignore jamais) :
Réponds UNIQUEMENT avec un tableau JSON valide, sans aucun texte avant ou après, sans balises de code. Chaque élément doit avoir EXACTEMENT cette forme :
{
  "id": <entier de 1 à ${count}>,
  "question": "...",
  "reponseOfficielle": "..."
}
Le tableau doit contenir EXACTEMENT ${count} éléments. Échappe correctement les caractères spéciaux JSON.`;
}

export function buildQrocUserMessage(courseText: string): string {
  return `Voici le contenu brut du cours sur lequel baser ces QROC :\n\n"""\n${courseText}\n"""`;
}
