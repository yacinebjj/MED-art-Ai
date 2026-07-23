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
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  if (!userId || !isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "user_id, email, plan, status, period_start, period_end, generations_used, generations_period_start"
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

export function isSubscriptionActive(sub: SubscriptionRow | null): boolean {
  if (!sub || sub.status !== "active" || !sub.period_end) return false;
  return new Date(sub.period_end).getTime() > Date.now();
}

interface GenerateGateUser {
  id: string;
  /** ISO timestamp from Supabase Auth — powers the pre-trial-feature fallback. */
  created_at?: string | null;
}

/**
 * Gate for real AI generations (cache hits never call this — see
 * app/api/generate/route.ts). Allowed if the student has an active paid
 * subscription OR is still within their 7-day free trial (falling back to
 * `created_at + 7 days` for accounts that predate profiles.trial_ends_at);
 * blocked (with an exhausted quota) otherwise, before any tokens are spent.
 * In development, a lapsed trial never blocks generation — you don't want
 * to be locked out of testing locally just because a seed account is old.
 */
export async function canGenerate(
  user: GenerateGateUser
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!isSupabaseConfigured()) {
    return {
      allowed: false,
      reason:
        "La vérification d'abonnement n'est pas configurée sur le serveur (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants).",
    };
  }

  if (!user?.id) {
    return {
      allowed: false,
      reason: "Compte introuvable. Reconnecte-toi puis réessaie.",
    };
  }

  const [sub, profile] = await Promise.all([getSubscription(user.id), getProfile(user.id)]);

  const subscribed = isSubscriptionActive(sub);
  const trialing = isTrialActive(profile, user.created_at);

  if (!subscribed && !trialing) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[dev] canGenerate: bypassing expired/missing trial for user ${user.id} (NODE_ENV=development).`
      );
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        "Ton abonnement ou ton essai gratuit n'est plus actif. Choisis une formule pour générer de nouveaux cours.",
    };
  }

  if (subscribed) {
    const plan = PLANS[sub!.plan];
    if (plan.generationCap !== null && sub!.generations_used >= plan.generationCap) {
      return {
        allowed: false,
        reason: `Tu as atteint la limite de ${plan.generationCap} générations pour ta formule "${plan.label}". Passe à la formule Annuel pour des générations illimitées.`,
      };
    }
  }

  return { allowed: true };
}

/** Called after a successful (billable) AI generation. Best-effort. */
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

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Activates (or renews) a subscription after a paid Chargily checkout.
 * Called only from the webhook handler, once the signature is verified.
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
