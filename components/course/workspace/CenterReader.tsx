"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, AlertTriangle, Maximize2, Minimize2 } from "lucide-react";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useFullscreen } from "@/hooks/useFullscreen";
import { cn } from "@/lib/utils";
import { PROSE_CLASSES, MARKDOWN_COMPONENTS } from "@/lib/markdown";
import { SelectionTooltip } from "./SelectionTooltip";

export function CenterReader({
  content,
  isLoading,
  error,
  onAsk,
  onTranslate,
}: {
  content: string | null;
  isLoading: boolean;
  error: string | null;
  onAsk: (text: string) => void;
  onTranslate: (text: string) => void;
}) {
  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  function handleAsk(text: string) {
    onAsk(text);
    clearSelection();
  }

  function handleTranslate(text: string) {
    onTranslate(text);
    clearSelection();
  }

  return (
    <div
      className={cn(
        "relative flex-1 overflow-y-auto",
        isFullscreen && "fixed inset-0 z-40 bg-[#F9FAFB]"
      )}
    >
      <div className="sticky top-0 z-50 flex justify-end p-4">
        <button
          onClick={toggleFullscreen}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-gray-50"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="h-3.5 w-3.5" />
              Quitter le plein écran
            </>
          ) : (
            <>
              <Maximize2 className="h-3.5 w-3.5" />
              Plein écran
            </>
          )}
        </button>
      </div>

      <div className="flex justify-center px-8 pb-8">
        <div
          ref={containerRef}
          onContextMenu={(e) => e.preventDefault()}
          className="w-full max-w-4xl select-text rounded-xl bg-white p-10 shadow-lg"
        >
          {isLoading && (
            <div className="flex items-center gap-3 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Le professeur prépare ton cours…
            </div>
          )}

          {!isLoading && error && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!isLoading && !error && content && (
            <article className={PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {content}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>

      {selection && (
        <SelectionTooltip
          ref={tooltipRef}
          selection={selection}
          onAsk={handleAsk}
          onTranslate={handleTranslate}
        />
      )}
    </div>
  );
}
