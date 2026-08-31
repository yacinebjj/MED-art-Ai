"use client";

import { FileText, PanelLeftClose } from "lucide-react";

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
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Document source</h2>
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer le document source"
          className="shrink-0 rounded-xl p-2 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      {/* text-reading (a hair larger, more generous line-height/tracking than
          text-sm) — this is raw, continuous document text meant to be read
          start to finish, the exact long-form case that class exists for. */}
      <div className="flex-1 overflow-y-auto p-6">
        {rawText.trim() ? (
          <pre className="text-reading whitespace-pre-wrap break-words font-sans text-foreground/90">
            {rawText}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Aucun texte source disponible pour ce cours.</p>
        )}
      </div>
    </>
  );
}
