/**
 * Server half of the opt-in "heartbeat" transport for long JSON routes
 * (Studio sections, QCM regeneration, exams, module synthesis, study plans,
 * notes organization, flashcards, Lab tools).
 *
 * Those routes legitimately take 30 s to several minutes while ZERO bytes
 * flow — exactly what mobile carrier NATs and proxies drop after 30-120 s
 * of silence (see app/api/studio/generate/explication-part for the original
 * production evidence). When the client sends `X-MedArt-Heartbeat: 1`
 * (lib/heartbeat-client.ts does), the SAME handler runs unchanged, but the
 * response becomes newline-delimited JSON: a `{"type":"heartbeat"}` line
 * immediately and every 10 s, then one final line carrying the handler's own
 * JSON body plus `type: "result"` and its real HTTP status as `httpStatus`.
 * Without the header the route answers exactly as before, so any caller not
 * yet migrated keeps working.
 */

const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_HEADER = "x-medart-heartbeat";

type RouteHandler<R extends Request> = (request: R) => Promise<Response>;

export function withHeartbeat<R extends Request>(handler: RouteHandler<R>): RouteHandler<R> {
  return async (request) => {
    if (request.headers.get(HEARTBEAT_HEADER) !== "1") return handler(request);

    const encoder = new TextEncoder();
    const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const beat = () => {
          if (closed) return;
          try {
            controller.enqueue(line({ type: "heartbeat" }));
          } catch {
            closed = true;
          }
        };
        beat(); // flush headers right away
        const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);

        handler(request)
          .then(async (response) => {
            const text = await response.text();
            let body: Record<string, unknown>;
            try {
              const parsed: unknown = JSON.parse(text);
              body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { success: response.ok, data: parsed };
            } catch {
              body = { success: false, error: "Réponse du serveur illisible — réessaie." };
            }
            const retryAfter = response.headers.get("Retry-After");
            controller.enqueue(line({ ...body, type: "result", httpStatus: response.status, ...(retryAfter ? { retryAfter } : {}) }));
          })
          .catch((error: unknown) => {
            console.error("[heartbeat-route] Erreur non gérée dans le handler:", error);
            controller.enqueue(line({ type: "result", httpStatus: 500, success: false, error: "Erreur inattendue du serveur — réessaie dans un instant." }));
          })
          .finally(() => {
            clearInterval(interval);
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed by a client disconnect
            }
          });
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
    });
  };
}
