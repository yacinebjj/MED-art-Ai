/**
 * Generates a UUID-v4-shaped string id, safe to call in any context.
 *
 * `crypto.randomUUID()` only exists in a "secure context" (HTTPS, or
 * localhost) — the browser doesn't expose it at all when the app is loaded
 * over plain HTTP on a LAN/local IP (e.g. testing on a phone against the
 * dev machine's IP). Calling it there throws `TypeError: crypto.randomUUID
 * is not a function`, an uncaught runtime crash.
 *
 * This falls back to a manual Math.random-based UUID v4 in that case. That
 * fallback is not cryptographically secure, but these ids are only ever
 * used as temporary React/DB object identifiers, never as secrets, so that
 * tradeoff is fine.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
