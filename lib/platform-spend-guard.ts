/**
 * Platform-wide circuit breaker on real (cache-miss) OpenRouter generations
 * — distinct from every per-user quota in lib/subscription.ts, which caps
 * ONE student's own usage. A launch-day burst of many new accounts, each
 * safely under their own individual monthly cap, can still add up to an
 * unpredictable, unbounded TOTAL bill on any given day — this is the direct
 * fix for that specific cash-flow risk, not a per-student throttle.
 *
 * Call reservePlatformCapacity() ONCE per route, at the exact same point a
 * per-user quota is normally reserved: after a cache-miss is confirmed, right
 * before the real OpenRouter call. A cache HIT must never reach this — it
 * costs nothing and doesn't compete for the ceiling.
 *
 * Fails open by construction, exactly like every other quota gate in this
 * codebase: any Supabase/RPC failure here allows the request through rather
 * than blocking a student over an infrastructure hiccup in the safety net
 * itself. Skipped entirely in local dev (NODE_ENV === "development"),
 * mirroring lib/subscription.ts's reserveQuota — a dev session's test calls
 * shouldn't burn down a shared production-style daily counter.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

// No hardcoded number here is "correct" — this depends entirely on your
// actual OpenRouter budget for the day (how much you're willing to risk on
// the worst case). Set DAILY_GENERATION_CEILING in your environment once you
// know your real per-generation cost range (this session's own numbers: a
// chat message runs roughly $0.003-0.005, a full Studio section roughly
// $0.05-0.20 depending on which one) — pick a ceiling you'd genuinely be
// comfortable seeing hit on your card. This default (500) is a placeholder,
// not a recommendation.
const DEFAULT_DAILY_CEILING = 500;

export interface PlatformCapacityResult {
  allowed: boolean;
  reason?: string;
}

function todayDateString(): string {
  // A calendar date (YYYY-MM-DD), not a timestamp — reserve_platform_generation
  // keys one row per day; the exact reset moment is "midnight UTC of the
  // server", same simplicity tradeoff already accepted elsewhere in this
  // codebase (no timezone-aware "midnight in Algeria" logic).
  return new Date().toISOString().slice(0, 10);
}

/**
 * Reserves one unit against today's platform-wide generation ceiling.
 * Returns `{ allowed: false, reason }` ONLY when the ceiling has genuinely
 * been reached for today — the caller should return `reason` to the student
 * as a friendly 503-style message instead of proceeding to the real
 * OpenRouter call. There is no refund path (unlike per-user quotas): this
 * counts REQUESTS ATTEMPTED at capacity-limited moments, not confirmed
 * spend, so a request that reserves capacity and then fails downstream
 * still correctly reflects that the platform was near its ceiling when it
 * was attempted.
 */
export async function reservePlatformCapacity(): Promise<PlatformCapacityResult> {
  if (!isSupabaseConfigured()) return { allowed: true };
  if (process.env.NODE_ENV === "development") return { allowed: true };

  const cap = Number(process.env.DAILY_GENERATION_CEILING) || DEFAULT_DAILY_CEILING;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("reserve_platform_generation", {
      p_date: todayDateString(),
      p_cap: cap,
    });

    if (error) {
      console.error("[platform-spend-guard] Échec réservation — fail-open (autorisé):", error.message);
      return { allowed: true };
    }
    if (data === null) {
      console.warn(`[platform-spend-guard] 🔴 Plafond quotidien plateforme atteint (${cap} générations) — nouvelle génération refusée.`);
      return {
        allowed: false,
        reason: "Notre plateforme connaît une forte affluence aujourd'hui — réessaie dans quelques heures.",
      };
    }
    return { allowed: true };
  } catch (error) {
    console.error("[platform-spend-guard] Exception — fail-open (autorisé):", error instanceof Error ? error.message : error);
    return { allowed: true };
  }
}

/**
 * Shared daily ceiling for EVERY route on the free-tier (":free"-suffixed)
 * model chain (lib/ai/openrouter.ts's FREE_MODEL_CHAIN) — currently
 * app/api/dashboard-assistant/route.ts AND app/api/courses/chat/route.ts
 * (plus lib/cache-prewarming.ts's pre-generation pass). A DIFFERENT kind of
 * constraint from reservePlatformCapacity above: this isn't about dollars,
 * it's that OpenRouter's free models carry their own hard, EXTERNAL,
 * account-wide daily request cap (verified live against OpenRouter's docs:
 * 20 req/min always; 1000 req/day once the account has purchased ≥10
 * credits lifetime — already true here, since this account already spends
 * real money elsewhere — 50/day otherwise).
 *
 * MUST be called by every caller of FREE_MODEL_CHAIN, and only ONE counter
 * for all of them combined — that external cap is a single account-wide
 * bucket, not one per feature. Two features each independently reserving
 * their own 800/day would let combined real traffic reach 1600/day, well
 * past the actual 1000/day OpenRouter enforces — this table/function name
 * kept its original "dashboard_assistant" naming (no migration needed to
 * rename it) even though its scope grew; nothing about the name is
 * dashboard-assistant-specific anymore, it's just history.
 *
 * DEFAULT_DAILY_CEILING is set BELOW the real 1000/day external cap
 * (deliberately, with real margin) so this app self-throttles with one
 * calm, friendly message before OpenRouter itself starts hard-429ing
 * unpredictably once the actual external limit is hit.
 */
const FREE_TIER_DEFAULT_DAILY_CEILING = 800;

export async function reserveFreeTierCapacity(): Promise<PlatformCapacityResult> {
  if (!isSupabaseConfigured()) return { allowed: true };
  if (process.env.NODE_ENV === "development") return { allowed: true };

  const cap = Number(process.env.DASHBOARD_ASSISTANT_DAILY_CEILING) || FREE_TIER_DEFAULT_DAILY_CEILING;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("reserve_dashboard_assistant_request", {
      p_date: todayDateString(),
      p_cap: cap,
    });

    if (error) {
      console.error("[platform-spend-guard] Échec réservation modèle gratuit — fail-open (autorisé):", error.message);
      return { allowed: true };
    }
    if (data === null) {
      console.warn(`[platform-spend-guard] 🔴 Plafond quotidien des modèles gratuits atteint (${cap} requêtes, tous usages confondus).`);
      return {
        allowed: false,
        reason: "Les modèles gratuits ont atteint leur capacité pour aujourd'hui — réessaie dans quelques heures.",
      };
    }
    return { allowed: true };
  } catch (error) {
    console.error("[platform-spend-guard] Exception assistant gratuit — fail-open (autorisé):", error instanceof Error ? error.message : error);
    return { allowed: true };
  }
}
