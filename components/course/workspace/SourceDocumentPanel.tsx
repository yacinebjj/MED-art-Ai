"use client";

import { PanelLeftClose } from "lucide-react";

interface SourceDocumentPanelProps {
  title: string;
  rawText: string;
  onClose: () => void;
}

/**
 * The "original document" side of split-screen, deliberately separate from
 * <StudioPanel> — no tabs, no QCM, no "Générer" buttons, nothing
 * AI-generated. Plain <pre> rather than Markdown rendering: this is the raw
 * extracted source text (PDF/PPTX/DOCX text extraction), not authored
 * Markdown, so interpreting stray characters as Markdown syntax would risk
 * mangling it. Exists specifically so "Afficher le cours" can never again be
 * confused with opening the Explication/Résumé Studio tile.
 */
export function SourceDocumentPanel({ title, rawText, onClose }: SourceDocumentPanelProps) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Document source</h2>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le document source"
          className="shrink-0 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-gray-100"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {rawText.trim() ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-800 dark:text-gray-200">
            {rawText}
          </pre>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Aucun texte source disponible pour ce cours.</p>
        )}
      </div>
    </>
  );
}
