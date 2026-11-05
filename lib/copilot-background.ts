/**
 * Copilot replies that keep generating after the student leaves (server side).
 *
 * The browser's connection to /api/dashboard-assistant does not survive an
 * iPhone app switch, a closed tab or a reload. The model's stream is therefore
 * read to its end HERE, whatever happens to that connection, and the reply is
 * kept in the student's sync store (user_sync_documents, namespace
 * "copilot-replies", one document per reply id) so the page can collect it
 * when the student comes back (lib/copilot-reply-runner.ts). A push
 * notification tells a student who is away that the answer is ready.
 *
 * A cancelled connection is either the student leaving (carry on) or the
 * student tapping Stop / switching conversation (stop the model, as before,
 * so no tokens are spent for nothing). The page marks a reply "away" (namespace
 * "copilot-away") just before it goes to the background; the decision waits a
 * moment for that mark to land.
 */

export const REPLY_NS = "copilot-replies";
export const AWAY_NS = "copilot-away";

/** How long a cancelled connection waits for the page's "away" mark before deciding it was a Stop. */
export const CANCEL_GRACE_MS = 1500;

const REPLY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReplyId(value: unknown): value is string {
  return typeof value === "string" && REPLY_ID_PATTERN.test(value);
}

export type ReplyOutcome = "done" | "error" | "stopped";

export interface ReplyDocument {
  status: "generating" | ReplyOutcome;
  content: string;
  startedAt: number;
}

export interface BackgroundHooks {
  /** The reply has started — record it as generating. */
  onStart(): Promise<void>;
  /** Whether the page marked this reply "away" (left, not stopped). */
  isAway(): Promise<boolean>;
  /** The reply is over. `notify`: the student is away, tell them it's ready. */
  onSettle(outcome: ReplyOutcome, content: string, notify: boolean): Promise<void>;
  /** Keeps the serverless function alive until `work` settles (Vercel's waitUntil). */
  keepAlive(work: Promise<unknown>): void;
}

/**
 * The stream the student receives, fed from `source` — which is read to its
 * end on the server even if the student's connection goes away.
 */
export function outliveClient(source: ReadableStream<Uint8Array>, hooks: BackgroundHooks): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  // Assigned by start() below, which TypeScript's flow analysis can't see — hence the cast.
  let controller = null as ReadableStreamDefaultController<Uint8Array> | null;
  let clientGone = false;
  let stopped = false;
  let text = "";

  const output = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      if (clientGone) return;
      clientGone = true;
      setTimeout(() => {
        void hooks
          .isAway()
          .catch(() => false)
          .then((away) => {
            if (away) return;
            stopped = true;
            void reader.cancel().catch(() => undefined);
          });
      }, CANCEL_GRACE_MS);
    },
  });

  const started = hooks.onStart().catch(() => undefined);
  const work = (async () => {
    let ok = true;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        text += decoder.decode(value, { stream: true });
        if (!clientGone) {
          try {
            controller?.enqueue(value);
          } catch {
            clientGone = true;
          }
        }
      }
      text += decoder.decode();
      if (!clientGone) {
        try {
          controller?.close();
        } catch {
          // Already closed by a cancel racing this line.
        }
      }
    } catch (error) {
      ok = false;
      if (!clientGone) {
        try {
          controller?.error(error);
        } catch {
          // The student's side is already gone.
        }
      }
    }
    await started;
    if (stopped) {
      await hooks.onSettle("stopped", text, false);
      return;
    }
    const outcome: ReplyOutcome = ok && text.trim() ? "done" : "error";
    const notify = outcome === "done" && (clientGone || (await hooks.isAway().catch(() => false)));
    await hooks.onSettle(outcome, text, notify);
  })().catch((error) => {
    console.error("[copilot-background] Suivi de la réponse interrompu:", error instanceof Error ? error.message : error);
  });
  hooks.keepAlive(work);
  return output;
}
