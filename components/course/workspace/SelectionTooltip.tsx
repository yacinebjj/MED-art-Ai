"use client";

import { forwardRef } from "react";
import { createPortal } from "react-dom";
import { MessageCircleQuestion, Languages } from "lucide-react";
import type { TextSelectionState } from "@/hooks/useTextSelection";

/**
 * Rendered through a Portal straight into `document.body` — the bug report
 * ("only appears when the window is shrunk") is the classic symptom of a
 * `position: fixed` descendant getting trapped by an ANCESTOR that
 * establishes its own containing block (any `transform`/`filter`/
 * `will-change` on something between here and <body>, several of which this
 * workspace's panel-shell/split-screen transition classes apply). A fixed
 * element is then positioned relative to THAT ancestor's box instead of the
 * real viewport, so the (correctly viewport-relative, see
 * useTextSelection.ts) coordinates land outside of it at most window sizes.
 * Portaling to `document.body` — which has no such ancestor — sidesteps the
 * problem entirely regardless of which specific class is the culprit, and is
 * the standard fix for exactly this class of bug.
 */
export const SelectionTooltip = forwardRef<
  HTMLDivElement,
  {
    selection: TextSelectionState;
    onAsk: (text: string) => void;
    onTranslate: (text: string) => void;
  }
>(function SelectionTooltip({ selection, onAsk, onTranslate }, ref) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      style={{ top: selection.top, left: selection.left }}
      className="fixed z-[99999] flex -translate-x-1/2 gap-2 rounded-lg bg-gray-900 p-2 shadow-xl"
    >
      <button
        onClick={() => onAsk(selection.text)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10"
      >
        <MessageCircleQuestion className="h-3.5 w-3.5" />
        Ask MedArt
      </button>
      <div className="w-px bg-white/20" />
      <button
        onClick={() => onTranslate(selection.text)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10"
      >
        <Languages className="h-3.5 w-3.5" />
        Translate
      </button>
    </div>,
    document.body
  );
});
