import { waitUntil } from "@vercel/functions";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { runWithGenerationProgress } from "@/lib/ai/generation-progress";
import { KEEP_ALIVE_HEADER, type KeepAliveFrame } from "@/lib/http/keep-alive-protocol";

/**
 * Keeps a long AI route's connection alive end-to-end.
 *
 * A plain request/response sends ZERO bytes while the model generates (1-4
 * minutes); mobile carriers, iOS Safari and proxies drop such idle
 * connections, which the browser reports as "HTTP 0". When the client opts in
 * (KEEP_ALIVE_HEADER, sent by lib/http/fetch-keep-alive.ts), the route answers
 * immediately with a 200 NDJSON stream:
 *   {"type":"open","at":T}                   right away (flushes headers)
 *   {"type":"progress","chars":N}            on new tokens, at most 1/s
 *   {"type":"heartbeat","chars":N}           every HEARTBEAT_MS regardless
 *   {"type":"result","status":S,"body":"…"}  the handler's real response
 * The client rebuilds an ordinary Response from the result frame, so callers
 * keep their usual `res.ok` / `res.status` / `res.json()` code.
 *
 * Gate: auth + device limit are checked BEFORE the stream opens and a failure
 * is a real 401, exactly like the unwrapped route (the client's 401 recovery
 * still works). The handler then re-runs every check of its own (rate limit,
 * validation, quota reservation, platform capacity) unchanged, and their
 * failures come back with their real status inside the result frame.
 *
 * The handler's work is registered with waitUntil and never tied to the
 * client connection: if the browser drops, generation still finishes and the
 * route still persists its result (Studio saves to studio_courses), which is
 * what lets the client recover it by polling instead of paying again.
 */

const HEARTBEAT_MS = 5_000;
const PROGRESS_MIN_INTERVAL_MS = 1_000;
const FORWARDED_HEADERS = ["retry-after", "content-type"];

type RouteHandler<R extends Request, C> = (request: R, context: C) => Promise<Response>;

export function withKeepAlive<R extends Request, C>(handler: RouteHandler<R, C>): RouteHandler<R, C> {
  return async (request, context) => {
    if (request.headers.get(KEEP_ALIVE_HEADER) !== "1") return handler(request, context);

    const user = await getAuthenticatedUser();
    if (!user) {
      return Response.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
    }

    const encoder = new TextEncoder();
    let clientConnected = true;
    let totalChars = 0;
    let lastProgressAt = 0;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (frame: KeepAliveFrame) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
          } catch {
            clientConnected = false;
          }
        };

        send({ type: "open", at: Date.now() });
        const heartbeat = setInterval(() => send({ type: "heartbeat", chars: totalChars }), HEARTBEAT_MS);

        const onProgress = (deltaChars: number) => {
          totalChars += deltaChars;
          const now = Date.now();
          if (now - lastProgressAt < PROGRESS_MIN_INTERVAL_MS) return;
          lastProgressAt = now;
          send({ type: "progress", chars: totalChars });
        };

        const work = runWithGenerationProgress(onProgress, () => handler(request, context))
          .then(async (response) => {
            const body = await response.text();
            const headers: Record<string, string> = {};
            for (const name of FORWARDED_HEADERS) {
              const value = response.headers.get(name);
              if (value) headers[name] = value;
            }
            send({ type: "result", status: response.status, headers, body });
          })
          .catch((error) => {
            console.error(`[keep-alive] ${new URL(request.url).pathname} — exception non interceptée:`, error);
            send({
              type: "result",
              status: 500,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ success: false, error: "Une erreur inattendue est survenue. Réessaie." }),
            });
          })
          .finally(() => {
            clearInterval(heartbeat);
            if (!clientConnected) return;
            clientConnected = false;
            try {
              controller.close();
            } catch {
              // Already closed by a client disconnect.
            }
          });

        waitUntil(work);
      },
      cancel() {
        // The browser left. The handler keeps running (waitUntil) and still
        // persists its result; only the frames stop.
        clientConnected = false;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  };
}
