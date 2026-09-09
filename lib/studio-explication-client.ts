"use client";

import { postJsonWithHeartbeat } from "@/lib/heartbeat-fetch";

/**
 * Browser-side driver for the client-driven, multi-request Explication
 * pipeline — see lib/studio-explication-delta.ts's ARCHITECTURE comment and
 * app/api/studio/generate/explication-start/route.ts's own header comment
 * for the full rationale (replaces a single in-process server call/loop that
 * was the real cause of repeated "échec de génération" + truncation on long
 * "ultra-détaillée" generations: a multi-minute generation could not
 * reliably survive Vercel's own real serverless duration ceiling, which can
 * be far tighter than this app's own `maxDuration` config).
 *
 * Three-step contract, in order:
 *  1. POST explication-start EXACTLY ONCE, never retried by this driver.
 *     Either resolves the whole generation immediately (cache hit /
 *     cross-university-delta — `needsFinalize: false`), or reserves quota
 *     and returns `{reserved: true, totalParts}`. A code review caught a
 *     real quota-integrity bug in an earlier version where this reservation
 *     step WAS retried (bundled with the slow AI call) — reserving 2-3x
 *     courseCap for one delivered generation. Never retrying this call, and
 *     only ever treating a reservation as real when this call explicitly
 *     confirms it, is what closes that.
 *  2. POST explication-part sequentially, one bounded (~60s) HTTP request
 *     per part, with automatic retry on any clean, retryable failure — safe
 *     to retry freely because this route never touches quota (see its own
 *     header comment). Each retry only ever redoes the ONE part that
 *     failed, never the whole generation.
 *  3. POST explication-finalize once, only if step 1 returned
 *     `needsFinalize: true` — assembles + persists the collected parts.
 *
 * If the whole flow gives up (step 1 failed, or step 2/3 exhausted every
 * retry), calls explication-abandon EXACTLY ONCE, but ONLY when step 1
 * explicitly confirmed `reserved: true` — never when step 1 itself failed
 * (nothing to refund) or was never reached (a pure network failure before
 * any response arrived).
 */

export interface ExplicationGenerationResult {
  success: boolean;
  data?: unknown;
  cached?: boolean;
  cacheMode?: string;
  error?: string;
}

export interface ExplicationGenerationProgress {
  partIndex: number; // 0-based, the part currently in flight
  totalParts: number;
  attempt: number; // 1-based attempt number for THIS part
}

