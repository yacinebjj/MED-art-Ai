/**
 * ============================================================================
 * ⚠️  ARCHITECTURAL WARNING — NOT A GLOBAL RATE LIMIT ON MULTI-INSTANCE DEPLOYS
 * ============================================================================
 * This is an in-memory `Map`, scoped to ONE Node process. It is a correct,
 * hard limit ONLY as long as this app runs as a single long-lived process
 * (e.g. `next start` on one machine/container, or local dev).
 *
 * The moment this deploys anywhere that runs more than one instance
 * concurrently — Vercel serverless functions (a fresh instance per cold
 * start, and multiple warm instances under concurrent load), a
 * multi-replica container deployment, PM2 cluster mode — each instance gets
 * its OWN independent `buckets` Map. A student's requests get load-balanced
 * across instances, and EACH instance separately allows up to `limit`
 * requests before blocking. The real effective ceiling becomes
 * `limit × (number of instances that happen to serve this key)`, not
 * `limit`. This directly compounds the quota-reservation fix in
 * lib/subscription.ts — that fix closes the race WITHIN one process; it
 * does nothing to stop the same burst from hitting N processes at once.
 *
 * Fix: swap this file's `buckets` Map for `@upstash/ratelimit` +
 * `@upstash/redis` (or any shared store) — every call site below
 * (`rateLimit(key, config)`) already takes the same (key, config) shape, so
 * the swap is contained to this one file. Skeleton:
 *
 *   // import { Ratelimit } from "@upstash/ratelimit";
 *   // import { Redis } from "@upstash/redis";
 *   //
 *   // const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / _TOKEN
 *   // const limiters = new Map<string, Ratelimit>(); // one per distinct RATE_LIMITS config
 *   //
 *   // function getLimiter(config: RateLimitConfig): Ratelimit {
 *   //   const cacheKey = `${config.limit}:${config.windowMs}`;
 *   //   let limiter = limiters.get(cacheKey);
 *   //   if (!limiter) {
 *   //     limiter = new Ratelimit({
 *   //       redis,
 *   //       limiter: Ratelimit.slidingWindow(config.limit, `${config.windowMs} ms`),
 *   //     });
 *   //     limiters.set(cacheKey, limiter);
 *   //   }
 *   //   return limiter;
 *   // }
 *   //
 *   // export async function rateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
 *   //   const { success, remaining, reset } = await getLimiter(config).limit(key);
 *   //   return { allowed: success, remaining, resetAt: reset };
 *   // }
 *
 * Note this makes `rateLimit` async — every call site (`await rateLimit(...)`
 * already, since most are inside async route handlers) would need auditing,
 * not just this function. Not done now: this project doesn't currently
 * deploy multi-instance, and adding a Redis dependency + async surface
 * change is a real infrastructure decision, not a drop-in fix to make
 * silently. Flagged here so it's a deliberate choice when this app scales
 * past one process, not a surprise.
 * ============================================================================
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Cheap, amortized cleanup instead of a per-request sweep or a setInterval
// (which would keep a serverless instance alive) — piggybacks on whatever
// request happens to run after the interval has elapsed.
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function sweepExpired(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitConfig {
  /** Max requests allowed within the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Epoch ms when the window resets — use to compute a Retry-After header. */
  resetAt: number;
}

/** Fixed-window counter keyed by whatever string the caller provides (typically `${routeName}:${userId}`). */
export function rateLimit(key: string, { limit, windowMs }: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  sweepExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Named presets so every route shares the same tuned numbers instead of picking its own. Adjust here, not per-route. */
export const RATE_LIMITS = {
  /** Routes that trigger a real, billed AI call (OpenRouter/Ideogram/embeddings): chat, section generation, course/mind-map creation. */
  ai: { limit: 20, windowMs: 5 * 60 * 1000 },
  /** Plain-write mutations with no AI cost: create module, rename/delete a course. */
  mutation: { limit: 30, windowMs: 5 * 60 * 1000 },
  /** Group chat message sends — a real conversation legitimately fires far more often than an ordinary mutation, so this gets its own, looser bucket instead of starving normal chatting under `mutation`'s cap. */
  chatMessage: { limit: 120, windowMs: 5 * 60 * 1000 },
  /** app/api/dashboard-assistant/route.ts's free-tier (":free" models) assistant — per-student, so one student can't alone consume a disproportionate share of the shared daily ceiling in lib/platform-spend-guard.ts's reserveDashboardAssistantCapacity. */
  freeAssistant: { limit: 15, windowMs: 60 * 1000 },
  /** app/api/lecture-notes/transcribe-chunk/route.ts — one real billed OpenRouter call PER CHUNK of a single lecture upload (~15 chunks for a 2h recording at 8 min/chunk), genuinely more calls per legitimate use than RATE_LIMITS.ai's single-call-per-feature-use routes. Not individually quota-gated via reserveGeneration (see that route's own comment) — this rate limit is this endpoint's only real cost guardrail. */
  lectureChunk: { limit: 40, windowMs: 10 * 60 * 1000 },
  /**
   * The background-job "start-or-check-status" endpoints for Explication
   * (app/api/studio/generate/explication-part) and Podcast
   * (app/api/studio/podcast) — see lib/studio-job-store.ts's own header
   * comment. lib/poll-fetch.ts's startAndPoll calls the SAME endpoint every
   * ~3 seconds for up to several minutes while a background job runs, which
   * is legitimately ~100+ requests per generation — RATE_LIMITS.ai's 20/5min
   * (sized for one-call-per-feature-use routes) would block a normal poll
   * loop within its first ~60 seconds. This gate covers every request to
   * these routes (claims AND polls); the actual AI-call-triggering "claim a
   * new job" branch inside each route ALSO checks RATE_LIMITS.ai separately,
   * right before kicking off the real generation — so cost-relevant abuse
   * is still bounded at the original, tighter limit, while routine polling
   * traffic isn't.
   */
  poll: { limit: 150, windowMs: 5 * 60 * 1000 },
} satisfies Record<string, RateLimitConfig>;

/** Seconds until the window resets, for a Retry-After header. */
export function retryAfterSeconds(result: RateLimitResult): number {
  return Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
}
