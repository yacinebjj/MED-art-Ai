"use client";

import { useEffect, useRef, useState } from "react";

export interface VisualViewportBox {
  /** window.visualViewport.offsetTop — how far iOS has scrolled the visible area down inside the layout viewport. */
  top: number;
  /** The visible height, i.e. the layout minus the on-screen keyboard. */
  height: number;
  keyboardOpen: boolean;
}

// How much shorter than the tallest height seen so far the visual viewport
// must get before it counts as "the keyboard is open" — large enough to
// ignore iOS Safari's collapsing address/tab bar (~50-80px), small enough to
// catch every real soft keyboard (always 250px+).
const KEYBOARD_MIN_SHRINK_PX = 120;

// Even a small phone in landscape with the keyboard open keeps well over this
// visible; anything below it is a bad reading, not a real viewport.
const MIN_PLAUSIBLE_HEIGHT_PX = 100;

/**
 * The currently VISIBLE rectangle of the page (window.visualViewport), for
 * pinning a full-screen surface exactly to it. A page that sets its own
 * `top` and `height` from this follows the keyboard with no padding
 * arithmetic: on iOS the layout viewport does NOT shrink for the keyboard
 * (and iOS scrolls it to reveal the focused field, moving everything
 * pinned to the layout box), while `visualViewport` always describes what
 * the student actually sees. On Android Chrome (`interactive-widget:
 * resizes-content`) both agree, so the same code is a no-op there.
 *
 * Updates are coalesced into one per animation frame — iOS fires several
 * resize/scroll events per keyboard animation frame.
 *
 * `enabled: false` (desktop) returns null and attaches nothing. Also null
 * wherever visualViewport doesn't exist, so callers fall back to their CSS
 * layout.
 */
export function useVisualViewportBox(enabled: boolean): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);
  const baselineRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    if (!enabled) {
      setBox(null);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    let frame: number | null = null;

    function measure() {
      frame = null;
      if (!vv) return;
      // Some browsers (in-app webviews, a page that hasn't laid out yet)
      // report a 0/NaN visual viewport. Pinning a full-screen surface to that
      // would collapse it to nothing with no event ever firing to recover —
      // ignore an implausible reading and keep the last good one (or null).
      // Checked BEFORE the baseline update so a bad reading can't poison it.
      if (!Number.isFinite(vv.height) || !Number.isFinite(vv.offsetTop) || vv.height < MIN_PLAUSIBLE_HEIGHT_PX || vv.offsetTop < 0) return;

      const baseline = baselineRef.current;
      // A different width means a rotation or a window resize: start the
      // "tallest height seen" baseline over for the new orientation.
      if (Math.round(vv.width) !== baseline.width) {
        baseline.width = Math.round(vv.width);
        baseline.height = 0;
      }
      baseline.height = Math.max(baseline.height, vv.height);

      const next: VisualViewportBox = {
        top: Math.round(vv.offsetTop),
        height: Math.round(vv.height),
        keyboardOpen: baseline.height - vv.height > KEYBOARD_MIN_SHRINK_PX,
      };
      setBox((prev) =>
        prev && prev.top === next.top && prev.height === next.height && prev.keyboardOpen === next.keyboardOpen ? prev : next
      );
    }

    function schedule() {
      if (frame === null) frame = requestAnimationFrame(measure);
    }

    measure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return box;
}