const MAX_PART_ATTEMPTS = 3;
const PART_RETRY_DELAYS_MS = [2000, 5000];
// Each client-side timeout is kept ABOVE its route's own `maxDuration`
// (explication-start=15s, explication-part=280s, explication-finalize=60s —
// see each route's own file for why) — deliberately, and not merely
// generous headroom: explication-start is never retried by this driver (see
// this file's header comment), so if the client gave up BEFORE the server
// could possibly finish, it would have no way to know whether a reservation
// happened right as it stopped waiting, exactly the kind of ambiguous-
// outcome window this whole redesign exists to minimize. Letting the client
// always wait at least as long as the server's own hard ceiling means a
// genuine platform kill (not a client-side impatience) is the only way this
// ambiguity can still occur. PART_FETCH_TIMEOUT_MS in particular was a real,
// repeated production bug when it sat at 70s while explication-part could
// legitimately run close to that — an empirical test proved this project's
// real Vercel ceiling is 250s+, so explication-part's own maxDuration was
// raised to 280s, and this must stay comfortably above THAT, not the old
// value.
const START_FETCH_TIMEOUT_MS = 70_000;
const PART_FETCH_TIMEOUT_MS = 290_000;
const FINALIZE_FETCH_TIMEOUT_MS = 70_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 4xx client errors (bad request, forbidden/quota) are never retried —
 * retrying the exact same broken request just wastes attempts and delays
 * the real error reaching the student. Everything else (network failure,
 * 5xx, a clean timeout) is retryable.
 *
 * 401 IS THE ONE DELIBERATE EXCEPTION, added after a real, confirmed
 * production incident matching this exact symptom on mobile: a persistent
 * "échec de génération" with no truncation and no timeout involved. See
 * lib/supabase/session-server.ts's own header comment for the full
 * mechanism — Supabase rotates refresh tokens on use (single-use), so TWO
 * genuinely concurrent authenticated requests sharing the same
 * not-yet-refreshed session cookie (this app's own architecture explicitly
 * allows a Studio generation to keep running in the background while the
 * student navigates elsewhere or opens another tile — see
 * trackGeneration's "survives navigation" design) can race: one wins and
 * gets a fresh rotated cookie written back to the browser, the other
 * hard-fails with "Invalid Refresh Token: Already Used". That failure is
 * PERMANENT for the token that just died, but NOT for the session as a
 * whole — the browser's cookie has already been updated by the winning
 * response by the time a retry (after this file's own 2s/5s backoff) fires,
 * so simply trying again, now carrying the browser's current cookie, is
 * genuinely likely to succeed rather than repeat the same failure. Treating
 * 401 as a hard, permanent stop (the previous behavior) meant losing the
 * WHOLE multi-minute generation to a one-time, self-resolving race that a
 * single retry would have survived.
 */
function isRetryable(status: number): boolean {
  return status === 0 || status === 401 || status >= 500;
}

async function abandon(courseId: number): Promise<void> {
  try {
    await postJson("/api/studio/generate/explication-abandon", { courseId }, 15_000);
  } catch {
    // Best-effort — a failed refund call must never mask the real error
    // already being returned to the caller below.
  }
}

/**
 * Minimal wrapper around the standard Screen Wake Lock API
 * (https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) —
 * added defensively after a real production report of "échec de génération"
 * on mobile specifically (not PC), for the exact same course pipeline. This
 * flow is a SEQUENTIAL chain of several multi-minute HTTP round-trips (real,
 * measured per-call latency is 100s of seconds even on a clean success — see
 * PART_FETCH_TIMEOUT_MS's own comment), easily totaling several minutes to
 * 10+ minutes for a multi-part course — a well-documented risk window for a
 * mobile browser to suspend/throttle a backgrounded tab's JS/network the
 * moment the student's screen locks, which no amount of server-side retrying
 * can help once the WHOLE page execution context is suspended, not just one
 * request. Requesting a wake lock keeps the screen on for the duration of
 * this call, removing the single most common reason a student's screen would
 * lock during a long wait. Feature-detected and best-effort throughout: a
 * browser without support (or a user who denies it) just gets no wake lock,
 * never an error — this is a defensive improvement, not a load-bearing
 * requirement for correctness.
 */
async function acquireWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return null;
    return await nav.wakeLock.request("screen");
  } catch {
    return null;
  }
}

export async function generateExplicationInParts(
  courseId: number,
  extra: { language?: string; customPrompt?: string } = {},
  onProgress?: (progress: ExplicationGenerationProgress) => void
): Promise<ExplicationGenerationResult> {
  const wakeLock = await acquireWakeLock();
  try {
    return await runGenerationInParts(courseId, extra, onProgress);
  } finally {
    await wakeLock?.release().catch(() => {});
  }
}

