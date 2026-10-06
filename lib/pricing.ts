/**
 * SINGLE SOURCE OF TRUTH for every plan, price and usage limit in Med Art
 * AI. Read by the Chargily checkout/webhook, lib/subscription.ts (quota
 * gates), lib/billing-pools.ts (Promo / Groupe pooled purchases), the
 * subscription API and every pricing UI.
 *
 * MONETIZATION v3 (2026-10-06) — product rules:
 *  - FREE TRIAL, one-time (never renewed): 1 course with the full Studio,
 *    20 messages across MedArt Assistant + Copilot. Exams and module
 *    summaries are paid features. Then: paywall.
 *  - THREE TIERS, three durations each. 4 months = 4 × monthly − 20 %;
 *    the yearly plan covers the 8 study months of the academic year and is
 *    priced 8 × monthly − 45 % (access lasts 8 months).
 *      INDIVIDUEL (1):       1 200 / 3 840 / 5 280 DA
 *      GROUPE (exactly 5):   1 100 / 3 520 / 4 840 DA per person
 *                            (order total 5 500 / 17 600 / 24 200 DA)
 *      COHORTE (exactly 40): 900 / 2 880 / 3 960 DA per person
 *                            (order total 36 000 / 115 200 / 158 400 DA)
 *    Groupe: one leader pays the 5 seats at once (4 invite codes), or each
 *    member pays their share and the plan starts at 5/5. Cohorte: each
 *    student pays their share; starts for everyone at 40/40, refund
 *    requested automatically if the gauge is not full after 7 days.
 *  - PAID LIMITS (every paid plan, identical): 40 courses / month (a deleted
 *    course is not given back), 10 exams / month, 5 module summaries / month
 *    (any of its 3 tools: Résumé, Mots-clés, Dictionnaire), course AI chat
 *    included (premium model up to the daily allowance, then the standard
 *    model). Flashcards, To-Do and Notes: unlimited.
 *  - Audio → Smart Notes is withdrawn until V2 (lib/feature-flags.ts): its
 *    limits stay defined for the gated code, never shown while it is off.
 *
 * Plan ids are "{tier}_{cycle}" (the "promo" tier id is the Cohorte —
 * kept for existing subscriptions, pools and DB rows). "annual" is the
 * 8-study-month plan.
 */
import type { Language } from "@/providers/LanguageProvider";
import { AUDIO_SMART_NOTES_ENABLED } from "@/lib/feature-flags";

export type PricingTierId = "individual" | "group" | "promo";
export type BillingCycle = "monthly" | "quad" | "annual";
/** How a Groupe is paid: one leader for 5 seats, or each member their share. */
export type GroupPaymentMode = "leader" | "pooled";

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

export const GROUP_SIZE = 5;
/** Cohorte seats (tier id "promo"). Pools created before v3 kept their own size (15). */
export const PROMO_SIZE = 40;
/** A pooled purchase (Promo, or Groupe paid member by member) must fill within this many days. */
export const POOL_DEADLINE_DAYS = 7;
/** A member about to pay holds their seat this long (so a pool never takes more payments than seats). */
export const SEAT_HOLD_MINUTES = 30;
/** What a student is told about the refund delay once it has been requested (processed by the team). */
export const REFUND_DELAY_LABEL = "5 jours ouvrés";

/** One-time free trial (never renewed). */
export const FREE_TRIAL = {
  courses: 1,
  messages: 20,
} as const;

/** Every paid plan's usage limits. */
export const PAID_LIMITS = {
  coursesPerMonth: 40,
  examsPerMonth: 10,
  synthesesPerMonth: 5,
  premiumMessagesPerDay: 20,
  audioPerDay: 1,
  audioPerMonth: 30,
} as const;

