/**
 * Retries a dynamic import() a few times before giving up.
 *
 * Mobile networks drop chunk requests regularly, and a chunk that failed once
 * is NOT cached as failed by webpack — calling import() again re-requests it.
 * Without this, one dropped request was enough to break "Afficher le cours"
 * (or trigger the dashboard's full-page chunk-error reload).
 *
 * A chunk that 404s for good (the app was redeployed while this tab stayed
 * open, so the old hashed file no longer exists) still fails after the last
 * attempt; callers show a "reload" fallback for that case.
 */
export function loadWithRetry<T>(load: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  return load().catch(
    (error: unknown) =>
      new Promise<T>((resolve, reject) => {
        if (attempts <= 1) {
          reject(error);
          return;
        }
        setTimeout(() => loadWithRetry(load, attempts - 1, delayMs * 2).then(resolve, reject), delayMs);
      })
  );
}
