"use client";

import { useEffect, useState } from "react";

/**
 * How much of the viewport's bottom the on-screen keyboard is currently
 * covering, in pixels — 0 when no keyboard is open. Derived from
 * window.visualViewport, which shrinks live as iOS Safari's keyboard
 * animates open/closed (Android gets the equivalent behavior "for free"
 * from the `interactiveWidget: "resizes-content"` viewport meta in
 * app/layout.tsx, so this hook mostly matters for iOS).
 *
 * Deliberately returns an INSET to add as extra bottom clearance, not a
 * replacement height for the page. An earlier version of this pattern set a
 * page's own container height directly to `visualViewport.height` — that
 * double-counts space already consumed above it (the shared Topbar/shell
 * chrome and, on the routes with the mobile bottom nav, that nav's own
 * floating footprint), so the page ends up TALLER than what's actually
 * visible even with no keyboard open, pushing its bottom-most content (a
 * Save button, a composer) out of view. Adding this inset as bottom
 * padding/margin on top of a naturally-sized (h-full) container avoids that
 * entirely: the container keeps the height its layout already gives it, and
 * only gains extra reserved space at the bottom while the keyboard is open.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      if (!vv) return;
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
