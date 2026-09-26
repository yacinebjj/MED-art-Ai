"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Minus, Plus } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
/** Formats Google Docs Viewer can render that a bare iframe can't (no native browser PDF-style rendering). */
const OFFICE_VIEWER_EXTENSIONS = ["doc", "docx", "ppt", "pptx", "xls", "xlsx"];

function getExtension(value: string): string {
  return value.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
}

function PdfReader({ fileUrl, title }: { fileUrl: string; title: string }) {
  const readerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = readerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setNumPages(0);
    setPageNumber(1);
    setZoom(1);
    setError(false);
  }, [fileUrl]);

  const pageWidth = containerWidth > 0 ? Math.min(960, Math.max(240, containerWidth - 24)) * zoom : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted/40 shadow-soft">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-1" aria-label="Contrôles de page">
          <button
            type="button"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={pageNumber <= 1 || !numPages}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Page précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-16 text-center text-xs font-medium tabular-nums text-foreground">
            {numPages ? `${pageNumber} / ${numPages}` : "..."}
          </span>
          <button
            type="button"
            onClick={() => setPageNumber((current) => Math.min(numPages, current + 1))}
            disabled={!numPages || pageNumber >= numPages}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Page suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1" aria-label="Contrôles de zoom">
          <button
            type="button"
            onClick={() => setZoom((current) => Math.max(0.75, current - 0.25))}
            disabled={zoom <= 0.75}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Réduire le zoom"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center text-xs font-medium tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((current) => Math.min(2, current + 0.25))}
            disabled={zoom >= 2}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Augmenter le zoom"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div ref={readerRef} className="min-h-0 flex-1 overflow-auto p-3 sm:p-6">
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages: loadedPages }) => {
            setNumPages(loadedPages);
            setPageNumber((current) => Math.min(current, loadedPages));
          }}
          onLoadError={() => setError(true)}
          loading={<p className="py-12 text-center text-sm text-muted-foreground">Chargement du PDF...</p>}
          error={<p className="py-12 text-center text-sm text-destructive">Impossible d’afficher ce PDF.</p>}
          className="flex min-h-full flex-col items-center gap-4"
        >
          {error ? null : (
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              scale={pageWidth ? undefined : zoom}
              renderTextLayer
              renderAnnotationLayer
              loading={<p className="py-12 text-center text-sm text-muted-foreground">Rendu de la page...</p>}
              className="max-w-none overflow-hidden rounded-sm bg-white shadow-md"
            />
          )}
        </Document>
      </div>
      <span className="sr-only">Lecteur PDF pour {title}</span>
    </div>
  );
}

interface FileViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fileUrl: string | null;
  rawText: string;
}

/**
 * "Afficher le cours" — renders the REAL uploaded file (see
 * app/api/upload/route.ts's Supabase Storage upload) instead of just the
 * raw extracted text. PDFs render directly in the iframe (browsers render
 * pagination and responsive reading; DOCX/PPTX/XLS(X) route through Google Docs Viewer, which
 * knows how to render Office formats a bare iframe can't. Falls back to the
 * raw extracted text whenever there's no original file to show — pasted-text
 * courses have no `fileUrl` at all, and courses uploaded before this feature
 * existed have `sourceFileUrl: null`.
 */
export function FileViewerModal({ open, onOpenChange, title, fileUrl, rawText }: FileViewerModalProps) {
  // Prefer the extension baked into the Storage path itself — it's derived
  // straight from the original file.name at upload time (see
  // app/api/upload/route.ts's uploadSourceFile), so it's always correct even
  // if `title` was ever edited down the line to no longer end in the real
  // extension. `title` is only a fallback for the (currently impossible, but
  // defensive) case where `fileUrl` itself has none.
  const extension = fileUrl ? getExtension(fileUrl) || getExtension(title) : "";
  const isPdf = extension === "pdf";
  const iframeSrc = fileUrl && !isPdf
    ? OFFICE_VIEWER_EXTENSIONS.includes(extension)
      ? `https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`
      : fileUrl
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100%-1rem)] max-h-[calc(100%-1rem)] max-w-6xl flex-col overflow-hidden rounded-xl p-3 sm:h-[calc(100%-2rem)] sm:max-h-[calc(100%-2rem)] sm:rounded-2xl sm:p-6"
        onOverlayClick={() => onOpenChange(false)}
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 truncate">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{title || "Document source"}</span>
          </DialogTitle>
        </DialogHeader>

        {isPdf && fileUrl ? (
          <PdfReader fileUrl={fileUrl} title={title} />
        ) : iframeSrc ? (
          <iframe src={iframeSrc} title={title} className="min-h-0 w-full flex-1 rounded-xl border border-border shadow-soft" />
        ) : rawText.trim() ? (
          <div className="h-[80vh] w-full overflow-y-auto rounded-xl border border-border bg-muted/30 p-6 shadow-soft">
            {/* text-select-stable — see its own comment in app/globals.css: fixes a sub-pixel blur on text selection under a Framer Motion ancestor's transform. */}
            <pre className="text-reading text-select-stable whitespace-pre-wrap break-words font-sans text-foreground">{rawText}</pre>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Aucun contenu disponible pour ce cours.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
