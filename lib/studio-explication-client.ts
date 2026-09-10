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
 *     and returns `{reserved: true, totalParts}`. A code review
 *     caught a real quota-integrity bug in an earlier version where this
 *     reservation step WAS retried (bundled with the slow AI call) —
 *     reserving 2-3x courseCap for one delivered generation. Never retrying
 *     this call, and only ever treating a reservation as real when this
 *     call explicitly confirms it, is what closes that.
 *  2. For each part: POST explication-part, which streams a heartbeat over
 *     one held-open connection for the whole real ~100-260+ second
 *     generation time (see that route's own header comment for the full,
 *     three-architecture history behind why this — not a background-job/
 *     poll design — is the one actually proven reliable). Automatic retry
 *     on any clean, retryable failure — safe to retry freely because this
 *     route never touches quota (see its own header comment). Each retry
 *     only ever redoes the ONE part that failed, never the whole generation.
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
  attempt: number; // 1-based attempt number for THIS sub-part
  /** 0-based index of the sub-piece in flight, when a part has been subdivided after a timeout (see generateOnePart). */
  subPartIndex: number;
  /** How many pieces this part is currently split into — 1 means "not subdivided". */
  subPartCount: number;
  /** True while this is a RETRY (attempt > 1) or a post-timeout subdivision — lets the UI say "je réessaie" instead of looking frozen. */
  isRecovering: boolean;
}

const MAX_PART_ATTEMPTS = 3;
// Exponential backoff (2s, 6s, 18s) rather than the previous near-flat
// 2s/5s — a retry that fires while the upstream provider is still degraded
// just burns another full attempt against the same condition.
const PART_RETRY_BASE_DELAY_MS = 2000;
const PART_RETRY_BACKOFF_FACTOR = 3;

/**
 * How far a single part may be subdivided after timing out: 1 (whole) -> 2
 * (halves) -> 4 (quarters). A 504 means the model could not finish THIS much
 * source inside the time budget, so re-requesting the identical slice is
 * very likely to hit the identical wall — this codebase learned that the
 * hard way ("every retry, a fresh attempt at the identical slice, hits the
 * identical wall, since this is real generation time, not a random flake").
 * Asking for strictly less work per invocation is the only retry that
 * actually changes the odds.
 */
const MAX_SUBDIVISION = 4;

function backoffDelayMs(attempt: number): number {
  return PART_RETRY_BASE_DELAY_MS * Math.pow(PART_RETRY_BACKOFF_FACTOR, attempt - 1);
}
// explication-start/-finalize are still plain, synchronous request/response
// calls (fast — DB reads/writes only, no AI call) — each client-side
// timeout is kept ABOVE its route's own `maxDuration` (explication-start=
// 15s, explication-finalize=60s), same margin discipline as everywhere else
// in this app: explication-start is never retried by this driver (see this
// file's header comment), so if the client gave up BEFORE the server could
// possibly finish, it would have no way to know whether a reservation
// happened right as it stopped waiting.
const START_FETCH_TIMEOUT_MS = 70_000;
const FINALIZE_FETCH_TIMEOUT_MS = 70_000;
// explication-part streams heartbeats over one held-open connection for the
// whole real generation time (see that route's own header comment for why
// this — not a background-job/poll design — is the architecture actually
// proven reliable this session). Kept comfortably above the route's own
// maxDuration=280 so a genuine platform kill (not client impatience) is the
// only way this client-side timeout fires first.
const PART_FETCH_TIMEOUT_MS = 300_000;

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
 * on mobile specifically (not PC), for the exact same course pipeline. The
 * overall flow still spans several minutes to 10+ minutes for a multi-part
 * course while the student waits —
 * requesting a wake lock keeps the screen on for that duration, a cheap,
 * well-supported mitigation against a mobile browser throttling a
 * backgrounded tab if the student's screen locks mid-wait. Feature-detected
 * and best-effort throughout: a browser without support (or a user who
 * denies it) just gets no wake lock, never an error — this is a defensive
 * improvement, not a load-bearing requirement for correctness.
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

type OnePartOutcome = { ok: true; markdown: string } | { ok: false; error: string };

