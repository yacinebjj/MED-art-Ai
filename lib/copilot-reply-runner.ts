/**
 * Copilot replies that outlive the page that asked for them (browser side).
 *
 * A reply used to belong to the Copilot page: leaving the page aborted it,
 * and an iPhone app switch broke its connection mid-answer. A reply now runs
 * here, at module level, so it keeps arriving while the student is elsewhere
 * in MedArt; the page only watches it (subscribeReply) and stops it on
 * purpose (stopReply).
 *
 * When the connection breaks anyway (app switch, closed tab, network blip),
 * the reply is collected from the server, which carried it on to its end
 * (lib/copilot-background.ts): the page asks for it as soon as it is visible
 * again. A reply that settles while no page watches it is written into its
 * saved conversation and announced: the REPLY_READY_EVENT drives an in-app
 * toast (components/assistant/CopilotReplyNotifier.tsx), and a hidden tab's
 * title says the answer is ready. A student who is away also gets a push from
 * the server: the page marks its replies "away" whenever it goes to the
 * background.
 */

import { patchStoredAssistantMessage } from "@/hooks/useAssistantConversations";
import { AWAY_NS, REPLY_NS, type ReplyDocument } from "@/lib/copilot-background";
import { fetchSyncNamespace } from "@/lib/user-sync";

export type ReplyStatus = "streaming" | "done" | "error" | "stopped";

export interface ReplySnapshot {
  text: string;
  status: ReplyStatus;
  /** For "error": what went wrong, shown in the amber error bubble. */
  error?: string;
}

export interface ReplyCopy {
  /** The server refused or failed without saying why. */
  noReply: string;
  /** The reply ended without a word. */
  empty: string;
  /** The connection broke and the server has no finished reply to give. */
  interrupted: string;
  /** The hidden tab's title while an answer is waiting. */
  readyTitle: string;
}

/** Fired on window when a reply settles with no page watching it (detail: { id }). */
export const REPLY_READY_EVENT = "copilot:reply-ready";

/** How long a page keeps asking the server for a reply whose connection broke (a reply gets 120 s there). */
const RECOVER_FOR_MS = 150_000;
/** No trace of the reply on the server after this long: it never started there. */
const RECOVER_NO_TRACE_MS = 10_000;
const RECOVER_EVERY_MS = 1500;
/** Still "generating" this long after it started: the server was cut off (function timeout). */
const STALE_GENERATING_MS = 180_000;

interface Run {
  userId: string | null;
  copy: ReplyCopy;
  snapshot: ReplySnapshot;
  listeners: Set<(snapshot: ReplySnapshot) => void>;
  controller: AbortController;
  /** The page settled this reply itself (it left the thread on purpose): nothing to save or announce. */
  handled: boolean;
}

const runs = new Map<string, Run>();

/** What a settled reply leaves in the thread: its text, the "⚠️ …" error line, or nothing (stopped before its first word). */
export function settledReplyContent(snapshot: ReplySnapshot): string | null {
  if (snapshot.status === "error") return `⚠️ ${snapshot.error ?? "L'assistant n'a pas pu répondre. Réessaie."}`;
  return snapshot.text.trim() ? snapshot.text : null;
}

function emit(run: Run): void {
  run.listeners.forEach((listener) => listener(run.snapshot));
}

let titleBeforeReady: string | null = null;

/** A hidden tab says the answer is ready until the student looks at it again. */
function markTitleReady(readyTitle: string): void {
  if (titleBeforeReady !== null) return;
  titleBeforeReady = document.title;
  document.title = `✓ ${readyTitle} · ${titleBeforeReady}`;
  const restore = () => {
    if (document.visibilityState !== "visible") return;
    document.removeEventListener("visibilitychange", restore);
    if (titleBeforeReady !== null) document.title = titleBeforeReady;
    titleBeforeReady = null;
  };
  document.addEventListener("visibilitychange", restore);
}