export interface Plan {
  id: PlanId;
  label: string;
  tagline: string;
  /** Price PER PERSON for the whole cycle (Groupe / Promo are per person). */
  priceDZD: number;
  /** Seats the plan is sold for: 1, exactly 5, or exactly 15. */
  seats: number;
  durationMonths: number;
  /** Still purchasable (false for legacy promo_quad / promo_annual). */
  purchasable: boolean;
  /** Courses created per month (paid). The free trial uses FREE_TRIAL.courses instead. */
  coursesPerMonth: number;
  examsPerMonth: number;
  synthesesPerMonth: number;
  premiumMessagesPerDay: number;
  audioPerDay: number;
  audioPerMonth: number;
  /**
   * Fair-use ceiling on Studio generations (sections, Lab, podcast…) per
   * month — not a product limit students plan around, a safety net against
   * scripted abuse. Stored in generations_used.
   */
  courseCap: number;
  /** "Ask MedArt" / translate on a selection, per month (fair use). */
  highlightMessageCap: number;
  /** Legacy monthly chat pool — paid chat is limited per DAY now, then falls back to the free model. */
  chatMessageCap: number;
  flashcardCap: number;
  remediationCap: number;
  features: string[];
  tier?: PricingTierId;
  cycle?: BillingCycle;
  featured?: boolean;
}

/**
 * Access length and price formula of each duration. Price per person =
 * monthly price × months × (100 − discountPct) / 100, computed in integers
 * so every displayed amount is exact (e.g. 1 200 × 8 × 55 / 100 = 5 280).
 */
const CYCLE_TERMS: Record<BillingCycle, { months: number; discountPct: number }> = {
  monthly: { months: 1, discountPct: 0 },
  quad: { months: 4, discountPct: 20 },
  annual: { months: 8, discountPct: 45 },
};

export const BILLING_CYCLES: { id: BillingCycle; months: number; label: Record<Language, string> }[] = [
  { id: "monthly", months: 1, label: { fr: "1 Mois", en: "1 Month" } },
  { id: "quad", months: 4, label: { fr: "4 Mois", en: "4 Months" } },
  { id: "annual", months: 8, label: { fr: "Année (8 mois)", en: "Year (8 months)" } },
];

const MONTHS: Record<BillingCycle, number> = { monthly: 1, quad: 4, annual: 8 };

const PAID_FEATURES = [
  `${PAID_LIMITS.coursesPerMonth} cours par mois, Studio complet`,
  `${PAID_LIMITS.examsPerMonth} examens de module par mois`,
  `${PAID_LIMITS.synthesesPerMonth} résumés de module par mois`,
  "Chat IA interactif avec tes cours inclus",
  // Listed again once Audio Smart Notes ships (lib/feature-flags.ts).
  ...(AUDIO_SMART_NOTES_ENABLED ? [`Audio → Smart Notes : ${PAID_LIMITS.audioPerDay}/jour (${PAID_LIMITS.audioPerMonth}/mois)`] : []),
  "Flashcards, To-Do et Notes illimités",
];

const PAID_CAPS = {
  coursesPerMonth: PAID_LIMITS.coursesPerMonth,
  examsPerMonth: PAID_LIMITS.examsPerMonth,
  synthesesPerMonth: PAID_LIMITS.synthesesPerMonth,
  premiumMessagesPerDay: PAID_LIMITS.premiumMessagesPerDay,
  audioPerDay: PAID_LIMITS.audioPerDay,
  audioPerMonth: PAID_LIMITS.audioPerMonth,
  courseCap: 1000,
  highlightMessageCap: 600,
  chatMessageCap: 1_000_000,
  flashcardCap: 1_000_000,
  remediationCap: 10,
};

interface TierMeta {
  id: PricingTierId;
  name: string;
  tagline: string;
  seats: number;
  monthlyPricePerPerson: number;
  cycles: BillingCycle[];
  features: string[];
  featured?: boolean;
}

const TIER_META: Record<PricingTierId, TierMeta> = {
  individual: {
    id: "individual",
    name: "Individuel",
    tagline: "Pour réviser à ton rythme",
    seats: 1,
    monthlyPricePerPerson: 1200,
    cycles: ["monthly", "quad", "annual"],
    features: PAID_FEATURES,
  },
  group: {
    id: "group",
    name: "Groupe",
    tagline: `Exactement ${GROUP_SIZE} amis, prix par personne`,
    seats: GROUP_SIZE,
    monthlyPricePerPerson: 1100,
    cycles: ["monthly", "quad", "annual"],
    features: [
      "Tout Individuel, pour chacun des 5",
      "Un chef paie les 5 places, ou chacun paie sa part",
      "Activation dès que le groupe est complet (5/5)",
    ],
    featured: true,
  },
  promo: {
    id: "promo",
    name: "Cohorte",
    tagline: `Exactement ${PROMO_SIZE} étudiants de ta promo`,
    seats: PROMO_SIZE,
    monthlyPricePerPerson: 900,
    cycles: ["monthly", "quad", "annual"],
    features: [
      "Tout Individuel, au prix le plus bas",
      `S'active pour les ${PROMO_SIZE} dès que la jauge est pleine`,
      `Pas ${PROMO_SIZE}/${PROMO_SIZE} en ${POOL_DEADLINE_DAYS} jours ? Remboursement déclenché automatiquement`,
    ],
  },
};

