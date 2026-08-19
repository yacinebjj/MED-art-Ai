export type PlanId = "freemium" | "basic" | "pro" | "max" | "semester" | "annual";

export interface Plan {
  id: PlanId;
  label: string;
  tagline: string;
  priceDZD: number;
  /** Billing cycle length in months — Semester (3) and Annual (12) are paid
   * upfront for the whole period, but courseCap/highlightMessageCap below
   * are still MONTHLY allowances, not banked for the whole period. See
   * lib/subscription.ts's monthly rollover for how that's enforced. */
  durationMonths: number;
  /** Cours (Studio) génération par mois. No plan is unlimited — Max/Semester/Annual all share the same 30/mois ceiling; the difference between them is billing cadence and price, not quota. */
  courseCap: number;
  /** Messages chat "highlight" (Ask MedArt / Translate sur sélection) par mois. */
  highlightMessageCap: number;
  /** Messages chat libres (question ouverte dans l'assistant, hors sélection) par mois — distinct de highlightMessageCap car ce n'est ni la même UI ni le même usage. */
  chatMessageCap: number;
  /** Flashcards générées (cartes, pas appels) par mois — app/api/flashcards/generate génère par lots de 20, clampés à ce qu'il reste de ce quota. */
  flashcardCap: number;
  /** Plans de remédiation des points faibles générés par mois. */
  remediationCap: number;
  features: string[];
}

// One design decision worth flagging explicitly: the business plans were
// always specified in "cours/mois" — none of the audits ever gave a
// highlight-chat message cap. This ties it to the course cap at a fixed
// 10:1 ratio (roughly double the "5 highlights/cours" realistic-usage
// assumption used throughout the cost audits, for headroom) rather than
// inventing unrelated numbers per plan. Adjust this one constant if real
// usage data later shows students need more or less.
const HIGHLIGHT_MESSAGES_PER_COURSE = 10;

export const PLANS: Record<PlanId, Plan> = {
  freemium: {
    id: "freemium",
    label: "Freemium",
    tagline: "Pour découvrir Med Art AI",
    priceDZD: 0,
    durationMonths: 1,
    courseCap: 1,
    highlightMessageCap: 1 * HIGHLIGHT_MESSAGES_PER_COURSE,
    chatMessageCap: 15,
    flashcardCap: 50,
    remediationCap: 0,
    features: ["1 cours généré par mois", "10 messages chat (sélection) par mois", "Accès illimité aux cours déjà en cache"],
  },
  basic: {
    id: "basic",
    label: "Basic",
    tagline: "Pour réviser un module à la fois",
    priceDZD: 800,
    durationMonths: 1,
    courseCap: 10,
    highlightMessageCap: 10 * HIGHLIGHT_MESSAGES_PER_COURSE,
    chatMessageCap: 50,
    flashcardCap: 200,
    remediationCap: 2,
    features: ["10 cours générés par mois", "100 messages chat (sélection) par mois", "Les 6 sections complètes par cours"],
  },
  pro: {
    id: "pro",
    label: "Pro",
    tagline: "Pour suivre une année complète",
    priceDZD: 1300,
    durationMonths: 1,
    courseCap: 20,
    highlightMessageCap: 20 * HIGHLIGHT_MESSAGES_PER_COURSE,
    chatMessageCap: 150,
    flashcardCap: 500,
    remediationCap: 5,
    features: ["20 cours générés par mois", "200 messages chat (sélection) par mois", "Les 6 sections complètes par cours"],
  },
  max: {
    id: "max",
    label: "Max",
    tagline: "Pour les révisions les plus intensives",
    priceDZD: 2000,
    durationMonths: 1,
    courseCap: 30,
    highlightMessageCap: 30 * HIGHLIGHT_MESSAGES_PER_COURSE,
    chatMessageCap: 300,
    flashcardCap: 1000,
    remediationCap: 10,
    features: ["30 cours générés par mois", "300 messages chat (sélection) par mois", "Les 6 sections complètes par cours"],
  },
  semester: {
    id: "semester",
    label: "Semester",
    tagline: "Accès complet Max, facturé pour un semestre",
    priceDZD: 5000,
    durationMonths: 3,
    courseCap: 30,
    highlightMessageCap: 30 * HIGHLIGHT_MESSAGES_PER_COURSE,
    chatMessageCap: 300,
    flashcardCap: 1000,
    remediationCap: 10,
    features: ["Accès complet Max pendant 3 mois", "30 cours/mois, 300 messages chat/mois", "Facturé une fois, sans réabonnement mensuel"],
  },
  annual: {
    id: "annual",
    label: "Annual",
    tagline: "Accès complet Max, facturé pour l'année",
    priceDZD: 12000,
    durationMonths: 12,
    courseCap: 30,
    highlightMessageCap: 30 * HIGHLIGHT_MESSAGES_PER_COURSE,
    chatMessageCap: 300,
    flashcardCap: 1000,
    remediationCap: 10,
    features: ["Accès complet Max pendant 12 mois", "30 cours/mois, 300 messages chat/mois", "Le tarif le plus avantageux à l'année"],
  },
};

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

/** Freemium is the permanent default floor, never a Chargily purchase — see app/api/chargily/checkout/route.ts's guard. */
export function isPaidPlanId(value: PlanId): boolean {
  return value !== "freemium";
}
