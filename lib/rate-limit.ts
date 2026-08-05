/**
 * In-memory rate limiter — no Redis/Upstash in this project, so this trades
 * cross-instance/cross-cold-start accuracy for zero added infrastructure.
 * Fine for a single long-lived Node process; on a multi-instance serverless
 * deployment each instance enforces its own independent counter, so the
 * effective ceiling becomes limit × instance count rather than a hard global
 * cap. Upgrade to `@upstash/ratelimit` + `@upstash/redis` if/when that
 * matters — the call sites below (`rateLimit(key, config)`) are written so
 * that swap only touches this one file.
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
} satisfies Record<string, RateLimitConfig>;

/** Seconds until the window resets, for a Retry-After header. */
export function retryAfterSeconds(result: RateLimitResult): number {
  return Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
}
