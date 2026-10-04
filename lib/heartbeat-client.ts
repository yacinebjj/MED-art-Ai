"use client";

/**
 * Client half of lib/heartbeat-route.ts. Drop-in replacement for `fetch()`
 * on a long JSON route: it asks for the heartbeat transport, reads the
 * NDJSON stream (ignoring heartbeat lines), and resolves with an ordinary
 * `Response` rebuilt from the final result line — same status, same JSON
 * body, same Retry-After — so `res.ok`, `res.status` and `res.json()` keep
 * working unchanged at every call site.
 *
 * A connection that dies mid-stream rejects with a clear French error
 * (instead of hanging or a raw "network error"); a route that answers with
 * a plain JSON body (early auth/validation failure, or a server not yet
 * migrated) is returned as-is.
 */
export async function fetchWithHeartbeat(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-MedArt-Heartbeat", "1");
  const res = await fetch(input, { ...init, headers });

  if (!(res.headers.get("Content-Type") ?? "").includes("application/x-ndjson") || !res.body) return res;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const raw = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!raw) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (parsed.type !== "result") continue;
        const { type: _type, httpStatus, retryAfter, ...body } = parsed;
        void _type;
        const status = typeof httpStatus === "number" ? httpStatus : body.success === false ? 502 : 200;
        const outHeaders = new Headers({ "Content-Type": "application/json" });
        if (typeof retryAfter === "string") outHeaders.set("Retry-After", retryAfter);
        return new Response(JSON.stringify(body), { status, headers: outHeaders });
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("La connexion a été interrompue pendant la génération. Vérifie ta connexion puis réessaie.");
  }
  throw new Error("Le serveur a fermé la connexion sans résultat. Réessaie dans un instant.");
}
