/**
 * SINGLE SOURCE OF TRUTH for every subscription plan in Med Art AI — real,
 * Chargily-checkout-wired, quota-enforcing plans. Used by
 * app/api/chargily/{checkout,webhook}/route.ts, app/api/subscription/route.ts,
 * lib/subscription.ts's quota gating (reserveGeneration/reserveHighlightMessage/
 * reserveChatMessage/reserveRemediation), app/dashboard/(shell)/billing/page.tsx,
 * and app/page.tsx's homepage pricing section.
 *
 * REPLACED 2026-09-06: the previous 6-plan lineup (Freemium/Basic/Pro/Max/
 * Semester/Annual) is retired — those PlanId strings no longer exist anywhere
 * in this app, INCLUDING the `subscriptions_plan_check` constraint in
 * supabase/schema.sql, which MUST be migrated in lockstep on the live
 * database (see that file's own comment) or every checkout will fail its
 * insert. Only "freemium" survives from the old lineup (kept per explicit
 * product decision — every new signup still gets a free tier via the
 * handle_new_user() trigger, unchanged).
 *
 * The new lineup is 3 tiers (Individuel/Groupe/Promo Cohorte) × 3 billing
 * cycles (1/4/12 mois) = 9 paid PlanIds, named "{tier}_{cycle}" (e.g.
 * "group_annual"). All 9 share IDENTICAL usage caps — explicit product
 * decision to reuse the old "Max" tier's caps across the board rather than
 * invent per-tier numbers with no usage data behind them; only price and
 * (conceptually, not yet enforced server-side — see components/pricing's own
 * comments) seat count differ between tiers.
 */
import type { Language } from "@/providers/LanguageProvider";

export type PricingTierId = "individual" | "group" | "promo";
export type BillingCycle = "monthly" | "quad" | "annual";

export type PlanId =
  | "freemium"
  | "individual_monthly"
  | "individual_quad"
  | "individual_annual"
  | "group_monthly"
  | "group_quad"
  | "group_annual"
  | "promo_monthly"
  | "promo_quad"
  | "promo_annual";

export interface Plan {
  id: PlanId;
  label: string;
  tagline: string;
  priceDZD: number;
  /** Billing cycle length in months — paid upfront for the whole period; courseCap/highlightMessageCap/etc. below are still MONTHLY allowances, not banked for the whole period (see lib/subscription.ts's monthly rollover). */
  durationMonths: number;
  /** Cours (Studio) génération par mois. */
  courseCap: number;
  /** Messages chat "highlight" (Ask MedArt / Translate sur sélection) par mois. */
  highlightMessageCap: number;
  /** Messages chat libres (question ouverte dans l'assistant, hors sélection) par mois. */
  chatMessageCap: number;
  /** Historique: jamais lu par le code de quota (flashcards se réservent contre courseCap, voir lib/subscription.ts) — conservé pour ne pas casser la forme du type. */
  flashcardCap: number;
  /** Plans de remédiation des points faibles générés par mois. */
  remediationCap: number;
  features: string[];
  /** Absent for "freemium" (not part of the tier/cycle grid) — present for all 9 paid plans. */
  tier?: PricingTierId;
  cycle?: BillingCycle;
  /** Which tier gets the "Recommandé" glow treatment on pricing UIs. */
  featured?: boolean;
}

export const BILLING_CYCLES: { id: BillingCycle; months: number; label: Record<Language, string> }[] = [
  { id: "monthly", months: 1, label: { fr: "1 Mois", en: "1 Month" } },
  { id: "quad", months: 4, label: { fr: "4 Mois", en: "4 Months" } },
  { id: "annual", months: 12, label: { fr: "1 An", en: "1 Year" } },
];

// Every paid plan shares these caps regardless of tier/cycle — see this
// file's header comment for why (reusing the old "Max" tier's numbers, no
// per-tier usage data exists yet to justify anything else).
const HIGHLIGHT_MESSAGES_PER_COURSE = 10;
const PAID_CAPS = {
  courseCap: 30,
  highlightMessageCap: 30 * HIGHLIGHT_MESSAGES_PER_COURSE,
  chatMessageCap: 300,
  flashcardCap: 1000,
  remediationCap: 10,
};

interface TierMeta {
  id: PricingTierId;
  name: string;
  tagline: string;
  prices: Record<BillingCycle, number>;
  features: string[];
  featured?: boolean;
}

