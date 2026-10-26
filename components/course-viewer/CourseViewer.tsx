"use client";

import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, X } from "lucide-react";
import { officeEmbedUrl, resolveViewerKind } from "./file-kind";
import { loadWithRetry } from "./load-with-retry";
import { ExtractedTextView, ViewerErrorBoundary, ViewerStatus } from "./shared";
import type { CourseViewerProps } from "./types";
import "./course-viewer.css";

// Each renderer is its own chunk: opening a PDF never downloads the PPTX
// engine and vice versa. Retried, because a dropped chunk request on mobile
// used to be enough to break the whole viewer.
const PdfViewer = lazy(() => loadWithRetry(() => import("./pdf/PdfViewer")).then((m) => ({ default: m.PdfViewer })));
const PptxViewer = lazy(() => loadWithRetry(() => import("./pptx/PptxViewer")).then((m) => ({ default: m.PptxViewer })));

/**
 * Above the app's own overlays (ExplicationReader z-9990), below the
 * SecurityGuard blur (z-9998) and toasts (z-9999).
 */
const VIEWER_Z_INDEX = 9995;

const FALLBACK_NOTICE: Record<"pdf" | "pptx" | "crash", string> = {
  pdf: "Ce PDF n'a pas pu être affiché ici — voici son texte. Tu peux aussi ouvrir le fichier original.",
  pptx: "Cette présentation n'a pas pu être affichée en diapositives — voici son texte. Tu peux aussi ouvrir le fichier original.",
  crash: "Le lecteur n'a pas pu s'ouvrir (connexion instable ou application mise à jour) — voici le texte du cours. Recharge la page pour réessayer, ou ouvre le fichier original.",
};

/**
 * "Afficher le cours": the course's ORIGINAL uploaded file, full-screen.
 *
 * Self-contained by design — it has broken repeatedly when shared UI it
 * depended on changed (the Radix Dialog's mobile bottom-sheet rework, global
 * CSS, the page around it). So it renders its own portal overlay instead of
 * components/ui/Dialog, keeps its styles in course-viewer.css, and depends on
 * nothing in hooks/ or components/ui. Every renderer is wrapped so that any
 * failure (network, corrupt file, chunk load, render crash) degrades to the
 * extracted text instead of a blank screen or a crashed page.
 *
 * Mount it only while open; unmounting closes it.
 */
export function CourseViewer({ title, fileUrl, rawText, onClose, closing = false }: CourseViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [failure, setFailure] = useState<keyof typeof FALLBACK_NOTICE | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const kind = resolveViewerKind(fileUrl, title);
  const displayTitle = title || "Document source";

  useEffect(() => setMounted(true), []);

  // Page behind stays put: no background scroll / pull-to-refresh while reading.
  useEffect(() => {
    const { body, documentElement } = document;
    const previous = { overflow: body.style.overflow, overscroll: documentElement.style.overscrollBehavior };
    body.style.overflow = "hidden";
    documentElement.style.overscrollBehavior = "none";
    return () => {
      body.style.overflow = previous.overflow;
      documentElement.style.overscrollBehavior = previous.overscroll;
    };
  }, []);

  // Focus moves into the viewer and returns to whatever opened it.
  useEffect(() => {
    if (!mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [mounted]);

  // Esc closes — in the capture phase, so the page's own shortcuts behind
  // the viewer never see it. During a PPTX slideshow Esc belongs to the
  // slideshow (it only leaves the slideshow), so it's left alone here.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".course-viewer [data-presenting='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const failPdf = useCallback(() => setFailure("pdf"), []);
  const failPptx = useCallback(() => setFailure("pptx"), []);

  if (!mounted) return null;

  const textFallback = (reason: keyof typeof FALLBACK_NOTICE) => (
    <ExtractedTextView rawText={rawText} notice={FALLBACK_NOTICE[reason]} fileUrl={fileUrl} />
  );

  let body: React.ReactNode;
  if (failure) {
    body = textFallback(failure);
  } else if (kind === "pdf" && fileUrl) {
    body = <PdfViewer key={fileUrl} fileUrl={fileUrl} title={displayTitle} onFailed={failPdf} />;
  } else if (kind === "pptx" && fileUrl) {
    body = <PptxViewer key={fileUrl} fileUrl={fileUrl} title={displayTitle} onFailed={failPptx} />;
  } else if ((kind === "office" || kind === "native") && fileUrl) {
    body = (
      <iframe
        src={kind === "office" ? officeEmbedUrl(fileUrl) : fileUrl}
        title={displayTitle}
        className="h-full w-full border-0 bg-white"
      />
    );
  } else {
    body = <ExtractedTextView rawText={rawText} />;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-closing={closing}
      className="course-viewer fixed inset-0 flex flex-col bg-neutral-900"
      style={{ zIndex: VIEWER_Z_INDEX }}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 bg-neutral-950 px-3 pb-2 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] text-neutral-100 sm:px-5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10" aria-hidden>
          <FileText className="h-4 w-4" />
        </span>
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {displayTitle}
        </h2>
        {fileUrl && (
          <a
            href={fileUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Télécharger</span>
          </a>
        )}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Fermer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-300 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <main className="relative min-h-0 flex-1 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <ViewerErrorBoundary key={failure ?? "ok"} fallback={textFallback("crash")}>
          <Suspense fallback={<ViewerStatus label="Ouverture du lecteur..." />}>{body}</Suspense>
        </ViewerErrorBoundary>
      </main>
    </div>,
    document.body
  );
}
