"use client";

/**
 * Single-use hand-off of GET responses requested during the launch warm-up
 * (components/pwa/AppWarmup.tsx), so the first visit to a module page reads
 * data that is already in flight or arrived instead of starting from zero.
 * Each warmed response is consumed at most once and expires quickly, so a
 * page never shows data older than WARM_TTL_MS; every later call is a plain
 * fetch.
 */

const WARM_TTL_MS = 90_000;
const warmed = new Map<string, { at: number; response: Promise<Response> }>();

export function warmGet(url: string): void {
  if (warmed.has(url)) return;
  const response = fetch(url, { credentials: "same-origin" });
  response.catch(() => warmed.delete(url));
  warmed.set(url, { at: Date.now(), response });
}

export function fetchWarm(url: string): Promise<Response> {
  const entry = warmed.get(url);
  warmed.delete(url);
  if (entry && Date.now() - entry.at < WARM_TTL_MS) {
    return entry.response.catch(() => fetch(url));
  }
  return fetch(url);
}
