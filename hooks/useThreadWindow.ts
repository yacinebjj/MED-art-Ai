"use client";

import { startTransition, useEffect, useState } from "react";

/** Messages of a conversation mounted the moment it opens: its latest ones, the ones on screen. */
export const THREAD_TAIL = 8;
/** Older messages mounted above them per idle slot after that. */
export const THREAD_STEP = 6;

export interface ThreadWindow {
  /** Index of the first mounted message. */
  from: number;
  /** Messages from this index on arrived after the thread opened: they rise in; older ones simply appear. */
  animateFrom: number;
}

/**
 * Which messages of a conversation are mounted. A long conversation (every
 * reply is rich Markdown with citation chips) used to be parsed and committed
 * in one task when a course opened — "Reprendre en 1 clic" on a phone froze
 * on it. Its latest messages mount at once; the older ones are added above in
 * idle time, a few per step, as interruptible transitions. A different
 * conversation (another course, a cleared one: its first message changes)
 * starts over from its end.
 */
export function useThreadWindow(messages: readonly { id: string }[]): ThreadWindow {
  const firstId = messages[0]?.id ?? null;
  const [state, setState] = useState(() => ({ firstId, from: Math.max(0, messages.length - THREAD_TAIL), animateFrom: messages.length }));
  let { from, animateFrom } = state;
  if (state.firstId !== firstId) {
    from = Math.max(0, messages.length - THREAD_TAIL);
    animateFrom = messages.length;
    setState({ firstId, from, animateFrom });
  }

  useEffect(() => {
    if (from <= 0) return;
    const step = () =>
      startTransition(() => setState((current) => (current.firstId === firstId ? { ...current, from: Math.max(0, current.from - THREAD_STEP) } : current)));
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(step, { timeout: 300 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(step, 32);
    return () => window.clearTimeout(id);
  }, [from, firstId]);

  return { from: Math.min(from, messages.length), animateFrom };
}
