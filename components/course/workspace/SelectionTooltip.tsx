"use client";

import { forwardRef } from "react";
import { MessageCircleQuestion, Languages } from "lucide-react";
import type { TextSelectionState } from "@/hooks/useTextSelection";

export const SelectionTooltip = forwardRef<
  HTMLDivElement,
  {
    selection: TextSelectionState;
    onAsk: (text: string) => void;
    onTranslate: (text: string) => void;
  }
>(function SelectionTooltip({ selection, onAsk, onTranslate }, ref) {
  return (
    <div
      ref={ref}
      style={{ top: selection.top, left: selection.left }}
      className="fixed z-[60] flex -translate-x-1/2 gap-2 rounded-lg bg-gray-900 p-2 shadow-xl"
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
    </div>
  );
});
