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
  chat_messages_used: number;
  flashcards_used: number;
  remediation_used: number;
  /** Daily counter, deliberately on its OWN 24h clock — see ensureFreshDailyChatPeriod — not the monthly generations_period_start every other counter shares. */
  daily_chat_messages_used: number;
  daily_chat_reset_at: string | null;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  if (!userId || !isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("subscriptions")
      .select(
        "user_id, email, plan, status, period_start, period_end, generations_used, generations_period_start, highlight_messages_used, chat_messages_used, flashcards_used, remediation_used, daily_chat_messages_used, daily_chat_reset_at"
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
  const reset = { generations_used: 0, highlight_messages_used: 0, chat_messages_used: 0, flashcards_used: 0, remediation_used: 0 };
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("subscriptions")
      .update({ ...reset, generations_period_start: now, updated_at: now })
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to roll over monthly quota period (fail-open, using stale counts)", error);
      return sub;
    }
  } catch (error) {
    console.error("Monthly quota rollover threw (fail-open, using stale counts)", error);
    return sub;
  }

  return { ...sub, ...reset, generations_period_start: now };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Flat, plan-independent daily cap on free-form chat — 20 msgs/day for every tier, distinct from chatMessageCap's monthly-per-plan pool. Both must pass; whichever is tighter for a given student blocks first. */
const DAILY_CHAT_LIMIT = 20;

function isDailyPeriodStale(resetAt: string | null): boolean {
  if (!resetAt) return true;
  return Date.now() - new Date(resetAt).getTime() >= DAY_MS;
}

/**
 * Same lazy-rollover shape as ensureFreshUsagePeriod, but on its OWN 24h
 * clock (daily_chat_reset_at) instead of the monthly generations_period_start
 * every other counter shares — a daily cap must reset every day regardless
 * of where a student is in their monthly billing cycle.
 */
async function ensureFreshDailyChatPeriod(userId: string, sub: SubscriptionRow): Promise<SubscriptionRow> {
  if (!isDailyPeriodStale(sub.daily_chat_reset_at)) return sub;

  const now = new Date().toISOString();
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("subscriptions")
      .update({ daily_chat_messages_used: 0, daily_chat_reset_at: now, updated_at: now })
      .eq("user_id", userId);

    if (error) {
      console.error("Failed to roll over daily chat quota (fail-open, using stale count)", error);
      return sub;
    }
  } catch (error) {
    console.error("Daily chat quota rollover threw (fail-open, using stale count)", error);
    return sub;
  }

  return { ...sub, daily_chat_messages_used: 0, daily_chat_reset_at: now };
}

interface GateUser {
  id: string;
  /** ISO timestamp from Supabase Auth — powers the pre-trial-feature fallback. */
  created_at?: string | null;
}

type GateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * SECURITY FIX (replaces the old checkQuota + separate record*() pattern):
 * that pattern read `used`, compared to `cap` in application code, then
 * incremented in a SEPARATE call after the OpenRouter response — a real
 * TOCTOU race, since N concurrent requests could all read the same
 * pre-increment value and all pass the check before any of them wrote back.
 * Found during a security audit; confirmed exploitable up to the generic
 * per-route rate limit's burst size (20 requests/5min), repeatable every
 * window.
 *
 * reserveQuota does the check-and-increment as ONE atomic SQL statement
 * (see reserve_*_used in supabase/schema.sql) — Postgres serializes
 * concurrent UPDATEs to the same row, so two callers can never both slip
 * through. Called BEFORE the OpenRouter call now, not after; the
 * corresponding refund*() function below undoes the reservation if the
 * call then fails, preserving the pre-existing "a failed generation
 * shouldn't cost you a quota unit" guarantee without reopening the race.
 */
