"use client";

/**
 * Shared client-side driver for a background-job API route — one that
 * answers almost instantly with `{status: "pending"|"done"|"error", ...}`
 * instead of holding a request open for the real (100+ second) work. See
 * lib/studio-job-store.ts's own header comment for the full server-side
 * mechanism and WHY this exists.
 *
 * REPLACES lib/heartbeat-fetch.ts's postJsonWithHeartbeat — a real
 * production incident showed the heartbeat-streamed approach ITSELF was
 * unreliable specifically on mobile: two separate attempts at "Explication
 * Ultra-Détaillée" both failed within 2-23 seconds having received ZERO
 * heartbeats, far too early for the idle-connection theory that motivated
 * heartbeating, and inconsistent between attempts (a clean stream end once,
 * a raw network exception once) — the signature of a long-lived HTTP
 * connection that's simply unreliable on that network path (very possibly a
 * carrier/proxy that buffers or otherwise mishandles a streamed response),
 * not a timing problem heartbeats could fix. Polling sidesteps this
 * entirely: no single request here ever needs to survive more than a few
 * seconds, so a flaky mobile connection costs at most one retried poll, not
 * the whole generation — the real work continues server-side (via
 * `waitUntil`) regardless of whether any particular poll succeeds.
 *
 * `startAndPoll` calls `url` repeatedly (every `pollIntervalMs`, each with
 * its own short, independent timeout) until the response's `status` field
 * is `"done"` or `"error"`, or `maxWaitMs` elapses. A single failed poll
 * (network exception, non-2xx early validation failure) is NOT fatal by
 * itself — the loop just waits and tries again, since the background work
 * this call is checking on isn't tied to any one poll's success.
 */
export interface PollOutcome {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  /** Parsed `Retry-After` header (seconds), only ever set when a poll itself came back as an early, non-2xx rejection (auth/rate-limit/validation) — see lib/rate-limit-message.ts's buildRateLimitMessageFromSeconds. `null` otherwise. */
  retryAfterSeconds: number | null;
  /**
   * Human-readable trace of what actually happened — elapsed time and how
   * many polls were made, so a failure surfaced to the student names
   * concretely what happened instead of another guess. See this file's own
   * header comment for the incident this discipline comes from.
   */
  diagnostic: string;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 20_000; // A single poll (a fast Storage read/write) hanging this long is itself a signal to just try again, not to wait longer.

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startAndPoll(url: string, body: Record<string, unknown>, maxWaitMs: number): Promise<PollOutcome> {
  const startedAt = Date.now();
  let pollCount = 0;
  const elapsed = () => `${Math.round((Date.now() - startedAt) / 1000)}s`;

  while (Date.now() - startedAt < maxWaitMs) {
    pollCount++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeoutId);
      // A single flaky poll costs nothing — the background job (once
      // started) doesn't depend on this specific request succeeding.
      await wait(POLL_INTERVAL_MS);
      continue;
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      return {
        ok: false,
        status: res.status,
        data,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
        diagnostic: `réponse HTTP ${res.status} après ${elapsed()} (${pollCount} vérification(s))`,
      };
    }

    const data = await res.json().catch(() => ({}));
    if (data.status === "done") {
      return { ok: true, status: 200, data, retryAfterSeconds: null, diagnostic: `terminé après ${elapsed()} (${pollCount} vérification(s))` };
    }
    if (data.status === "error") {
      const status = typeof data.errorStatus === "number" ? data.errorStatus : 502;
      const errorText = typeof data.error === "string" ? data.error : "erreur inconnue";
      return {
        ok: false,
        status,
        data,
        retryAfterSeconds: null,
        diagnostic: `échec après ${elapsed()} (${pollCount} vérification(s)) — ${errorText}`,
      };
    }
    // "pending" (or an unrecognized shape) — wait, then poll again.
    await wait(POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    status: 0,
    data: {},
    retryAfterSeconds: null,
    diagnostic: `délai dépassé après ${elapsed()} (${pollCount} vérification(s)) sans résultat`,
  };
}
