"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ViewerStatus, useMediaQuery } from "../shared";

/**
 * public/pdf.worker.min.mjs is copied from react-pdf's OWN pdfjs-dist by
 * scripts/copy-pdf-worker.js (postinstall). The version query makes browsers
 * fetch a fresh worker whenever that pdf.js version changes, so a worker
 * cached before a dependency upgrade can never be paired with the new API
 * ("The API version does not match the Worker version" → blank viewer).
 * The middleware matcher skips .mjs files, so this 1.3 MB file is served
 * straight from static hosting without an auth round trip.
 */
pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.min.mjs?v=${pdfjs.version}`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
/** Widest a page renders at zoom 1 — keeps big monitors from rasterizing an oversized page. */
const MAX_BASE_PAGE_WIDTH = 1400;
/** A4 placeholder ratio until the first page reports the document's real one. */
const DEFAULT_ASPECT_RATIO = 1.414;
/**
 * Canvas pixel budget per page. iOS Safari blanks any canvas above ~16.7 M
 * pixels and kills the tab once all canvases together pass a few hundred MB;
 * a phone at devicePixelRatio 3 zoomed in hit both (blank pages, then a
 * reload). Past the budget the canvas resolution is lowered instead — the
 * text layer stays crisp because it's real DOM text.
 */
const MAX_CANVAS_PIXELS_TOUCH = 5_000_000;
const MAX_CANVAS_PIXELS_DESKTOP = 16_000_000;
/** Ctrl+wheel (trackpad pinch) zoom is committed once the gesture pauses this long. */
const WHEEL_COMMIT_MS = 160;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

interface ZoomAnchor {
  /** Point under the fingers / cursor, relative to the scroll container's viewport. */
  x: number;
  y: number;
  /** committed zoom after / before */
  ratio: number;
}

/**
 * Continuous, scrollable page stack (OneDrive / Google Drive style) with a
 * floating pill toolbar. Only pages near the viewport get a real canvas; the
 * rest are same-sized placeholders, so a 300-page course opens as fast as a
 * 3-page one.
 *
 * Pinch-zoom and ctrl+wheel are previewed with a CSS transform (compositor
 * only, smooth even on low-end phones) and re-rasterized ONCE when the
 * gesture ends — re-rendering every canvas on each touchmove was the main
 * cause of the reader stuttering on mobile.
 */
export function PdfViewer({ fileUrl, title, onFailed }: { fileUrl: string; title: string; onFailed: () => void }) {
  const isTouch = useMediaQuery("(pointer: coarse)");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageNodes = useRef<Map<number, HTMLDivElement>>(new Map());
  const pendingAnchor = useRef<ZoomAnchor | null>(null);

  const [containerWidth, setContainerWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_ASPECT_RATIO);
  const [zoom, setZoom] = useState(1);
  const [progress, setProgress] = useState<number | null>(null);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Commits a new zoom level, keeping the point at (x, y) of the scroll viewport under the same spot of the document. */
  const commitZoom = useCallback((next: number, anchorX?: number, anchorY?: number) => {
    const scroller = scrollRef.current;
    const target = clampZoom(next);
    if (contentRef.current) contentRef.current.style.transform = "";
    if (!scroller || Math.abs(target - zoomRef.current) < 0.001) return;
    pendingAnchor.current = {
      x: anchorX ?? scroller.clientWidth / 2,
      y: anchorY ?? 0,
      ratio: target / zoomRef.current,
    };
    setZoom(target);
  }, []);

  // After a zoom commit re-sizes the pages, scroll so the anchor point stays put.
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const scroller = scrollRef.current;
    pendingAnchor.current = null;
    if (!anchor || !scroller) return;
    scroller.scrollLeft = (scroller.scrollLeft + anchor.x) * anchor.ratio - anchor.x;
    scroller.scrollTop = (scroller.scrollTop + anchor.y) * anchor.ratio - anchor.y;
  }, [zoom]);

  // Native, non-passive listeners: React registers touchmove/wheel as
  // passive, so preventDefault() there can't stop the browser from zooming
  // the whole page (blurry) instead of the document.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    let pinch: { distance: number; scale: number; x: number; y: number } | null = null;
    let wheelScale = 1;
    let wheelAnchor = { x: 0, y: 0 };
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;

    /** Previews `scale` (relative to the committed zoom) around a scroller-relative point, without re-rendering anything. */
    function preview(scale: number, x: number, y: number) {
      if (!content || !scroller) return;
      if (!content.style.transform) {
        // Origin in the content's own (untransformed) box, fixed for the whole gesture.
        const scrollerRect = scroller.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        content.style.transformOrigin = `${scrollerRect.left + x - contentRect.left}px ${scrollerRect.top + y - contentRect.top}px`;
      }
      content.style.transform = `scale(${scale})`;
    }

    function relativePoint(clientX: number, clientY: number) {
      const rect = scroller!.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 2) return;
      const [a, b] = [event.touches[0], event.touches[1]];
      const mid = relativePoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      pinch = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, scale: 1, ...mid };
    }

    function onTouchMove(event: TouchEvent) {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const [a, b] = [event.touches[0], event.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const committed = zoomRef.current;
      pinch.scale = clampZoom(committed * (distance / pinch.distance)) / committed;
      preview(pinch.scale, pinch.x, pinch.y);
    }

    function onTouchEnd(event: TouchEvent) {
      if (!pinch || event.touches.length >= 2) return;
      const { scale, x, y } = pinch;
      pinch = null;
      commitZoom(zoomRef.current * scale, x, y);
    }

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return; // trackpad pinch arrives as ctrl+wheel
      event.preventDefault();
      if (wheelTimer === null) {
        wheelScale = 1;
        wheelAnchor = relativePoint(event.clientX, event.clientY);
      } else {
        clearTimeout(wheelTimer);
      }
      const committed = zoomRef.current;
      wheelScale = clampZoom(committed * wheelScale * Math.exp(-event.deltaY * 0.01)) / committed;
      preview(wheelScale, wheelAnchor.x, wheelAnchor.y);
      wheelTimer = setTimeout(() => {
        wheelTimer = null;
        commitZoom(zoomRef.current * wheelScale, wheelAnchor.x, wheelAnchor.y);
      }, WHEEL_COMMIT_MS);
    }

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", onTouchEnd, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      if (wheelTimer) clearTimeout(wheelTimer);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [commitZoom]);

  const scrollToPage = useCallback((page: number) => {
    pageNodes.current.get(page)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight") scrollToPage(Math.min(numPages || pageNumber, pageNumber + 1));
      else if (event.key === "ArrowLeft") scrollToPage(Math.max(1, pageNumber - 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [numPages, pageNumber, scrollToPage]);

  // Follows the most visible page (toolbar counter + which pages get a canvas).
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !numPages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        let bestPage: number | null = null;
        let bestRatio = 0;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestPage = Number((entry.target as HTMLElement).dataset.page);
          }
        }
        if (bestPage) setPageNumber(bestPage);
      },
      { root: scroller, threshold: [0.1, 0.25, 0.5, 0.75, 1] }
    );
    pageNodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [numPages]);

  const gutter = isTouch ? 24 : 64;
  const baseWidth = containerWidth > 0 ? Math.min(MAX_BASE_PAGE_WIDTH, Math.max(240, containerWidth - gutter)) : 0;
  const pageWidth = baseWidth ? Math.round(baseWidth * zoom) : undefined;
  const pageHeight = pageWidth ? Math.round(pageWidth * aspectRatio) : undefined;
  const renderBuffer = isTouch ? 2 : 3;

  const pixelBudget = isTouch ? MAX_CANVAS_PIXELS_TOUCH : MAX_CANVAS_PIXELS_DESKTOP;
  const screenRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const canvasRatio =
    pageWidth && pageHeight ? Math.max(0.5, Math.min(screenRatio, Math.sqrt(pixelBudget / (pageWidth * pageHeight)))) : screenRatio;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-neutral-900">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-28 pt-4 sm:px-8 sm:pt-8" style={{ touchAction: "pan-x pan-y" }}>
        <div ref={contentRef} className="w-max min-w-full">
          {/* Document is mounted right away even while the container width
              is still unknown (it only gates the Pages below): the download
              and parse start in parallel with layout. */}
          <Document
            file={fileUrl}
            onLoadProgress={({ loaded, total }) => setProgress(total > 0 ? Math.min(1, loaded / total) : null)}
            onLoadSuccess={({ numPages: loadedPages }) => setNumPages(loadedPages)}
            onLoadError={(error) => {
              console.error("[course-viewer] pdf.js n'a pas pu ouvrir le document:", error);
              onFailed();
            }}
            onSourceError={(error) => {
              console.error("[course-viewer] Source PDF invalide:", error);
              onFailed();
            }}
            loading={<ViewerStatus label="Chargement du PDF..." progress={progress} />}
            error={<ViewerStatus label="Ouverture du PDF impossible." />}
            className="flex flex-col items-center gap-3 sm:gap-4"
          >
            {pageWidth
              ? Array.from({ length: numPages }, (_, index) => {
                  const page = index + 1;
                  const isNearViewport = Math.abs(page - pageNumber) <= renderBuffer;
                  return (
                    <div
                      key={page}
                      data-page={page}
                      ref={(node) => {
                        if (node) pageNodes.current.set(page, node);
                        else pageNodes.current.delete(page);
                      }}
                      style={{ width: pageWidth, minHeight: pageHeight }}
                      className="overflow-hidden rounded-sm bg-white shadow-2xl"
                    >
                      {isNearViewport && (
                        <Page
                          pageNumber={page}
                          width={pageWidth}
                          devicePixelRatio={canvasRatio}
                          renderTextLayer
                          renderAnnotationLayer
                          onLoadSuccess={(loaded) => {
                            if (page === 1 && loaded.originalWidth > 0) setAspectRatio(loaded.originalHeight / loaded.originalWidth);
                          }}
                          loading={<div style={{ height: pageHeight }} />}
                          error={<p className="px-4 py-16 text-center text-sm text-neutral-500">Page {page} illisible.</p>}
                        />
                      )}
                    </div>
                  );
                })
              : null}
          </Document>
        </div>
      </div>

      {numPages > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 pb-[env(safe-area-inset-bottom)] sm:bottom-6">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-neutral-800/95 px-1.5 py-1 text-neutral-200 shadow-2xl">
            <ToolbarButton label="Page précédente" disabled={pageNumber <= 1} onClick={() => scrollToPage(Math.max(1, pageNumber - 1))}>
              <ChevronLeft className="h-4 w-4" />
            </ToolbarButton>
            <span className="min-w-[4.25rem] text-center text-xs font-medium tabular-nums" aria-live="polite">
              {pageNumber} / {numPages}
            </span>
            <ToolbarButton label="Page suivante" disabled={pageNumber >= numPages} onClick={() => scrollToPage(Math.min(numPages, pageNumber + 1))}>
              <ChevronRight className="h-4 w-4" />
            </ToolbarButton>
            <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
            <ToolbarButton label="Réduire le zoom" disabled={zoom <= MIN_ZOOM} onClick={() => commitZoom(zoom - ZOOM_STEP)}>
              <Minus className="h-4 w-4" />
            </ToolbarButton>
            <button
              type="button"
              onClick={() => commitZoom(1)}
              title="Ajuster à la largeur"
              className="min-w-[3.25rem] rounded-full px-1 py-2 text-center text-xs font-medium tabular-nums text-neutral-300 hover:bg-white/10"
            >
              {Math.round(zoom * 100)}%
            </button>
            <ToolbarButton label="Augmenter le zoom" disabled={zoom >= MAX_ZOOM} onClick={() => commitZoom(zoom + ZOOM_STEP)}>
              <Plus className="h-4 w-4" />
            </ToolbarButton>
          </div>
        </div>
      )}

      <span className="sr-only">Lecteur PDF pour {title}</span>
    </div>
  );
}

function ToolbarButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-full p-2.5 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
