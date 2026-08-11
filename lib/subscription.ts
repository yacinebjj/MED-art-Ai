import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/pricing";
import { getProfile, isTrialActive } from "@/lib/trial";

export interface SubscriptionRow {
  user_id: string;
  email: string | null;
  plan: PlanId;
  status: "pending" | "active" | "expired" | "cancelled";
  period_start: string | null;
  period_end: string | null;
  generations_used: number;
  generations_period_start: string | null;
  highlight_messages_used: number;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  if (!userId || !isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "user_id, email, plan, status, period_start, period_end, generations_used, generations_period_start, highlight_messages_used"
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Supabase subscriptions lookup failed", error);
      return null;
    }

    return (data as SubscriptionRow) ?? null;
  } catch (error) {
    console.error("Supabase subscriptions lookup threw", error);
    return null;
  }
}

/** True only for a PAID plan currently within its billing period — Freemium is never "active" in this sense (it has no period_end, and isn't something you subscribed to), see resolveEffectivePlan below for the quota-gating equivalent that DOES treat Freemium as a valid standing tier. Drives the billing page's "Formule actuelle" badge. */
export function isSubscriptionActive(sub: SubscriptionRow | null): boolean {
  if (!sub || sub.plan === "freemium" || sub.status !== "active" || !sub.period_end) return false;
  return new Date(sub.period_end).getTime() > Date.now();
}

/**
 * Resolves the plan that actually governs this user's quotas RIGHT NOW —
 * distinct from `sub.plan`, which is just whatever was last purchased (or
 * "freemium" by default) and can be stale: a Max subscriber whose
 * period_end has passed is still stored as `plan: "max"` until they
 * resubscribe, but their REAL quota from this moment on is Freemium's. No
 * write happens here — this is a pure read-time fallback, avoiding a cron
 * job to "expire" rows the moment their period ends.
 */
export function resolveEffectivePlan(sub: SubscriptionRow | null): PlanId {
  if (!sub) return "freemium";
  if (sub.plan === "freemium") return "freemium";
  const withinPeriod = sub.status === "active" && !!sub.period_end && new Date(sub.period_end).getTime() > Date.now();
  return withinPeriod ? sub.plan : "freemium";
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function isUsagePeriodStale(periodStart: string | null): boolean {
  if (!periodStart) return true;
  return Date.now() - new Date(periodStart).getTime() >= MONTH_MS;
}

/**
 * Every plan's cap is MONTHLY even when the BILLING period is longer
 * (Semester pays for 3 months upfront, Annual for 12, but both are still
 * capped at 30 cours/mois — not 90 or 360 banked in one go). Rather than a
 * scheduled job, this lazily rolls the counters over the moment a check or
 * a record call notices the stored period is >= 30 days old — cheap,
 * correct, and never depends on a cron actually firing on time.
 */
async function ensureFreshUsagePeriod(userId: string, sub: SubscriptionRow): Promise<SubscriptionRow> {
  if (!isUsagePeriodStale(sub.generations_period_start)) return sub;

  const now = new Date().toISOString();
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("subscriptions")
      .update({ generations_used: 0, highlight_messages_used: 0, generations_period_start: now, updated_at: now })
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to roll over monthly quota period (fail-open, using stale counts)", error);
      return sub;
    }
  } catch (error) {
    console.error("Monthly quota rollover threw (fail-open, using stale counts)", error);
    return sub;
  }

  return { ...sub, generations_used: 0, highlight_messages_used: 0, generations_period_start: now };
}

interface GateUser {
  id: string;
  /** ISO timestamp from Supabase Auth — powers the pre-trial-feature fallback. */
  created_at?: string | null;
}

type GateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Shared gate logic for both quota kinds (course generations, highlight chat
 * messages) — trial first (unlimited, unchanged from before Freemium
 * existed), then the effective plan's monthly cap. A missing subscriptions
 * row (pre-migration account, or a signup-trigger hiccup) fails OPEN rather
 * than blocking: the trigger is expected to create one for every account
 * going forward, so hitting `null` here should be rare and must never lock
 * a real student out entirely.
 */
