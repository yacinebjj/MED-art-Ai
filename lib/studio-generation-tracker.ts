/**
 * Point 6 fix — the REAL bug behind "generation aborts when I navigate
 * away": it doesn't, server-side (/api/studio/generate saves atomically
 * BEFORE responding, regardless of whether the client is still around to
 * read the response). What actually breaks is purely client-side: the
 * "generating" spinner lives in app/dashboard/module/[id]/page.tsx's own
 * React state, which resets to empty the moment that page component
 * unmounts (any SPA navigation away from it). Coming back shows the tile as
 * neither generating nor done — indistinguishable from "it failed" — and a
 * student who believes that and clicks "Générer" again triggers a SECOND
 * real, paid generation call for the exact same section.
 *
 * Fix: track in-flight generations in this module-scoped Map, which lives
 * for as long as the page's JS context does (i.e. survives any SPA
 * navigation/remount, only reset by a real full reload/tab close — the one
 * case nothing client-side can survive anyway). No new dependency (no
 * Zustand): a plain Map + the actual in-flight Promise IS the "global
 * store" the fix needs — every `await`/`.then()` on the SAME promise object
 * resolves with the same value once it settles, so a freshly (re)mounted
 * page can just attach to the exact promise a previous mount started,
 * instead of needing a separate pub/sub mechanism.
 */

export type GenerationKey = `${number}:${string}`;

function makeKey(courseId: number, section: string): GenerationKey {
  return `${courseId}:${section}`;
}

const inFlight = new Map<GenerationKey, Promise<void>>();

/** Registers a generation as in-flight — call this the moment the request starts, before awaiting it. The entry is removed automatically once `promise` settles (resolves OR rejects). */
export function trackGeneration(courseId: number, section: string, promise: Promise<void>): void {
  const key = makeKey(courseId, section);
  inFlight.set(key, promise);
  promise.finally(() => {
    // Only clear if this is still the SAME promise — a defensive guard
    // against the (currently impossible, but cheap to guard) case of two
    // overlapping registrations for the same key.
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
}

/** Returns the tracked in-flight promise for this (course, section), or `undefined` if nothing is running. A caller can `.then()`/`await` it to learn exactly when it settles — the real generation may have been started by an entirely different, since-unmounted page instance. */
export function getInFlightGeneration(courseId: number, section: string): Promise<void> | undefined {
  return inFlight.get(makeKey(courseId, section));
}
