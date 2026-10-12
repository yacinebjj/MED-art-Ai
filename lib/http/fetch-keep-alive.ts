import { KEEP_ALIVE_HEADER, type KeepAliveFrame } from "@/lib/http/keep-alive-protocol";

/**
 * Browser side of lib/http/keep-alive.ts. Drop-in for `fetch()` on a long AI
 * route: the server streams heartbeat/progress frames so the connection is
 * never idle, and this resolves with an ordinary Response rebuilt from the
 * final result frame — callers keep their `res.ok` / `res.status` /
 * `res.json()` code unchanged.
 *
 * Failure semantics:
 *  - fetch() itself throwing (request never landed) propagates unchanged.
 *  - The stream breaking AFTER the server accepted the request throws
 *    KeepAliveConnectionLost. The server keeps working and saves its result,
 *    so for a quota-reserving route the right recovery is to READ the saved
 *    result (see the Studio's section polling), never to POST again.
 */
export class KeepAliveConnectionLost extends Error {
  constructor(
    message: string,
    readonly elapsedMs: number,
    readonly receivedFrames: number,
    /** Server clock when it accepted the request (undefined if the stream broke before the first frame). */
    readonly serverStartedAt?: number
  ) {
    super(message);
    this.name = "KeepAliveConnectionLost";
  }
}

export interface KeepAliveProgress {
  /** Characters generated so far by the model(s) behind this request. */
  chars: number;
  elapsedMs: number;
}

export interface FetchKeepAliveOptions {
  onProgress?: (progress: KeepAliveProgress) => void;
  /** Whole-request ceiling; kept above every route's 300 s maxDuration. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 330_000;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export async function fetchKeepAlive(input: string, init: RequestInit = {}, options: FetchKeepAliveOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(KEEP_ALIVE_HEADER, "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const startedAt = Date.now();
  let frames = 0;
  let serverStartedAt: number | undefined;
  try {
    const res = await fetch(input, { ...init, headers, signal: controller.signal });
    const contentType = res.headers.get("content-type") ?? "";
    // Gate failures (401) and servers without the wrapper answer plainly.
    if (!res.body || !contentType.includes("application/x-ndjson")) return res;

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
          let frame: KeepAliveFrame;
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          frames++;
          if (frame.type === "open") serverStartedAt = frame.at;
          if (frame.type === "result") {
            reader.cancel().catch(() => {});
            const status = frame.status >= 200 && frame.status <= 599 ? frame.status : 502;
            return new Response(NULL_BODY_STATUSES.has(status) ? null : frame.body, { status, headers: frame.headers });
          }
          if ((frame.type === "progress" || frame.type === "heartbeat") && options.onProgress) {
            try {
              options.onProgress({ chars: frame.chars, elapsedMs: Date.now() - startedAt });
            } catch {
              // A UI callback must never break the request.
            }
          }
        }
      }
    } catch (error) {
      if (callerSignal?.aborted) throw error;
      throw new KeepAliveConnectionLost(
        `Connexion interrompue après ${Math.round((Date.now() - startedAt) / 1000)}s (${error instanceof Error ? error.message : String(error)})`,
        Date.now() - startedAt,
        frames,
        serverStartedAt
      );
    }
    throw new KeepAliveConnectionLost(`Flux terminé sans résultat après ${Math.round((Date.now() - startedAt) / 1000)}s`, Date.now() - startedAt, frames, serverStartedAt);
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export function isConnectionLost(error: unknown): boolean {
  return error instanceof KeepAliveConnectionLost || error instanceof TypeError;
}
