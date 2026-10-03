/**
 * Stale-build recovery for long-lived sessions (installed PWA, a tab left
 * open across a deploy). After a new deployment the old build's JS chunks
 * are gone, so the NEXT client-side navigation of a still-running old build
 * fails to load the target route's code ("ChunkLoadError", "Loading chunk
 * 123 failed", "Failed to fetch dynamically imported module"…). The only
 * real fix is to load the new build: one silent reload of the current URL
 * (which is already the navigation's target), guarded so a genuinely broken
 * deploy can never put the app in a reload loop.
 */

const GUARD_KEY = "medart:chunk-reload-at";
/** At most one automatic reload per window — a second failure within it is a real error, shown to the student. */
const RELOAD_GUARD_MS = 30_000;

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
  return name === "ChunkLoadError" || CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(`${name} ${message}`));
}

/**
 * Reloads once to pick up the current deployment. Returns false (and does
 * nothing) when a reload already happened within RELOAD_GUARD_MS, or offline
 * (a reload would only show the browser's offline page).
 */
export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(GUARD_KEY) ?? "0");
    if (Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked: still reload once (no loop is possible without storage either,
    // since this path only runs again on a NEW chunk failure after the reload).
  }
  window.location.reload();
  return true;
}