function buildPlan(tier: TierMeta, cycle: BillingCycle): Plan {
  return {
    id: `${tier.id}_${cycle}` as PlanId,
    label: tier.name,
    tagline: tier.tagline,
    priceDZD: (tier.monthlyPricePerPerson * CYCLE_TERMS[cycle].months * (100 - CYCLE_TERMS[cycle].discountPct)) / 100,
    seats: tier.seats,
    durationMonths: MONTHS[cycle],
    purchasable: tier.cycles.includes(cycle),
    ...PAID_CAPS,
    features: tier.features,
    tier: tier.id,
    cycle,
    featured: tier.featured,
  };
}

export const PLANS: Record<PlanId, Plan> = {
  freemium: {
    id: "freemium",
    label: "Essai gratuit",
    tagline: "Pour découvrir Med Art AI",
    priceDZD: 0,
    seats: 1,
    durationMonths: 1,
    purchasable: false,
    coursesPerMonth: 0,
    examsPerMonth: 0,
    synthesesPerMonth: 0,
    premiumMessagesPerDay: FREE_TRIAL.messages,
    audioPerDay: 0,
    audioPerMonth: 0,
    courseCap: 60,
    highlightMessageCap: 1_000_000,
    chatMessageCap: 1_000_000,
    flashcardCap: 1_000_000,
    remediationCap: 0,
    features: [`${FREE_TRIAL.courses} cours avec le Studio complet`, `${FREE_TRIAL.messages} messages avec l'Assistant / Copilot`, "Une seule fois, sans carte bancaire"],
  },
  individual_monthly: buildPlan(TIER_META.individual, "monthly"),
  individual_quad: buildPlan(TIER_META.individual, "quad"),
  individual_annual: buildPlan(TIER_META.individual, "annual"),
  group_monthly: buildPlan(TIER_META.group, "monthly"),
  group_quad: buildPlan(TIER_META.group, "quad"),
  group_annual: buildPlan(TIER_META.group, "annual"),
  promo_monthly: buildPlan(TIER_META.promo, "monthly"),
  promo_quad: buildPlan(TIER_META.promo, "quad"),
  promo_annual: buildPlan(TIER_META.promo, "annual"),
};

const TIER_ORDER: PricingTierId[] = ["individual", "group", "promo"];

/** The tiers sold at a given cycle, in a stable order. */
export function getPlansForCycle(cycle: BillingCycle): Plan[] {
  return TIER_ORDER.map((tierId) => PLANS[`${tierId}_${cycle}` as PlanId]).filter((plan) => plan.purchasable);
}

/** Total paid at once by a Groupe leader for the 5 seats. */
export function groupLeaderTotalDZD(plan: Plan): number {
  return plan.priceDZD * GROUP_SIZE;
}

/** Whole order of a pooled plan: price per person × seats (Groupe 5, Cohorte 40). */
export function poolTotalDZD(plan: Plan): number {
  return plan.priceDZD * plan.seats;
}

/** The duration discount (20 % for 4 months, 45 % for the year), or null for 1 month. */
export function computeSavingsPercent(_tier: PricingTierId, cycle: BillingCycle): number | null {
  const pct = CYCLE_TERMS[cycle].discountPct;
  return pct > 0 ? pct : null;
}

export function formatDZD(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} DA`;
}

export function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

export function isPaidPlanId(value: PlanId): boolean {
  return value !== "freemium";
}

export function isBillingCycle(value: unknown): value is BillingCycle {
  return value === "monthly" || value === "quad" || value === "annual";
}
