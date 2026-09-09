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
}

export async function postJsonWithHeartbeat(url: string, body: Record<string, unknown>, timeoutMs: number): Promise<HeartbeatFetchOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      // An early validation failure never reaches the streaming branch —
      // plain JSON, real transport status is authoritative here.
      const data = await res.json().catch(() => ({}));
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      return { ok: res.ok, status: res.status, data, retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
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
        if (parsed.type === "heartbeat") continue;
        if (parsed.type === "result") {
          const status = typeof parsed.status === "number" ? parsed.status : parsed.success === true ? 200 : 502;
          return { ok: parsed.success === true, status, data: parsed, retryAfterSeconds: null };
        }
      }
    }
    // Stream ended with no "result" line ever seen — the connection was
    // dropped (or the server crashed) mid-stream. Status 0, same bucket as
    // an ordinary network failure for any caller's own retry logic.
    return { ok: false, status: 0, data: {}, retryAfterSeconds: null };
  } finally {
    clearTimeout(timeoutId);
  }
}
