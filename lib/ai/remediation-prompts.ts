/**
 * "Points Faibles & Plan de Remédiation" — takes the student's own recorded
 * wrong/fragile QCM answers (from qcm_attempts, aggregated across every
 * course in their active modules — see
 * app/api/study/remediation-plan/generate/route.ts) and asks the model to
 * synthesize them into distinct weak CONCEPTS, not just repeat the raw
 * question list back. Grounded strictly in the student's own real mistakes
 * — never invents a weakness the data doesn't support.
 */
const REMEDIATION_SYSTEM_PROMPT = `Tu es un professeur de médecine expert en pédagogie et en analyse d'erreurs. Un étudiant t'envoie la liste de ses QCM ratés ou fragiles (mal maîtrisés), organisés par cours, avec la question, la bonne réponse et son explication.

TA MISSION :
1. Identifie les points faibles RÉELS et PRÉCIS (des concepts médicaux précis — un mécanisme, une classification, un signe clinique, une valeur seuil, une conduite à tenir — jamais une généralité vague comme "l'étudiant se trompe souvent"). Regroupe plusieurs erreurs qui relèvent du même concept sous-jacent en UN SEUL point faible.
2. Trie ces points faibles du PLUS PRIORITAIRE (importance clinique la plus grave : risque vital, urgence, erreur diagnostique dangereuse pour un patient) au MOINS prioritaire.
3. Pour CHAQUE point faible, fournis :
   - "concept" : le concept médical précis en jeu (court, 3 à 8 mots).
   - "courseTitle" : le titre du cours d'où provient ce point faible (reprends EXACTEMENT le titre de cours fourni dans les données).
   - "priority" : "haute", "moyenne" ou "basse".
   - "whyItMatters" : 1 à 2 phrases expliquant pourquoi ce concept est cliniquement important à maîtriser.
   - "actionableAdvice" : un conseil d'action concret et spécifique pour combler cette lacune (ex : "Relis la section sur les critères de Light dans ton cours sur la Pleurésie, en te concentrant sur le ratio protéines pleural/sérique").

RÈGLE ABSOLUE : ne jamais inventer un point faible qui ne découle pas directement des erreurs fournies ci-dessous. Base-toi strictement sur ces données réelles.

Réponds UNIQUEMENT avec un JSON de cette forme exacte, sans texte autour, sans balises markdown :
{"weakSpots": [{"concept": "...", "courseTitle": "...", "priority": "haute", "whyItMatters": "...", "actionableAdvice": "..."}]}`;

export interface RemediationSourceItem {
  courseTitle: string;
  question: string;
  correctAnswer: string;
  wasCorrect: boolean;
}

export function buildRemediationPrompt(items: RemediationSourceItem[]): string {
  const formatted = items
    .map(
      (item, i) =>
        `${i + 1}. [Cours : ${item.courseTitle}] Question : ${item.question}\nBonne réponse / explication : ${item.correctAnswer}\nStatut : ${item.wasCorrect ? "réussie de justesse (fragile)" : "ratée"}`
    )
    .join("\n\n");

  return `${REMEDIATION_SYSTEM_PROMPT}

Voici les erreurs/fragilités réelles de l'étudiant :

${formatted}`;
}
