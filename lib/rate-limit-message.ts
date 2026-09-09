/**
 * Every AI-generation route already sends back a `Retry-After` header (in
 * seconds) on a 429 — see lib/rate-limit.ts's retryAfterSeconds, used by
 * app/api/studio/generate, app/api/studio/regenerate,
 * app/api/study/remediation-plan/generate, app/api/modules/[id]/global-summary,
 * etc. The frontend previously only ever showed the generic JSON `error`
 * string ("Trop de requêtes — réessaie dans quelques minutes."), never that
 * exact number — this turns it into a precise "Réessaie dans 45 secondes."
 * Client-safe, zero dependencies, so every fetch() call site can import it
 * without pulling in anything server-only.
 */
export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) {
    const n = Math.max(1, Math.round(seconds));
    return `${n} seconde${n > 1 ? "s" : ""}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

/**
 * Builds the same ready-to-display message directly from a seconds value —
 * for callers that don't have the raw `Response` object to read the header
 * off themselves, e.g. lib/heartbeat-fetch.ts's postJsonWithHeartbeat (a
 * heartbeat-streamed route's early 429 rejection still happens before any
 * streaming starts, so its Retry-After header is real, but the caller only
 * ever sees the parsed outcome, not the Response). Falls back to the
 * generic message if `seconds` is missing/invalid.
 */
export function buildRateLimitMessageFromSeconds(seconds: number | null | undefined, fallback = "Trop de requêtes — réessaie dans quelques minutes."): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  return `Trop de requêtes — réessaie dans ${formatRetryAfter(seconds)}.`;
}

/** Reads Retry-After off a 429 Response and builds a ready-to-display message; falls back to the generic one if the header is missing/invalid (e.g. a non-429 error, or an older route that doesn't set it). */
export function buildRateLimitMessage(res: Response, fallback = "Trop de requêtes — réessaie dans quelques minutes."): string {
  const header = res.headers.get("Retry-After");
  return buildRateLimitMessageFromSeconds(header ? Number(header) : null, fallback);
}
