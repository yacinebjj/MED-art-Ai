"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, AlertTriangle } from "lucide-react";
import { useTextSelection } from "@/hooks/useTextSelection";
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

  function handleAsk(text: string) {
    onAsk(text);
    clearSelection();
  }

  function handleTranslate(text: string) {
    onTranslate(text);
    clearSelection();
  }

  return (
    <div className="relative flex flex-1 justify-center overflow-y-auto p-8">
      <div
        ref={containerRef}
        onContextMenu={(e) => e.preventDefault()}
        className="prose prose-slate lg:prose-lg max-w-4xl select-text rounded-xl bg-white p-10 shadow-lg"
      >
        {isLoading && (
          <div className="flex items-center gap-3 not-prose text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Le professeur prépare ton cours…
          </div>
        )}

        {!isLoading && error && (
          <div className="flex items-center gap-3 not-prose rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {!isLoading && !error && content && (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        )}
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
