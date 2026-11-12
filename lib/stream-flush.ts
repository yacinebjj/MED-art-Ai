/**
 * Paints a streamed Copilot reply in step with the screen, but never more than
 * about 20 times a second.
 *
 * Every paint re-renders a whole chat (the module workspace re-renders all its
 * panes) and re-reads the whole reply so far (cleaning, block splitting,
 * reading direction). Once per animation frame meant 60 of those a second — 120
 * or 144 on fast screens — and a long answer kept a phone's main thread
 * saturated: typing and scrolling stuttered while MedArt wrote. Twenty a second
 * still reads as live, flowing text: new words fade in with a small stagger
 * (components/assistant/StreamedMarkdown.tsx), so each paint ripples in rather
 * than jumping.
 *
 * Code Red 2026-11-12 ("the app is heavy, it freezes").
 */

/** Minimum time between two paints of a streaming reply. */
export const STREAM_FLUSH_MIN_GAP_MS = 50;

export interface StreamFlusher {
  /** New text arrived: paint it on a coming frame, at least the minimum gap after the previous paint. */
  schedule(): void;
  /** Drops a pending paint — the caller paints the final state itself, or stops watching. */
  cancel(): void;
}

export function createStreamFlusher(paint: () => void, minGapMs: number = STREAM_FLUSH_MIN_GAP_MS): StreamFlusher {
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPaintAt = -Infinity;

  const run = () => {
    frame = null;
    lastPaintAt = performance.now();
    paint();
  };

  return {
    schedule() {
      if (frame !== null || timer !== null) return;
      const wait = minGapMs - (performance.now() - lastPaintAt);
      if (wait <= 0) {
        frame = requestAnimationFrame(run);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(run);
      }, wait);
    },
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    },
  };
}