async function checkQuota(
  user: GateUser,
  usedField: "generations_used" | "highlight_messages_used",
  capField: "courseCap" | "highlightMessageCap",
  exceededMessage: (planLabel: string, cap: number) => string
): Promise<GateResult> {
  if (!isSupabaseConfigured()) {
    return { allowed: false, reason: "La vérification d'abonnement n'est pas configurée sur le serveur (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants)." };
  }
  if (!user?.id) {
    return { allowed: false, reason: "Compte introuvable. Reconnecte-toi puis réessaie." };
  }

  const [subRaw, profile] = await Promise.all([getSubscription(user.id), getProfile(user.id)]);

  if (isTrialActive(profile, user.created_at)) {
    return { allowed: true };
  }

  if (!subRaw) {
    return { allowed: true };
  }

  const sub = await ensureFreshUsagePeriod(user.id, subRaw);
  const effectivePlanId = resolveEffectivePlan(sub);
  const plan = PLANS[effectivePlanId];
  const used = sub[usedField];
  const cap = plan[capField];

  if (used >= cap) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[dev] ${usedField} quota exceeded for user ${user.id} — bypassing (NODE_ENV=development).`);
      return { allowed: true };
    }
    return { allowed: false, reason: exceededMessage(plan.label, cap) };
  }

  return { allowed: true };
}

/** Gate for real Studio generations (cache hits and Smart Clones never call this — they cost nothing, so they shouldn't consume quota). */
export async function canGenerate(user: GateUser): Promise<GateResult> {
  return checkQuota(
    user,
    "generations_used",
    "courseCap",
    (planLabel, cap) =>
      `Tu as atteint la limite de ${cap} cours pour ta formule "${planLabel}" ce mois-ci. Passe à une formule supérieure pour continuer.`
  );
}

/** Gate for the chat's highlight quick actions (Ask MedArt / Translate on a selection) — never for the free-form chat input, which isn't quota-limited by plan (only by the generic per-route rate limit). */
export async function canSendHighlightMessage(user: GateUser): Promise<GateResult> {
  return checkQuota(
    user,
    "highlight_messages_used",
    "highlightMessageCap",
    (planLabel, cap) =>
      `Tu as atteint la limite de ${cap} messages "sélection" pour ta formule "${planLabel}" ce mois-ci. Passe à une formule supérieure pour continuer.`
  );
}

/** Called after a successful (billable) Studio generation. Best-effort. */
export async function recordGeneration(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_generations_used", { p_user_id: userId });
    if (error) {
      console.warn("increment_generations_used RPC unavailable:", error.message);
    }
  } catch (error) {
    console.warn("increment_generations_used threw:", error);
  }
}

/** Called after a successful highlight chat reply. Best-effort. */
export async function recordHighlightMessage(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_highlight_messages_used", { p_user_id: userId });
    if (error) {
      console.warn("increment_highlight_messages_used RPC unavailable:", error.message);
    }
  } catch (error) {
    console.warn("increment_highlight_messages_used threw:", error);
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Activates (or renews/upgrades) a subscription after a paid Chargily
 * checkout. Called only from the webhook handler, once the signature is
 * verified. Resets BOTH quota counters and their shared rollover clock —
 * an upgrade mid-month must not inherit whatever the old plan (or Freemium)
 * had already used.
 */
export async function activateSubscription(params: {
  userId: string;
  email?: string;
  plan: PlanId;
  chargilyCheckoutId: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase n'est pas configuré — impossible d'activer l'abonnement.");
  }

  const supabase = getSupabaseAdmin();
  const now = new Date();
  const plan = PLANS[params.plan];

  const { error } = await supabase.from("subscriptions").upsert(
    {
      user_id: params.userId,
      email: params.email,
      plan: params.plan,
      status: "active",
      period_start: now.toISOString(),
      period_end: addMonths(now, plan.durationMonths).toISOString(),
      generations_used: 0,
      generations_period_start: now.toISOString(),
      highlight_messages_used: 0,
      chargily_checkout_id: params.chargilyCheckoutId,
      updated_at: now.toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("Failed to activate subscription", error);
    throw error;
  }
}
