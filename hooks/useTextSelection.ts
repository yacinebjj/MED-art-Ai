"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export interface TextSelectionState {
  text: string;
  top: number;
  left: number;
}

interface UseTextSelectionResult {
  /** Attach to the element whose text can be selected. */
  containerRef: RefObject<HTMLDivElement>;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<TextSelectionState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleMouseUp() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";

      if (!sel || text.length === 0 || sel.rangeCount === 0) {
        return;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Ignore empty/zero-size ranges (can happen on a stray mouseup).
      if (rect.width === 0 && rect.height === 0) return;

      setSelection({
        text,
        top: rect.top + window.scrollY - 50,
        left: rect.left + window.scrollX + rect.width / 2,
      });
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

    container.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  return { containerRef, tooltipRef, selection, clearSelection: () => setSelection(null) };
}
