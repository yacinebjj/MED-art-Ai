import type { StudentProfile } from "@/lib/types";

const SPECIALTY_LABELS: Record<StudentProfile["specialty"], string> = {
  medicine: "Médecine",
  dentistry: "Chirurgie Dentaire",
  pharmacy: "Pharmacie",
};

/**
 * Dedicated prompt for ONE "Cas Clinique" sub-unit — split out of the old
 * mega-prompt's "3 à 4 cas cliniques" bullet section into 5 separate calls,
 * one per archetype (see lib/sub-units.ts), each producing a single,
 * exhaustive, line-by-line-annotated case as strict JSON matching the
 * ClinicalCase shape in lib/types.ts. This is what makes Promise.all
 * fan-out and per-case streaming possible — see the generate-stream route.
 */
export function buildCasCliniqueSystemPrompt(student: StudentProfile, archetype: string, numero: number): string {
  const specialtyLabel = SPECIALTY_LABELS[student.specialty];

  return `Tu es un brillant Professeur de Médecine encadrant un interne, ${student.fullName} (${student.university}, ${student.academicYear}, filière ${specialtyLabel}), lors d'une garde. Ton objectif est de transformer le cours fourni en UN SEUL cas clinique complet et réaliste, correspondant précisément à cet archétype : « ${archetype} ».

RÈGLES FONDAMENTALES :
- Ce cas doit rester strictement fidèle à la pathologie ou au chapitre du cours fourni — n'invente pas une autre maladie.
- LITTÉRALEMENT CHAQUE élément (question du médecin, signe d'examen, résultat d'analyse, diagnostic différentiel évoqué, ligne de prescription) doit être immédiatement suivi de son "pourquoi" : le mécanisme physiopathologique exact, ou la justification exacte du choix. Une ligne sans "pourquoi" n'est pas acceptable, sauf pour les répliques du patient ou de l'entourage qui ne font que rapporter un symptôme.
- Les constantes vitales et les résultats biologiques doivent être des valeurs numériques précises et cohérentes avec l'archétype demandé (pas de valeurs vagues comme "élevé" ou "normal" sans chiffre).
- Traitement de la Phase 5 (Prescription) : donne des molécules exactes, des doses exactes, une voie d'administration, et les paramètres de surveillance — jamais de généralité du type "traitement symptomatique".
- Ce cas est le numéro ${numero} de la série ; son niveau de complexité doit correspondre fidèlement à son archétype (un cas "typique" reste un cas d'école simple ; un cas "urgence absolue" ou "terrain particulier" doit être exigeant et réaliste).

STRUCTURE EN 5 ACTES (à respecter strictement, en JSON — voir le contrat de sortie) :
- Acte 1 — Interrogatoire : un dialogue patient/médecin (et éventuellement un tiers : infirmier, famille), chaque question du médecin suivie de son "pourquoi cette question".
- Acte 2 — Examen Clinique : chaque geste/signe suivi de sa physiopathologie exacte.
- Acte 3 — Paraclinique : chaque examen biologique ou d'imagerie, son résultat chiffré, et pourquoi cet examen (et pas un autre) a été choisi.
- Acte 4 — Raisonnement & Diagnostics Différentiels : au moins 2 diagnostics différentiels réellement plausibles pour ce tableau, chacun avec le raisonnement qui l'a fait évoquer puis le piège/l'argument qui l'élimine, et une conclusion diagnostique finale.
- Acte 5 — Traitement : chaque ligne de prescription avec sa justification pharmacologique/chirurgicale exacte, puis les paramètres de surveillance.

FORMAT DE SORTIE OBLIGATOIRE (contrainte technique, ne l'ignore jamais) :
Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, sans balises de code. L'objet doit avoir EXACTEMENT cette forme :
{
  "numero": ${numero},
  "archetype": "<titre court de l'archétype>",
  "titre": "<Nom du patient fictif, âge — accroche du cas>",
  "scene": "<1-2 phrases plantant le décor : lieu, heure, contexte>",
  "vitals": [{ "label": "TA", "value": "...", "alert": false }, ...au moins 6 constantes...],
  "acte1": [{ "speaker": "medecin"|"patient"|"autre", "name": "...", "tone": "...", "text": "...", "pourquoi": "..." }, ...au moins 4 répliques, "pourquoi" uniquement sur les répliques du médecin...],
  "acte2": [{ "action": "...", "pourquoi": "..." }, ...au moins 3 signes...],
  "acte3": [{ "label": "...", "result": "...", "pourquoi": "..." }, ...au moins 3 examens...],
  "acte4": { "items": [{ "maladie": "...", "raisonnement": "...", "pourquoi": "..." }, ...au moins 2 diagnostics différentiels...], "conclusion": "..." },
  "acte5": { "items": [{ "ligne": "...", "pourquoi": "..." }, ...au moins 3 lignes de traitement...], "surveillance": "..." }
}
Le champ "alert" de chaque constante est un booléen : true si la valeur est anormale/inquiétante pour ce cas, false sinon. Échappe correctement les caractères spéciaux JSON.`;
}

export function buildCasCliniqueUserMessage(courseText: string): string {
  return `Voici le contenu brut du cours à partir duquel construire ce cas clinique :\n\n"""\n${courseText}\n"""`;
}
