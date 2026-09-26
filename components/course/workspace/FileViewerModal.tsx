"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, Minus, Plus } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/Dialog";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
/** Formats Google Docs Viewer can render that a bare iframe can't (no native browser PDF-style rendering). */
const OFFICE_VIEWER_EXTENSIONS = ["doc", "docx", "ppt", "pptx", "xls", "xlsx"];

function getExtension(value: string): string {
  return value.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

/**
 * Full-bleed page canvas on a dark backdrop with a floating pill toolbar —
 * the OneDrive/Google-Drive PDF viewer look, instead of a cramped reader
 * squeezed into a small dialog.
 */
function PdfReader({ fileUrl, title }: { fileUrl: string; title: string }) {
  const readerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  // Pinch-to-zoom (touch) and trackpad pinch (ctrl+wheel) both re-run this
  // through setZoom -> a real react-pdf re-render at the new resolution,
  // instead of the browser's native page-zoom, which just stretches the
  // already-rendered canvas bitmap and comes out blurry. `activeTouches`
  // tracks live pointers by id; `pinchStart` is the {distance, zoom}
  // snapshot taken the instant the second finger touches down.
  const activeTouches = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouches.current.size === 2) {
      const [a, b] = Array.from(activeTouches.current.values());
      pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!activeTouches.current.has(event.pointerId)) return;
    activeTouches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activeTouches.current.size === 2 && pinchStart.current) {
      const [a, b] = Array.from(activeTouches.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const next = pinchStart.current.zoom * (distance / pinchStart.current.distance);
      setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
    }
  };

  const endTouch = (event: React.PointerEvent) => {
    activeTouches.current.delete(event.pointerId);
    if (activeTouches.current.size < 2) pinchStart.current = null;
  };

  const handleWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey) return; // trackpad pinch surfaces as a synthetic ctrl+wheel
    event.preventDefault();
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current - event.deltaY * 0.01)));
  };

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setPageNumber((current) => Math.min(numPages || current, current + 1));
      if (event.key === "ArrowLeft") setPageNumber((current) => Math.max(1, current - 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [numPages]);

  // Full-screen container, so this can stretch far wider than the old 960px
  // modal cap — 1400 keeps very large monitors from rendering a blurry
  // over-stretched page while still reading as "big".
  const pageWidth = containerWidth > 0 ? Math.min(1400, Math.max(280, containerWidth - 64)) * zoom : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900">
      <div
        ref={readerRef}
        className="min-h-0 flex-1 overflow-auto px-4 pb-28 pt-8 sm:px-10 sm:pt-10"
        style={{ touchAction: "pan-x pan-y" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endTouch}
        onPointerCancel={endTouch}
        onPointerLeave={endTouch}
        onWheel={handleWheel}
      >
        {error ? (
          <iframe
            src={fileUrl}
            title={title || "Lecteur PDF"}
            className="h-full min-h-[70vh] w-full rounded-lg border-0 bg-white"
          />
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: loadedPages }) => {
              setNumPages(loadedPages);
              setPageNumber((current) => Math.min(current, loadedPages));
            }}
            onLoadError={(loadError) => {
              console.error("[pdf-reader] PDF.js failed to load the document:", loadError);
              setError(true);
            }}
            loading={<p className="py-20 text-center text-sm text-neutral-400">Chargement du PDF...</p>}
            className="flex min-h-full flex-col items-center"
          >
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              scale={pageWidth ? undefined : zoom}
              renderTextLayer
              renderAnnotationLayer
              loading={<p className="py-20 text-center text-sm text-neutral-400">Rendu de la page...</p>}
              className="max-w-none overflow-hidden rounded-sm bg-white shadow-2xl"
            />
          </Document>
        )}
      </div>

      {!error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-neutral-800/95 px-2 py-1.5 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-1" aria-label="Contrôles de page">
              <button
                type="button"
                onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
                disabled={pageNumber <= 1 || !numPages}
                className="rounded-full p-2 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
                aria-label="Page précédente"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-16 text-center text-xs font-medium tabular-nums text-neutral-200">
                {numPages ? `${pageNumber} / ${numPages}` : "..."}
              </span>
              <button
                type="button"
                onClick={() => setPageNumber((current) => Math.min(numPages, current + 1))}
                disabled={!numPages || pageNumber >= numPages}
                className="rounded-full p-2 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
                aria-label="Page suivante"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mx-1 h-5 w-px bg-white/10" />

            <div className="flex items-center gap-1" aria-label="Contrôles de zoom">
              <button
                type="button"
                onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - 0.25))}
                disabled={zoom <= MIN_ZOOM}
                className="rounded-full p-2 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
                aria-label="Réduire le zoom"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-12 text-center text-xs font-medium tabular-nums text-neutral-300">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + 0.25))}
                disabled={zoom >= MAX_ZOOM}
                className="rounded-full p-2 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
                aria-label="Augmenter le zoom"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

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
 * raw extracted text, full-screen (OneDrive/Google-Drive style) rather than
 * a small centered popup — the cramped version was unusable on phones and
 * showed the page far too small on desktop. PDFs render directly via
 * react-pdf; DOCX/PPTX/XLS(X) route through Google Docs Viewer, which knows
 * how to render Office formats a bare iframe can't. Falls back to the raw
 * extracted text whenever there's no original file to show — pasted-text
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
        className="inset-0 flex h-full w-full max-w-none max-h-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none"
        onOverlayClick={() => onOpenChange(false)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 pr-16 sm:px-6 sm:pr-20">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-4 w-4" />
          </span>
          <DialogTitle className="truncate text-base font-semibold text-foreground">
            {title || "Document source"}
          </DialogTitle>
          {fileUrl ? (
            <a
              href={fileUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Télécharger</span>
            </a>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1 bg-neutral-900">
          {isPdf && fileUrl ? (
            <PdfReader fileUrl={fileUrl} title={title} />
          ) : iframeSrc ? (
            <iframe src={iframeSrc} title={title} className="h-full w-full border-0 bg-white" />
          ) : rawText.trim() ? (
            <div className="h-full w-full overflow-y-auto bg-background p-6 sm:p-10">
              <div className="mx-auto max-w-3xl">
                {/* text-select-stable — see its own comment in app/globals.css: fixes a sub-pixel blur on text selection under a Framer Motion ancestor's transform. */}
                <pre className="text-reading text-select-stable whitespace-pre-wrap break-words font-sans text-foreground">{rawText}</pre>
              </div>
            </div>
          ) : (
            <p className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Aucun contenu disponible pour ce cours.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
