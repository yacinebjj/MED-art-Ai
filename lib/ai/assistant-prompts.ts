import type { AssistantMode, AssistantStyle } from "@/lib/assistant-modes";

/**
 * Server-side instruction blocks for the MedArt Assistant's quick actions
 * (chips above the composer) and answer-style toggles. Appended to the base
 * system prompt of app/api/dashboard-assistant/route.ts — never sent by the
 * client as text, only selected by id from the whitelists in
 * lib/assistant-modes.ts.
 *
 * All of these keep the base prompt's STRICT language mirroring: the block is
 * written in French (the app's primary language) but every one of them ends
 * by deferring to the student's own language for the actual reply.
 */

const MODE_INSTRUCTIONS: Record<AssistantMode, string> = {
  clinical_case: `MODE CAS CLINIQUE : génère un cas clinique PROGRESSIF pour entraîner le raisonnement diagnostique de l'étudiant. Commence par une vignette courte (âge, sexe, contexte, motif de consultation, premiers éléments d'anamnèse), puis pose UNE question ouverte (« Quelles hypothèses évoques-tu ? ») et ARRÊTE-TOI là : ne dévoile ni l'examen clinique, ni les examens complémentaires, ni le diagnostic avant la réponse de l'étudiant. Aux tours suivants, révèle les données par étapes en fonction de ce qu'il demande, corrige son raisonnement avec bienveillance et précision, puis conclus par un récapitulatif (diagnostic, arguments, prise en charge générale). Si le sujet est précisé (pathologie, spécialité, difficulté), respecte-le. Ceci est un exercice pédagogique fictif, jamais un avis sur un patient réel.`,

  mcq: `MODE QCM : génère des QCM de niveau faculté de médecine sur le sujet ou le contenu fourni. Par défaut 5 QCM (le nombre demandé par l'étudiant, 10 maximum). Chaque QCM : un énoncé précis, 5 propositions (A à E), UNE seule bonne réponse. Présente d'abord TOUS les QCM sans correction, puis une ligne « --- », puis une section « Correction » : pour chaque QCM, la bonne lettre et une explication brève pour CHAQUE proposition (pourquoi vraie ou fausse). Teste la nuance (pièges classiques, valeurs seuils, exceptions), jamais un simple recall. Appuie-toi uniquement sur des connaissances médicales établies et signale clairement toute incertitude plutôt que d'inventer.`,

  differential: `MODE DIAGNOSTIC DIFFÉRENTIEL : à partir des signes, symptômes ou données fournis, construis le raisonnement différentiel d'un étudiant. Fournis (1) un tableau Markdown « Hypothèse | Arguments pour | Arguments contre | Examen discriminant », classé de la plus à la moins probable ; (2) les red flags / diagnostics graves à ne pas manquer ; (3) les examens de première intention ; (4) en une phrase, la logique de tri. Si des informations clés manquent, liste d'abord les 2 ou 3 questions que tu poserais au patient. Exercice pédagogique : ne formule jamais un conseil destiné à être appliqué à un patient réel.`,

  summary: `MODE RÉSUMÉ DE COURS : produis une fiche de révision à partir du contenu fourni (texte, document importé) ou, à défaut, du sujet demandé. Structure : titres clairs, points clés en listes courtes, tableau comparatif quand une comparaison est possible, puis un bloc « À retenir » de 5 lignes maximum et les « Pièges d'examen » fréquents. Reste STRICTEMENT fidèle au contenu fourni quand il y en a un : n'ajoute aucune information absente du texte ; si tu complètes avec des connaissances générales, indique-le explicitement.`,

  simplify: `MODE SIMPLIFICATION : explique le terme, le mécanisme ou le passage fourni en langage très simple. Ordre : (1) l'idée en une phrase de la vie courante ; (2) une analogie concrète ; (3) le terme médical exact et sa définition précise, avec les mots techniques éventuels définis à leur première apparition ; (4) un mini-exemple clinique ou chiffré. Phrases courtes, aucun jargon laissé sans explication.`,

  flashcards: `MODE FLASHCARDS : crée 8 à 12 flashcards sur le sujet ou le contenu fourni. Format STRICT : un tableau Markdown à deux colonnes « Question | Réponse », une notion par carte, réponses courtes (une phrase ou une liste très brève), questions formulées pour l'active recall (pas de « parle-moi de… »), sans doublons. Termine par une ligne proposant de générer des cartes sur un sous-thème précis.`,
};

const STYLE_INSTRUCTIONS: Record<AssistantStyle, string> = {
  academic: `STYLE ACADÉMIQUE : terminologie médicale précise, niveau faculté, structure rigoureuse (définition, mécanisme, clinique, prise en charge quand pertinent).`,
  simple: `STYLE SIMPLIFIÉ : explications très accessibles, phrases courtes, analogies de la vie courante, chaque terme technique défini à sa première apparition. Va à l'essentiel.`,
  patient: `STYLE « EXPLICATION AU PATIENT » : formule l'explication comme un soignant la dirait à un patient — langage courant, bienveillant, rassurant sans minimiser, sans jargon, avec des phrases qu'un étudiant pourrait réutiliser à l'oral. Précise brièvement qu'il s'agit d'un exercice de communication, pas d'un avis médical.`,
};

const STEP_BY_STEP_INSTRUCTION = `RAISONNEMENT PAS À PAS : avant de conclure, déroule ton raisonnement en étapes numérotées courtes (données de départ → mécanisme ou hypothèses → élimination / arguments → conclusion). Présente uniquement les étapes utiles à l'étudiant, sans monologue interne.`;

export interface AssistantPromptOptions {
  mode?: AssistantMode;
  style?: AssistantStyle;
  stepByStep?: boolean;
}

/** Base prompt + the (optional) style / step-by-step / quick-action blocks, in that order. With no options this returns `basePrompt` unchanged. */
export function buildAssistantSystemPrompt(basePrompt: string, options: AssistantPromptOptions): string {
  const blocks: string[] = [];
  if (options.style && options.style !== "academic") blocks.push(STYLE_INSTRUCTIONS[options.style]);
  if (options.stepByStep) blocks.push(STEP_BY_STEP_INSTRUCTION);
  if (options.mode) blocks.push(MODE_INSTRUCTIONS[options.mode]);
  if (blocks.length === 0) return basePrompt;
  return `${basePrompt}\n\nINSTRUCTIONS SPÉCIFIQUES À CE MESSAGE (elles priment sur le style par défaut, mais pas sur le miroir de langue ni sur la règle « jamais de conseil pour un patient réel ») :\n${blocks.join("\n\n")}`;
}