async function reserveQuota(
  user: GateUser,
  capField: "courseCap" | "highlightMessageCap" | "chatMessageCap" | "remediationCap",
  reserveRpc: "reserve_generations_used" | "reserve_highlight_messages_used" | "reserve_chat_messages_used" | "reserve_remediation_used",
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

  // Rolls the period over BEFORE reserving, so a stale used-count from last
  // month never wrongly blocks against this month's fresh allowance.
  const sub = await ensureFreshUsagePeriod(user.id, subRaw);
  const effectivePlanId = resolveEffectivePlan(sub);
  const plan = PLANS[effectivePlanId];
  const cap = plan[capField];

  // Dev bypass: skip reservation entirely rather than call the atomic RPC
  // with a fake cap — dev/local testing doesn't need real usage counters
  // building up, and the RPC's WHERE clause has no NODE_ENV awareness (nor
  // should it; that's an application concern, not a DB one).
  if (process.env.NODE_ENV === "development") {
    return { allowed: true };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(reserveRpc, { p_user_id: user.id, p_cap: cap });

  if (error) {
    console.error(`[subscription] ${reserveRpc} RPC failed — fail-open (allowing):`, error.message);
    return { allowed: true };
  }
  if (data === null) {
    return { allowed: false, reason: exceededMessage(plan.label, cap) };
  }
  return { allowed: true };
}

/**
 * Reserves one unit against courseCap for a real Studio generation — call
 * BEFORE the OpenRouter call, call refundGeneration() if it then fails.
 * Cache hits and Smart Clones never call this (they cost nothing). Also
 * used by app/api/studio/regenerate/route.ts's "Régénérer" — a regeneration
 * is still a real, billable OpenRouter call for one section of a course
 * already counted against this same monthly pool, so it shares this cap
 * rather than needing a second one.
 */
export async function reserveGeneration(user: GateUser): Promise<GateResult> {
  return reserveQuota(
    user,
    "courseCap",
    "reserve_generations_used",
    (planLabel, cap) =>
      `Tu as atteint la limite de ${cap} cours pour ta formule "${planLabel}" ce mois-ci. Passe à une formule supérieure pour continuer.`
  );
}

/** Undoes reserveGeneration() after a failed OpenRouter call/parse/validation. Best-effort. */
export async function refundGeneration(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("refund_generations_used", { p_user_id: userId });
    if (error) console.warn("refund_generations_used RPC unavailable:", error.message);
  } catch (error) {
    console.warn("refund_generations_used threw:", error);
  }
}

/** Reserves one unit against highlightMessageCap (Ask MedArt / Translate on a selection). Distinct pool from chat message reservation below. */
export async function reserveHighlightMessage(user: GateUser): Promise<GateResult> {
  return reserveQuota(
    user,
    "highlightMessageCap",
    "reserve_highlight_messages_used",
    (planLabel, cap) =>
      `Tu as atteint la limite de ${cap} messages "sélection" pour ta formule "${planLabel}" ce mois-ci. Passe à une formule supérieure pour continuer.`
  );
}

/** Undoes reserveHighlightMessage() after a failed reply. Best-effort. */
export async function refundHighlightMessage(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("refund_highlight_messages_used", { p_user_id: userId });
    if (error) console.warn("refund_highlight_messages_used RPC unavailable:", error.message);
  } catch (error) {
    console.warn("refund_highlight_messages_used threw:", error);
  }
}

/**
 * Reserves one unit against chatMessageCap for a free-form chat turn — only
 * called once app/api/courses/chat/route.ts's semantic-cache lookup comes
 * back empty (a $0 cache hit must never consume this), and BEFORE the
 * OpenRouter call. Call refundChatMessage() if the call then fails.
 */
export async function reserveChatMessage(user: GateUser): Promise<GateResult> {
  return reserveQuota(
    user,
    "chatMessageCap",
    "reserve_chat_messages_used",
    (planLabel, cap) =>
      `Tu as atteint la limite de ${cap} messages chat pour ta formule "${planLabel}" ce mois-ci. Passe à une formule supérieure pour continuer.`
  );
}

/** Undoes reserveChatMessage() after a failed reply. Best-effort. */
export async function refundChatMessage(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("refund_chat_messages_used", { p_user_id: userId });
    if (error) console.warn("refund_chat_messages_used RPC unavailable:", error.message);
  } catch (error) {
    console.warn("refund_chat_messages_used threw:", error);
  }
}

