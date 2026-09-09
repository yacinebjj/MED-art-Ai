"use client";

/**
 * Shared client-side reader for a "heartbeat-streamed" API route — one that
 * answers a genuinely long (multi-minute) generation with a STREAMED,
 * newline-delimited JSON body (Content-Type: application/x-ndjson) instead
 * of one plain JSON object, specifically to avoid holding a silent
 * connection open for minutes.
 *
 * WHY THIS EXISTS — a real, confirmed production incident: two Studio
 * features, Explication Ultra-Détaillée and Podcast Audio, both routinely
 * take 100+ seconds (Explication's own per-part pipeline, Podcast's
 * script+narration+encode+upload chain) and BOTH were the only two features
 * reported failing with "échec de génération" specifically on mobile, never
 * on PC — every OTHER Studio section (Résumé, Cas Clinique, QCM,
 * Infographie, Exemples&Analogies) finishes in well under a minute and
 * never showed this failure. That split lines up exactly with a
 * well-documented mobile-network reality: a cellular carrier's carrier-grade
 * NAT (every mobile data connection sits behind one) commonly drops an idle
 * TCP mapping after as little as 30-120 seconds of total silence — nothing
 * to do with screen locking, tab backgrounding, or this app's own code, and
 * it fails IDENTICALLY on every retry for the same request since it's a
 * deterministic property of the network path. Home/office WiFi tolerates a
 * much longer (or no) idle window on an already-established connection,
 * which is exactly why this only ever showed up on mobile.
 *
 * The matching server-side route keeps the connection alive by emitting a
 * `{"type":"heartbeat"}\n` line every ~15 seconds for the whole duration its
 * real work is in flight, so real bytes keep flowing continuously — this
 * defeats an idle-timeout drop entirely, independent of how long the actual
 * work takes. Such a route always answers HTTP 200 once streaming starts
 * (the real outcome isn't known yet when headers are sent) and encodes the
 * true result as the LAST line, `{"type":"result", success, ...}` —
 * `success:false` carries a `status` field holding the LOGICAL status this
 * failure would have had as a plain response, since the real HTTP transport
 * status is stuck at 200. This function reads that field, not the transport
 * status, as `status` in its own return value. A non-200 response (an early
 * auth/rate-limit/validation failure that never reaches the streaming
 * branch) is handled exactly like a plain JSON fetch — transport status is
 * authoritative there.
 */
export interface HeartbeatFetchOutcome {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
  /** Parsed `Retry-After` header (seconds), only ever set on the early, non-streamed 429 path — see lib/rate-limit-message.ts's buildRateLimitMessageFromSeconds. `null` otherwise. */
  retryAfterSeconds: number | null;
  /**
   * Human-readable trace of what actually happened on the wire — added
   * after several rounds of fixing PLAUSIBLE mobile-only "échec de
   * génération" causes (a hidden Agent-level timeout, silent truncation, an
   * auth-refresh race, an idle-connection NAT drop) without direct evidence
   * any single one was THE cause of a given real report. This is meant to
   * be shown directly to the student in the failure message, not just
   * logged somewhere only a developer can see (this app has no confirmed,
   * authenticated access to live Vercel function logs) — elapsed time, how
   * many heartbeats arrived before things went wrong, and the literal
   * network/parse error name+message, together, are usually enough to tell
   * apart an idle-connection drop (some heartbeats arrived, then a network
   * exception) from a genuine platform kill (heartbeats arrived, then the
   * stream just ends with no error and no result) from a clean AI-side
   * failure (a "result" line arrives with success:false) from something
   * failing before any streaming even started (0 heartbeats, immediate
   * HTTP status) — instead of guessing again from a one-line symptom.
   */
  diagnostic: string;
}

export async function postJsonWithHeartbeat(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<HeartbeatFetchOutcome> {
  const startedAt = Date.now();
  let heartbeatCount = 0;
  const elapsed = () => `${Math.round((Date.now() - startedAt) / 1000)}s`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: 0,
        data: {},
        retryAfterSeconds: null,
        diagnostic: `échec réseau après ${elapsed()}, ${heartbeatCount} signal(aux) reçu(s) — ${name}: ${message}`,
      };
    }

    if (!res.ok || !res.body) {
      // An early validation failure never reaches the streaming branch —
      // plain JSON, real transport status is authoritative here.
      const data = await res.json().catch(() => ({}));
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      return {
        ok: res.ok,
        status: res.status,
        data,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
        diagnostic: `réponse immédiate HTTP ${res.status} après ${elapsed()}`,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue; // A malformed/split line — keep reading for the real one.
          }
          if (parsed.type === "heartbeat") {
            heartbeatCount++;
            continue;
          }
          if (parsed.type === "result") {
            const status = typeof parsed.status === "number" ? parsed.status : parsed.success === true ? 200 : 502;
            const resultNote =
              parsed.success === true ? "succès" : `échec — ${typeof parsed.error === "string" ? parsed.error : `HTTP ${status}`}`;
            return {
              ok: parsed.success === true,
              status,
              data: parsed,
              retryAfterSeconds: null,
              diagnostic: `résultat (${resultNote}) après ${elapsed()}, ${heartbeatCount} signal(aux) reçu(s)`,
            };
          }
        }
      }
    } catch (error) {
      // The stream itself broke mid-read (connection reset, etc.) — the
      // single most diagnostic case: it PROVES whether heartbeats were
      // already flowing when the connection died, directly confirming or
      // refuting the idle-timeout theory for THIS specific failure instead
      // of another guess.
      const name = error instanceof Error ? error.name : "Error";
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: 0,
        data: {},
        retryAfterSeconds: null,
        diagnostic: `flux interrompu après ${elapsed()}, ${heartbeatCount} signal(aux) reçu(s) — ${name}: ${message}`,
      };
    }
    // Stream ended cleanly (done=true) with no "result" line ever seen —
    // the server closed the connection without ever sending a final
    // outcome (e.g. a platform-level kill of the function itself).
    return {
      ok: false,
      status: 0,
      data: {},
      retryAfterSeconds: null,
      diagnostic: `flux terminé sans résultat après ${elapsed()}, ${heartbeatCount} signal(aux) reçu(s)`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
