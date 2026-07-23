export type PlanId = "semestriel" | "annuel";

export interface Plan {
  id: PlanId;
  label: string;
  tagline: string;
  priceDZD: number;
  durationMonths: number;
  /** null = unlimited fresh AI generations for the period. */
  generationCap: number | null;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  semestriel: {
    id: "semestriel",
    label: "Pro Étudiant — Semestriel",
    tagline: "Un semestre de révisions sans limite de lecture",
    priceDZD: 1500,
    durationMonths: 6,
    generationCap: 30,
    features: [
      "Accès illimité à tous les cours déjà générés (cache)",
      "30 nouvelles générations IA par semestre",
      "Les 6 sections complètes par cours",
      "Valable 6 mois",
    ],
  },
  annuel: {
    id: "annuel",
    label: "Ultimate — Annuel",
    tagline: "Toute l'année, sans compter les générations",
    priceDZD: 3000,
    durationMonths: 12,
    generationCap: null,
    features: [
      "Accès illimité à tous les cours déjà générés (cache)",
      "Générations IA illimitées",
      "Les 6 sections complètes par cours",
      "Valable 12 mois",
    ],
  },
};

export function isPlanId(value: string): value is PlanId {
  return value === "semestriel" || value === "annuel";
}