const TIER_META: Record<PricingTierId, TierMeta> = {
  individual: {
    id: "individual",
    name: "Individuel",
    tagline: "Pour réviser à ton rythme",
    prices: { monthly: 1500, quad: 5500, annual: 10000 },
    features: [
      "Accès complet au Studio (6 formats par cours)",
      "Examens de module générés par IA",
      "Assistant IA illimité",
      "Suivi de tes points faibles",
    ],
  },
  group: {
    id: "group",
    name: "Groupe",
    tagline: "5 personnes et plus, un seul paiement",
    prices: { monthly: 1200, quad: 4500, annual: 8500 },
    features: [
      "Tout Individuel, par personne",
      "5 places incluses (4 amis à inviter)",
      "Liens d'invitation magiques instantanés",
      "Un seul paiement pour tout le groupe",
    ],
    featured: true,
  },
  promo: {
    id: "promo",
    name: "Promo Cohorte",
    tagline: "Réservé aux promos universitaires vérifiées",
    prices: { monthly: 700, quad: 3000, annual: 5500 },
    features: [
      "Tout Individuel, tarif promo cohorte",
      "Éligibilité pouvant être vérifiée (faculté / cohorte)",
      "Le tarif le plus bas de Med Art AI",
      "Idéal pour toute une promo qui s'organise",
    ],
  },
};

function buildPlan(tier: TierMeta, cycle: (typeof BILLING_CYCLES)[number]): Plan {
  return {
    id: `${tier.id}_${cycle.id}` as PlanId,
    label: tier.name,
    tagline: tier.tagline,
    priceDZD: tier.prices[cycle.id],
    durationMonths: cycle.months,
    ...PAID_CAPS,
    features: tier.features,
    tier: tier.id,
    cycle: cycle.id,
    featured: tier.featured,
  };
}

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
  individual_monthly: buildPlan(TIER_META.individual, BILLING_CYCLES[0]),
  individual_quad: buildPlan(TIER_META.individual, BILLING_CYCLES[1]),
  individual_annual: buildPlan(TIER_META.individual, BILLING_CYCLES[2]),
  group_monthly: buildPlan(TIER_META.group, BILLING_CYCLES[0]),
  group_quad: buildPlan(TIER_META.group, BILLING_CYCLES[1]),
  group_annual: buildPlan(TIER_META.group, BILLING_CYCLES[2]),
  promo_monthly: buildPlan(TIER_META.promo, BILLING_CYCLES[0]),
  promo_quad: buildPlan(TIER_META.promo, BILLING_CYCLES[1]),
  promo_annual: buildPlan(TIER_META.promo, BILLING_CYCLES[2]),
};

const TIER_ORDER: PricingTierId[] = ["individual", "group", "promo"];

/** The 3 official tiers at a given billing cycle, in a stable Individuel/Groupe/Promo order — what every pricing UI (marketing /pricing page, dashboard billing page) iterates to render its 3 cards. */
export function getPlansForCycle(cycle: BillingCycle): Plan[] {
  return TIER_ORDER.map((tierId) => PLANS[`${tierId}_${cycle}` as PlanId]);
}

/**
 * Honest, DERIVED savings badge — never a hardcoded/invented percentage.
 * Compares the given cycle's real price against what that same duration
 * would cost at the tier's own monthly rate (monthly price × cycle months).
 * Returns null for the monthly cycle itself, or whenever the longer cycle
 * doesn't actually undercut paying monthly the whole time (a real, honest
 * possibility with some of these tiers' own numbers — see Promo's 4-month
 * price, which is NOT a discount vs. its monthly rate).
 */
export function computeSavingsPercent(tier: PricingTierId, cycle: BillingCycle): number | null {
  if (cycle === "monthly") return null;
  const cycleMeta = BILLING_CYCLES.find((c) => c.id === cycle);
  if (!cycleMeta) return null;
  const monthly = PLANS[`${tier}_monthly` as PlanId].priceDZD;
  const actual = PLANS[`${tier}_${cycle}` as PlanId].priceDZD;
  const equivalentMonthlyTotal = monthly * cycleMeta.months;
  if (equivalentMonthlyTotal <= actual) return null;
  return Math.round(((equivalentMonthlyTotal - actual) / equivalentMonthlyTotal) * 100);
}

export function formatDZD(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} DA`;
}

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

/** Freemium is the permanent default floor, never a Chargily purchase — see app/api/chargily/checkout/route.ts's guard. */
export function isPaidPlanId(value: PlanId): boolean {
  return value !== "freemium";
}