/** Reserves one unit against remediationCap (app/api/study/remediation-plan/generate) — only reserved once real wrong/fragile QCM attempts exist to build a plan from; the "pas assez de données" early-return never calls this. Call refundRemediation() if the call then fails. */
export async function reserveRemediation(user: GateUser): Promise<GateResult> {
  return reserveQuota(
    user,
    "remediationCap",
    "reserve_remediation_used",
    (planLabel, cap) =>
      cap === 0
        ? `Les plans de remédiation ne sont pas inclus dans ta formule "${planLabel}". Passe à une formule supérieure pour y accéder.`
        : `Tu as atteint la limite de ${cap} plans de remédiation pour ta formule "${planLabel}" ce mois-ci. Passe à une formule supérieure pour continuer.`
  );
}

/** Undoes reserveRemediation() after a failed generation. Best-effort. */
export async function refundRemediation(userId: string): Promise<void> {
  if (!userId || !isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("refund_remediation_used", { p_user_id: userId });
    if (error) console.warn("refund_remediation_used RPC unavailable:", error.message);
  } catch (error) {
    console.warn("refund_remediation_used threw:", error);
  }
}

/**
 * Flat 24h gate for free-form chat, independent of and IN ADDITION TO
 * reserveChatMessage's monthly chatMessageCap — a student must pass both.
 * Unlike the monthly cap, this ALSO reserves on a semantic-cache HIT (see
 * app/api/courses/chat/route.ts) — it's an abuse/scraping throttle on
 * request volume, not a spend ledger, so a free hit still counts. No refund
 * function: nothing that reserves this ever fails after the fact (a cache
 * hit can't fail; the one real-generation path reserves this before the
 * semantic-cache lookup even runs, ahead of anywhere the call could fail).
 */
export async function reserveChatMessageDaily(user: GateUser): Promise<GateResult> {
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

  // Rolls the 24h period over before reserving — nothing further is derived
  // from its return value; reserve_daily_chat_messages_used below reads the
  // (now-fresh) count straight from the DB itself.
  await ensureFreshDailyChatPeriod(user.id, subRaw);

  if (process.env.NODE_ENV === "development") {
    return { allowed: true };
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("reserve_daily_chat_messages_used", { p_user_id: user.id, p_cap: DAILY_CHAT_LIMIT });

  if (error) {
    console.error("[subscription] reserve_daily_chat_messages_used RPC failed — fail-open (allowing):", error.message);
    return { allowed: true };
  }
  if (data === null) {
    return {
      allowed: false,
      reason: `Tu as atteint la limite de ${DAILY_CHAT_LIMIT} messages par jour pour l'assistant. Réessaie demain.`,
    };
  }
  return { allowed: true };
}

// reserveFlashcards()/refundFlashcards() (per-card quota, variable batch
// size) were removed here — the flashcard architecture moved to a
// definitive-set model (see app/api/flashcards/generate/route.ts and
// lib/flashcards-content-cache.ts) where a course's flashcards are
// generated ONCE ever, cross-student, and every subsequent serve is a free
// cache hit. That route now reserves against courseCap via
// reserveGeneration()/refundGeneration() instead — ONE unit per real
// generation EVENT, not per card, since "cards produced" no longer
// corresponds to real spend once caching dominates. The underlying
// reserve_flashcards_used/refund_flashcards_used SQL functions (and their
// REVOKE) are left in place, unused, rather than dropped — consistent with
// this file's existing policy of not casually removing DB functions old
// rows or a rollback might still reference.

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Activates (or renews/upgrades) a subscription after a paid Chargily
 * checkout. Called only from the webhook handler, once the signature is
 * verified. Resets every MONTHLY quota counter and their shared rollover
 * clock — an upgrade mid-month must not inherit whatever the old plan (or
 * Freemium) had already used. Does NOT touch daily_chat_messages_used /
 * daily_chat_reset_at — that cap is flat and plan-independent, so an
 * upgrade has no reason to reset it.
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
      chat_messages_used: 0,
      flashcards_used: 0,
      remediation_used: 0,
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
