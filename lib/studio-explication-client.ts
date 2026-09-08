"use client";

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
// (explication-start/-part/-finalize are all 60s) — deliberately, and not
// merely generous headroom: explication-start is never retried by this
// driver (see this file's header comment), so if the client gave up BEFORE
// the server could possibly finish, it would have no way to know whether a
// reservation happened right as it stopped waiting, exactly the kind of
// ambiguous-outcome window this whole redesign exists to minimize. Letting
// the client always wait at least as long as the server's own hard ceiling
// means a genuine platform kill (not a client-side impatience) is the only
// way this ambiguity can still occur.
const START_FETCH_TIMEOUT_MS = 70_000;
const PART_FETCH_TIMEOUT_MS = 70_000;
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

/** 4xx client errors (bad request, auth, forbidden/quota) are never retried — retrying the exact same broken request just wastes attempts and delays the real error reaching the student. Everything else (network failure, 5xx, a clean timeout) is retryable. */
function isRetryable(status: number): boolean {
  return status === 0 || status >= 500;
}

async function abandon(courseId: number): Promise<void> {
  try {
    await postJson("/api/studio/generate/explication-abandon", { courseId }, 15_000);
  } catch {
    // Best-effort — a failed refund call must never mask the real error
    // already being returned to the caller below.
  }
}

export async function generateExplicationInParts(
  courseId: number,
  extra: { language?: string; customPrompt?: string } = {},
  onProgress?: (progress: ExplicationGenerationProgress) => void
): Promise<ExplicationGenerationResult> {
  // Step 1 — reserve, exactly once, never retried. See this file's header
  // comment for why retrying this specific call is the one thing that must
  // never happen.
  let startOutcome: { ok: boolean; status: number; data: Record<string, unknown> };
  try {
    startOutcome = await postJson("/api/studio/generate/explication-start", { courseId, ...extra }, START_FETCH_TIMEOUT_MS);
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
        outcome = await postJson("/api/studio/generate/explication-part", { courseId, partIndex, ...extra }, PART_FETCH_TIMEOUT_MS);
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
  try {
    const finalizeOutcome = await postJson("/api/studio/generate/explication-finalize", { courseId, parts, ...extra }, FINALIZE_FETCH_TIMEOUT_MS);
    if (!finalizeOutcome.ok || finalizeOutcome.data.success !== true) {
      await abandon(courseId);
      return {
        success: false,
        error: typeof finalizeOutcome.data.error === "string" ? finalizeOutcome.data.error : "La finalisation a échoué.",
      };
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