async function runGenerationInParts(
  courseId: number,
  extra: { language?: string; customPrompt?: string },
  onProgress?: (progress: ExplicationGenerationProgress) => void
): Promise<ExplicationGenerationResult> {
  // Step 1 — reserve, exactly once, never retried FOR AMBIGUOUS OUTCOMES.
  // See this file's header comment for why a 5xx/network failure here is
  // never safely retryable (a reservation may have already happened,
  // server-side, before the response was lost). A 401 is the ONE
  // unambiguous exception: getAuthenticatedUser() is the very first thing
  // explication-start's route handler does, before touching quota/cache/
  // anything else, so a 401 here PROVES no reservation was even attempted —
  // there is nothing an unambiguous, one-time retry could double-charge.
  // Added after a confirmed production incident (see isRetryable's own
  // comment for the full mechanism: a genuinely-concurrent request racing
  // this app's own Supabase refresh-token rotation) — a single 401 here used
  // to permanently fail the whole flow before it ever started, even though
  // the browser's session cookie is very likely already valid again by the
  // time a short, deliberate retry fires.
  let startOutcome: { ok: boolean; status: number; data: Record<string, unknown> };
  try {
    startOutcome = await postJson("/api/studio/generate/explication-start", { courseId, ...extra }, START_FETCH_TIMEOUT_MS);
    if (startOutcome.status === 401) {
      await wait(1500);
      startOutcome = await postJson("/api/studio/generate/explication-start", { courseId, ...extra }, START_FETCH_TIMEOUT_MS);
    }
  } catch (error) {
    // Never reached the server (or the response never arrived) — no
    // confirmation of a reservation exists, so no abandon() call either.
    return { success: false, error: error instanceof Error ? error.message : "Erreur réseau." };
  }
  const startData = startOutcome.data;
  if (!startOutcome.ok || startData.success !== true) {
    // A clean error RESPONSE did arrive — explication-start's own contract
    // guarantees it already self-refunded internally for every path that
    // reserves-then-fails (see that route's header comment), so still no
    // abandon() call here.
    return { success: false, error: typeof startData.error === "string" ? startData.error : "La génération a échoué." };
  }
  if (startData.needsFinalize === false) {
    // Fully resolved by start itself (cache hit / cross-university-delta) —
    // nothing left to do.
    return {
      success: true,
      data: startData.partMarkdown,
      cached: Boolean(startData.servedFromCache),
      cacheMode: typeof startData.cacheMode === "string" ? startData.cacheMode : undefined,
    };
  }
  // From here on, a reservation is confirmed to exist — abandon() is now the
  // correct thing to call if the rest of the flow fails.
  const totalParts = typeof startData.totalParts === "number" ? startData.totalParts : 1;
  const parts: string[] = [];

  for (let partIndex = 0; partIndex < totalParts; partIndex++) {
    let lastError = "La génération a échoué.";
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && !succeeded; attempt++) {
      onProgress?.({ partIndex, totalParts, attempt });

      let outcome: { ok: boolean; status: number; data: Record<string, unknown> };
      try {
        outcome = await postJsonWithHeartbeat("/api/studio/generate/explication-part", { courseId, partIndex, ...extra }, PART_FETCH_TIMEOUT_MS);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Erreur réseau.";
        if (attempt < MAX_PART_ATTEMPTS) await wait(PART_RETRY_DELAYS_MS[attempt - 1] ?? 5000);
        continue;
      }

      if (!outcome.ok || outcome.data.success !== true) {
        lastError = typeof outcome.data.error === "string" ? outcome.data.error : `Erreur ${outcome.status}.`;
        if (isRetryable(outcome.status) && attempt < MAX_PART_ATTEMPTS) {
          await wait(PART_RETRY_DELAYS_MS[attempt - 1] ?? 5000);
          continue;
        }
        break;
      }

      succeeded = true;
      parts.push(String(outcome.data.partMarkdown ?? ""));
    }

    if (!succeeded) {
      await abandon(courseId);
      return { success: false, error: lastError };
    }
  }

  // Every part succeeded via genuine fresh generation — assemble + persist.
  // Retried on the same terms as a part (see isRetryable's own comment,
  // 401 included) — this is the single most expensive point to lose the
  // whole flow to a transient failure, since every part's real, billed
  // generation work is already done; finalize is a pure DB write + a
  // re-send of already-collected text, so retrying it is always safe
  // (never re-runs any AI call, never re-reserves quota).
  try {
    let finalizeOutcome: { ok: boolean; status: number; data: Record<string, unknown> } | null = null;
    let finalizeError = "La finalisation a échoué.";
    for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
      finalizeOutcome = await postJson("/api/studio/generate/explication-finalize", { courseId, parts, ...extra }, FINALIZE_FETCH_TIMEOUT_MS);
      if (finalizeOutcome.ok && finalizeOutcome.data.success === true) break;
      finalizeError = typeof finalizeOutcome.data.error === "string" ? finalizeOutcome.data.error : `Erreur ${finalizeOutcome.status}.`;
      if (isRetryable(finalizeOutcome.status) && attempt < MAX_PART_ATTEMPTS) {
        await wait(PART_RETRY_DELAYS_MS[attempt - 1] ?? 5000);
        continue;
      }
      break;
    }
    if (!finalizeOutcome || !finalizeOutcome.ok || finalizeOutcome.data.success !== true) {
      await abandon(courseId);
      return { success: false, error: finalizeError };
    }
    return {
      success: true,
      data: finalizeOutcome.data.data,
      cached: false,
      cacheMode: typeof finalizeOutcome.data.cacheMode === "string" ? finalizeOutcome.data.cacheMode : undefined,
    };
  } catch (error) {
    await abandon(courseId);
    return { success: false, error: error instanceof Error ? error.message : "La finalisation a échoué." };
  }
}
