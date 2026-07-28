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

  useEffect(() => {
    if (!container) return;

    function handleMouseUp() {
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

      // Ignore empty/zero-size ranges (can happen on a stray mouseup).
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

    function handleMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      const clickedInsideTooltip = tooltipRef.current?.contains(target);
      if (clickedInsideTooltip) return;

      // A fresh mousedown that isn't on the tooltip always starts a new
      // interaction (new selection or just a dismissal click) — hide for now,
      // handleMouseUp will show it again if a new selection results.
      setSelection(null);
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [container]);

  return { containerRef, tooltipRef, selection, clearSelection: () => setSelection(null) };
}
