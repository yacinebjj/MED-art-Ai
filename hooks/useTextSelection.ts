"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface TextSelectionState {
  text: string;
  top: number;
  left: number;
}

interface UseTextSelectionResult {
  /** Attach to the element whose text can be selected. A callback ref (not a plain RefObject) — see the comment above the effect below for why. */
  containerRef: (node: HTMLDivElement | null) => void;
  /** The resolved container node itself — callers that need to compute/restore highlight offsets scoped to this exact element (see lib/highlight.ts's computeOffsets) use this instead of re-deriving it. */
  container: HTMLDivElement | null;
  /** Attach to the floating tooltip so outside-clicks can be detected correctly. */
  tooltipRef: RefObject<HTMLDivElement>;
  selection: TextSelectionState | null;
  clearSelection: () => void;
}

/**
 * Tracks text selections inside `containerRef` and computes where a floating
 * tooltip should appear, centered just above the selected range. Dismisses
 * itself on any mousedown outside both the selection and the tooltip.
 */
export function useTextSelection(): UseTextSelectionResult {
  // A callback ref backed by state, NOT a plain useRef — reproduced live:
  // pages that show a loading screen before their content mounts (e.g. a
  // freshly-uploaded course's page, which renders <LoadingScreen /> while its
  // Supabase fetch is in flight) don't have the container div in the tree on
  // first mount. A plain `useRef` + `useEffect(..., [])` reads `ref.current`
  // exactly once, right after that first mount — at that moment it's still
  // null, the effect bails, and since the effect never runs again the
  // mouseup/mousedown listeners are never attached for the rest of the
  // page's life, even once the real content (and the div) shows up moments
  // later. A callback ref calls setContainer on every mount/unmount of the
  // node, which the effect below depends on, so it re-runs the moment the
  // container actually exists — regardless of how many renders it took to
  // get there.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  const tooltipRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<TextSelectionState | null>(null);

  // Debounces the `selectionchange` fallback below (see its own comment) —
  // a ref, not state, since it only ever gates a timer and must never
  // itself trigger a re-render.
  const selectionChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!container) return;

    // Shared by mouseup, touchend, and the selectionchange fallback below —
    // one source of truth for "does window.getSelection() describe a real,
    // in-container selection right now, and if so where should the tooltip
    // go", so mouse and touch can never quietly diverge in behavior.
    function updateFromSelection() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";

      if (!sel || text.length === 0 || sel.rangeCount === 0) {
        return;
      }

      // Only react to selections that actually live inside our reading
      // container. Listening on `document` (below) means a drag that starts
      // inside the reader but ends outside it — trivially easy given the
      // reader sits between two fixed sidebars — must still register; a
      // listener scoped to `container` only fires when the mouseup's target
      // is inside its subtree, so releasing just past the edge silently
      // dropped the selection and the tooltip never appeared.
      const anchorNode = sel.anchorNode;
      if (!anchorNode || !container!.contains(anchorNode)) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Ignore empty/zero-size ranges (can happen on a stray mouseup/touchend).
      if (rect.width === 0 && rect.height === 0) return;

      // getBoundingClientRect() is ALWAYS viewport-relative, so pairing it
      // with a position:fixed tooltip means NO scroll offset must be added.
      // The old code added window.scrollY, but the reader scrolls inside an
      // inner overflow container (not the window), so window.scrollY stayed 0
      // and the tooltip was mispositioned as soon as the text was scrolled —
      // making it seem to "only work at the top". Viewport coords fix that at
      // any scroll depth, whichever element actually scrolls.
      const left = rect.left + rect.width / 2;
      let top = rect.top - 50; // just above the selection
      if (top < 8) top = rect.bottom + 12; // flip below if too close to the top edge

      setSelection({ text, top, left });
    }

    function dismissOnFreshInteraction(target: Node) {
      const clickedInsideTooltip = tooltipRef.current?.contains(target);
      if (clickedInsideTooltip) return;

      // A fresh mousedown/touchstart that isn't on the tooltip always starts
      // a new interaction (new selection or just a dismissal tap) — hide for
      // now, updateFromSelection will show it again if a new selection results.
      setSelection(null);
    }

    function handleMouseUp() {
      updateFromSelection();
    }

    function handleMouseDown(event: MouseEvent) {
      dismissOnFreshInteraction(event.target as Node);
    }

    // Touch mirrors of the two handlers above — a plain tap-and-release on
    // mobile behaves exactly like a mouse click-and-release, so touchend
    // reuses updateFromSelection() and touchstart reuses
    // dismissOnFreshInteraction() verbatim. `{ passive: true }`: neither
    // handler ever calls preventDefault(), so marking them passive lets the
    // browser start scrolling/handling the touch immediately instead of
    // waiting to see if we'll block it.
    function handleTouchEnd(event: TouchEvent) {
      const touch = event.changedTouches[0];
      if (touch && tooltipRef.current?.contains(touch.target as Node)) return;
      updateFromSelection();
    }

    function handleTouchStart(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch) return;
      dismissOnFreshInteraction(touch.target as Node);
    }

    // Fallback specifically for touch-only devices: dragging a native
    // selection HANDLE (the two teardrop grips iOS/Android show once text is
    // selected) is handled entirely by the OS's own touch layer, not the
    // page's — it never fires a `touchend` on our container mid-drag, only
    // once the student lifts their finger, and by then the handle may have
    // been dragged well outside the container without us ever seeing a
    // touch event there at all. `selectionchange` is the one signal that
    // fires reliably regardless of *how* the Selection object changed, so it
    // catches handle-drag adjustments touchend/mouseup structurally can't.
    // Debounced (150ms) because it fires on every micro-adjustment during a
    // drag — without this the tooltip would flicker/reposition continuously
    // instead of settling once after the student stops adjusting.
    function handleSelectionChange() {
      if (selectionChangeTimeoutRef.current) clearTimeout(selectionChangeTimeoutRef.current);
      selectionChangeTimeoutRef.current = setTimeout(updateFromSelection, 150);
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (selectionChangeTimeoutRef.current) clearTimeout(selectionChangeTimeoutRef.current);
    };
  }, [container]);

  return { containerRef, container, tooltipRef, selection, clearSelection: () => setSelection(null) };
}
