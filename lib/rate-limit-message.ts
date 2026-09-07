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

/** Reads Retry-After off a 429 Response and builds a ready-to-display message; falls back to the generic one if the header is missing/invalid (e.g. a non-429 error, or an older route that doesn't set it). */
export function buildRateLimitMessage(res: Response, fallback = "Trop de requêtes — réessaie dans quelques minutes."): string {
  const header = res.headers.get("Retry-After");
  const seconds = header ? Number(header) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return `Trop de requêtes — réessaie dans ${formatRetryAfter(seconds)}.`;
}