function settle(id: string, run: Run, snapshot: ReplySnapshot): void {
  if (run.snapshot.status !== "streaming") return;
  run.snapshot = snapshot;
  if (run.listeners.size > 0) emit(run);
  else if (!run.handled && run.userId) {
    // Nobody is watching (the student is elsewhere in MedArt): the reply goes into its saved conversation…
    patchStoredAssistantMessage(run.userId, id, settledReplyContent(snapshot));
    // …and an answer is announced.
    if (snapshot.status === "done") window.dispatchEvent(new CustomEvent(REPLY_READY_EVENT, { detail: { id } }));
  }
  if (snapshot.status === "done" && document.visibilityState === "hidden") markTitleReady(run.copy.readyTitle);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextVisible(): Promise<void> {
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

/** The connection broke: collect the reply the server carried on (it may still be finishing). */
async function recover(id: string, run: Run): Promise<void> {
  let since = Date.now();
  let traced = false;
  while (Date.now() - since < RECOVER_FOR_MS) {
    if (run.controller.signal.aborted) return settle(id, run, { text: run.snapshot.text, status: "stopped" });
    if (document.visibilityState === "hidden") {
      // Nothing to show while away; the time away doesn't count against the reply.
      await nextVisible();
      since = Date.now();
      continue;
    }
    const docs = await fetchSyncNamespace(REPLY_NS, id);
    const doc = docs?.find((d) => d.key === id && !d.deleted);
    const data = doc?.data && typeof doc.data === "object" ? (doc.data as Partial<ReplyDocument>) : null;
    if (data) {
      traced = true;
      const content = typeof data.content === "string" ? data.content : "";
      if (data.status === "done" && content.trim()) return settle(id, run, { text: content, status: "done" });
      if (data.status === "stopped") return settle(id, run, { text: content || run.snapshot.text, status: "stopped" });
      if (data.status === "error") return settle(id, run, { text: content, status: "error", error: run.copy.interrupted });
      if (typeof data.startedAt === "number" && Date.now() - data.startedAt > STALE_GENERATING_MS) break;
    } else if (!traced && Date.now() - since > RECOVER_NO_TRACE_MS) {
      break;
    }
    await sleep(RECOVER_EVERY_MS);
  }
  settle(id, run, { text: run.snapshot.text, status: "error", error: run.copy.interrupted });
}

async function pump(id: string, run: Run, body: Record<string, unknown>): Promise<void> {
  const signal = run.controller.signal;
  let text = "";
  try {
    const res = await fetch("/api/dashboard-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ ...body, replyId: id }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      return settle(id, run, { text: "", status: "error", error: typeof data?.error === "string" ? data.error : run.copy.noReply });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      run.snapshot = { text, status: "streaming" };
      emit(run);
    }
    text += decoder.decode();
  } catch {
    if (signal.aborted) return settle(id, run, { text, status: "stopped" });
    return recover(id, run);
  }
  settle(id, run, text.trim() ? { text, status: "done" } : { text, status: "error", error: run.copy.empty });
}

/** Sends a message to the Copilot; the reply runs here until it settles, whether or not a page watches it. */
export function startReply(id: string, userId: string | null, body: Record<string, unknown>, copy: ReplyCopy): void {
  const run: Run = { userId, copy, snapshot: { text: "", status: "streaming" }, listeners: new Set(), controller: new AbortController(), handled: false };
  runs.set(id, run);
  void pump(id, run, body);
}

/** A saved reply still marked pending: keep watching it if it is still running in this tab, else collect it from the server. */
export function resumeReply(id: string, userId: string | null, copy: ReplyCopy, partialText: string): void {
  if (runs.has(id)) return;
  const run: Run = { userId, copy, snapshot: { text: partialText, status: "streaming" }, listeners: new Set(), controller: new AbortController(), handled: false };
  runs.set(id, run);
  void recover(id, run);
}

/** Follows a reply: called with every change, starting with where it is now (on the next microtask). */
export function subscribeReply(id: string, listener: (snapshot: ReplySnapshot) => void): () => void {
  const run = runs.get(id);
  if (!run) return () => undefined;
  run.listeners.add(listener);
  queueMicrotask(() => {
    if (run.listeners.has(listener)) listener(run.snapshot);
  });
  return () => {
    run.listeners.delete(listener);
  };
}

export function getReplySnapshot(id: string): ReplySnapshot | null {
  return runs.get(id)?.snapshot ?? null;
}

/**
 * The student stopped the reply: it settles at once with what already
 * arrived (not when the aborted read gets round to failing), and the server
 * stops the model too (lib/copilot-background.ts).
 */
export function stopReply(id: string): void {
  const run = runs.get(id);
  if (!run) return;
  run.controller.abort();
  settle(id, run, { text: run.snapshot.text, status: "stopped" });
}

/** The page settled this reply itself: once it ends, there is nothing to save or announce. */
export function forgetReply(id: string): void {
  const run = runs.get(id);
  if (run) run.handled = true;
}

/** Tells the server whether the student is away, so a reply whose connection breaks is carried on (not stopped) and announced by push. */
function markAway(away: boolean): void {
  runs.forEach((run, id) => {
    if (run.snapshot.status !== "streaming" || run.controller.signal.aborted) return;
    void fetch("/api/user-sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ ns: AWAY_NS, key: id, data: { away, at: Date.now() } }),
    }).catch(() => undefined);
  });
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => markAway(document.visibilityState === "hidden"));
  window.addEventListener("pagehide", () => markAway(true));
}
