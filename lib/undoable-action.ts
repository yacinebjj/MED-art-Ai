"use client";

/**
 * One-click destructive actions with an "Annuler" window (Gmail-style): the
 * action is scheduled, not run — it runs when the window closes, unless the
 * student undoes it from the toast. Kept at module level, so it still runs
 * when the page that scheduled it is left; and run at once (keepalive) when
 * the tab is closed, so a deletion the student asked for is never lost.
 */

/** Matches the toast's own "info" duration (components/ui/Toast.tsx). */
export const UNDO_WINDOW_MS = 6000;

interface PendingAction {
  timer: ReturnType<typeof setTimeout>;
  run: (keepalive: boolean) => Promise<void>;
}

const pending = new Map<string, PendingAction>();

/**
 * Schedules `run` under `key` (a newer schedule of the same key replaces the
 * older one). Returns `undo`: true when it cancelled the action in time.
 */
export function scheduleUndoableAction(key: string, run: (keepalive: boolean) => Promise<void>, delayMs = UNDO_WINDOW_MS): () => boolean {
  const previous = pending.get(key);
  if (previous) clearTimeout(previous.timer);
  const entry: PendingAction = {
    run,
    timer: setTimeout(() => {
      if (pending.get(key) !== entry) return;
      pending.delete(key);
      void run(false).catch((error) => console.error("[undoable] Action échouée:", error));
    }, delayMs),
  };
  pending.set(key, entry);
  return () => {
    if (pending.get(key) !== entry) return false;
    clearTimeout(entry.timer);
    pending.delete(key);
    return true;
  };
}

/** Whether an action is waiting under `key` (e.g. to dim the card it will delete). */
export function isActionPending(key: string): boolean {
  return pending.has(key);
}

if (typeof window !== "undefined") {
  // Leaving MedArt inside the window: the student asked for it — run it now.
  window.addEventListener("pagehide", () => {
    pending.forEach((entry, key) => {
      clearTimeout(entry.timer);
      pending.delete(key);
      void entry.run(true).catch(() => undefined);
    });
  });
}