/**
 * Generates ONE part, with two distinct recovery strategies chosen by what
 * actually went wrong — this is the "make the frontend actually resilient"
 * layer, and the distinction matters more than the retry count:
 *
 *  - A TIMEOUT (504, the server's own AbortController firing because the
 *    model could not finish this much source in time) is NOT retried
 *    identically. Re-sending the same slice hits the same wall for the same
 *    reason — it is real generation time, not a flake. Instead the part is
 *    subdivided (whole -> halves -> quarters) and the pieces are generated
 *    sequentially and concatenated. Each piece is strictly less work, so
 *    each is strictly likelier to land inside the budget.
 *  - Any OTHER retryable failure (network drop, 5xx, the single-use-refresh-
 *    token 401 race) IS retried identically, with exponential backoff —
 *    those genuinely are transient and the same request can succeed.
 *
 * Every attempt reports through onProgress with `isRecovering` set, so the
 * UI can show "je réessaie…" instead of sitting frozen for minutes. The
 * error returned on final give-up names how many attempts were actually
 * burned, so a future report can never again be ambiguous about whether
 * retries happened at all.
 */
async function generateOnePart(
  courseId: number,
  partIndex: number,
  totalParts: number,
  extra: { language?: string; customPrompt?: string },
  previousPartMarkdown: string | undefined,
  onProgress?: (progress: ExplicationGenerationProgress) => void
): Promise<OnePartOutcome> {
  let subPartCount = 1;
  let lastError = "La génération a échoué.";
  let totalAttempts = 0;

  for (;;) {
    const collected: string[] = [];
    let timedOut = false;
    let gaveUp = false;

    for (let subPartIndex = 0; subPartIndex < subPartCount && !timedOut && !gaveUp; subPartIndex++) {
      let subSucceeded = false;

      for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS && !subSucceeded; attempt++) {
        totalAttempts++;
        onProgress?.({
          partIndex,
          totalParts,
          attempt,
          subPartIndex,
          subPartCount,
          isRecovering: attempt > 1 || subPartCount > 1,
        });

        // postJsonWithHeartbeat never throws — every outcome, including a raw
        // network failure mid-stream, comes back as a normal result carrying a
        // `diagnostic` string (see lib/heartbeat-fetch.ts's own comment) so a
        // failure surfaced to the student names concretely what happened,
        // instead of another guess from a bare "échec de génération".
        //
        // previousPartTail — continuity context so a part doesn't restart a
        // chapter mid-stream (fixes the real "chapters get mixed up" report).
        // Within a subdivided part the previous SUB-piece is the truer
        // immediate context; only the first piece falls back to the previous
        // whole part.
        const previousPartTail = collected.length > 0 ? collected[collected.length - 1] : previousPartMarkdown;
        const outcome = await postJsonWithHeartbeat(
          "/api/studio/generate/explication-part",
          {
            courseId,
            partIndex,
            ...(subPartCount > 1 ? { subPartIndex, subPartCount } : {}),
            previousPartTail,
            ...extra,
          },
          PART_FETCH_TIMEOUT_MS
        );

        if (outcome.ok && outcome.data.success === true) {
          collected.push(String(outcome.data.partMarkdown ?? ""));
          subSucceeded = true;
          break;
        }

        const baseError = typeof outcome.data.error === "string" ? outcome.data.error : `Erreur ${outcome.status}.`;
        lastError = `${baseError} [${outcome.diagnostic}]`;

        // 504 = the server's own generation timeout. Subdividing is the only
        // retry that changes anything here, so break out and escalate rather
        // than burning the remaining identical attempts.
        if (outcome.status === 504) {
          timedOut = true;
          break;
        }

        if (isRetryable(outcome.status) && attempt < MAX_PART_ATTEMPTS) {
          await wait(backoffDelayMs(attempt));
          continue;
        }

        gaveUp = true;
        break;
      }
    }

    if (!timedOut && !gaveUp && collected.length > 0) {
      return { ok: true, markdown: collected.join("\n\n") };
    }
    if (gaveUp || !timedOut) {
      return { ok: false, error: `${lastError} (${totalAttempts} tentative(s))` };
    }

    // Timed out — escalate to smaller pieces, or stop if already at the floor.
    if (subPartCount >= MAX_SUBDIVISION) {
      return {
        ok: false,
        error: `${lastError} (${totalAttempts} tentative(s), découpage jusqu'à ${subPartCount} sous-parties)`,
      };
    }
    subPartCount *= 2;
    await wait(backoffDelayMs(1));
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
    const outcome = await generateOnePart(
      courseId,
      partIndex,
      totalParts,
      extra,
      parts[parts.length - 1],
      onProgress
    );

    if (!outcome.ok) {
      await abandon(courseId);
      return { success: false, error: outcome.error };
    }
    parts.push(outcome.markdown);
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
        await wait(backoffDelayMs(attempt));
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
