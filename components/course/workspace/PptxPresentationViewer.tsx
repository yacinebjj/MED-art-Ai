"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Minimize2, PanelLeftClose, PanelLeftOpen, Play } from "lucide-react";
// Type-only: erased at compile time. The library itself is browser-only and
// is loaded with a dynamic import inside an effect (see the load effect).
import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/** Gap kept around the slide on the stage (per side), like PowerPoint's normal view. None while presenting. */
const STAGE_PADDING_DESKTOP = 32;
const STAGE_PADDING_MOBILE = 12;
const RAIL_THUMB_WIDTH = 168;
const STRIP_THUMB_WIDTH = 112;
/** Slideshow controls fade out after this much pointer inactivity, like a real presentation. */
const CONTROLS_IDLE_MS = 2500;
/** Coalesces a burst of resize events (window drag, entering fullscreen) into one refit. */
const REFIT_DEBOUNCE_MS = 80;
/** Horizontal travel (px) that counts as a swipe on touch screens. */
const SWIPE_THRESHOLD_PX = 50;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * One slide preview in the rail/strip, rendered by the viewer itself
 * (renderThumbnailToContainer: the slide laid out at native size, then
 * scaled — real DOM text, never a bitmap). Rendered lazily when it scrolls
 * near view, so a 100-slide deck doesn't lay out 100 slides on open.
 */
const SlideThumbnail = memo(function SlideThumbnail({
  viewer,
  index,
  width,
  aspect,
  active,
  showNumber,
  onSelect,
}: {
  viewer: PptxViewer;
  index: number;
  width: number;
  aspect: number;
  active: boolean;
  showNumber: boolean;
  onSelect: (index: number) => void;
}) {
  const cellRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const cell = cellRef.current;
    if (!cell) return;
    let handle: SlideHandle | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (handle || !entries.some((entry) => entry.isIntersecting)) return;
        handle = viewer.renderThumbnailToContainer(index, cell, { width });
        observer.disconnect();
      },
      { rootMargin: "300px" }
    );
    observer.observe(cell);
    return () => {
      observer.disconnect();
      handle?.dispose();
      cell.replaceChildren();
    };
  }, [viewer, index, width]);

  // Keep the current slide's preview in view as the student navigates.
  useEffect(() => {
    if (active) buttonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onSelect(index)}
      aria-label={`Diapositive ${index + 1}`}
      aria-current={active ? "true" : undefined}
      className="group flex shrink-0 items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      {showNumber && (
        <span className={cn("w-5 pt-0.5 text-right text-[11px] font-semibold tabular-nums", active ? "text-white" : "text-neutral-500")}>
          {index + 1}
        </span>
      )}
      <div
        ref={cellRef}
        style={{ width, height: Math.round(width / aspect) }}
        className={cn(
          // No transition: the selection ring switches instantly, like PowerPoint's slide rail.
          "pptx-stage pointer-events-none overflow-hidden rounded-[3px] bg-white",
          active ? "ring-2 ring-primary-500 ring-offset-2 ring-offset-neutral-950" : "ring-1 ring-white/10 group-hover:ring-white/40"
        )}
      />
    </button>
  );
});

/**
 * PowerPoint-style viewer for uploaded .pptx decks, built on
 * @aiden0z/pptx-renderer (Apache-2.0, the most-used pptx renderer on npm):
 * slides are rebuilt as real HTML/SVG — theme and master backgrounds, text,
 * shapes, tables, charts, SmartArt, equations, embedded fonts — so they stay
 * sharp at any size and text stays selectable.
 *
 * It behaves like a presentation, not a document: one slide at a time on a
 * stage, a numbered slide rail (a horizontal strip on phones), previous/next
 * with arrow keys, PageUp/PageDown, Space, Home/End and swipes, and a
 * "Présenter" slideshow — true fullscreen where the browser allows it
 * (otherwise it covers the viewer), click/→ to advance, Esc to leave.
 *
 * Renders `fallback` instead when the deck can't be downloaded or parsed.
 */
export function PptxPresentationViewer({ fileUrl, title, fallback }: { fileUrl: string; title: string; fallback: ReactNode }) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const nativeFullscreenRef = useRef(false);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [viewer, setViewer] = useState<PptxViewer | null>(null);
  const [slideCount, setSlideCount] = useState(0);
  const [current, setCurrent] = useState(0);
  const [aspect, setAspect] = useState(16 / 9);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [railOpen, setRailOpen] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Measure the free stage area; the slide box is fitted inside it below.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Fit the slide to BOTH the stage's width and height. The renderer's own
  // `fitMode: "contain"` only fits its container's WIDTH, so the container is
  // sized to the deck's aspect ratio here.
  const padding = presenting ? 0 : isDesktop ? STAGE_PADDING_DESKTOP : STAGE_PADDING_MOBILE;
  const availableWidth = Math.max(0, stageSize.width - padding * 2);
  const availableHeight = Math.max(0, stageSize.height - padding * 2);
  const boxWidth = Math.floor(Math.min(availableWidth, availableHeight * aspect));
  const boxHeight = Math.floor(boxWidth / aspect);

  // Download + parse + render slide 1.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const controller = new AbortController();
    let cancelled = false;
    let instance: PptxViewer | null = null;

    setStatus("loading");
    setViewer(null);
    setSlideCount(0);
    setCurrent(0);

    (async () => {
      try {
        const res = await fetch(fileUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const { PptxViewer: Viewer, RECOMMENDED_ZIP_LIMITS } = await import("@aiden0z/pptx-renderer");
        if (cancelled) return;

        const opened = await Viewer.open(bytes, box, {
          renderMode: "slide",
          fitMode: "contain",
          // Uploaded files are untrusted input — bound zip size/entries/media.
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          // pdf.js only renders rare EMF-embedded PDF previews; disabled so this
          // never pulls in a second pdf.js next to react-pdf's (it degrades
          // gracefully without it).
          pdfjs: false,
          // Parse slides and decode media on demand: large decks open fast.
          lazySlides: true,
          lazyMedia: true,
          signal: controller.signal,
          onSlideChange: (index) => setCurrent(index),
        });
        instance = opened;
        if (cancelled) {
          opened.destroy();
          return;
        }
        if (!opened.slideCount) throw new Error("Aucune diapositive lisible dans ce fichier.");

        setAspect(opened.slideWidth > 0 && opened.slideHeight > 0 ? opened.slideWidth / opened.slideHeight : 16 / 9);
        setSlideCount(opened.slideCount);
        setCurrent(opened.currentSlideIndex);
        setViewer(opened);
        setStatus("ready");
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error("[pptx-viewer] Impossible d'afficher la présentation:", error);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      instance?.destroy();
    };
  }, [fileUrl]);

  // Refit whenever the slide box changes size (window resize, rail toggle,
  // entering/leaving the slideshow). The renderer also watches its
  // container, but schedules that refit on an animation frame — rendering
  // again explicitly makes the refit deterministic.
  useEffect(() => {
    if (!viewer || boxWidth <= 0) return;
    const timer = setTimeout(() => {
      void viewer.renderSlide(viewer.currentSlideIndex);
    }, REFIT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [viewer, boxWidth, boxHeight]);

  const goTo = useCallback(
    (index: number) => {
      if (!viewer) return;
      const target = Math.max(0, Math.min(index, viewer.slideCount - 1));
      if (target === viewer.currentSlideIndex) return;
      setCurrent(target);
      void viewer.goToSlide(target).then(() => setCurrent(viewer.currentSlideIndex));
    },
    [viewer]
  );
  const next = useCallback(() => goTo(current + 1), [goTo, current]);
  const previous = useCallback(() => goTo(current - 1), [goTo, current]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);

  const startPresentation = useCallback(async () => {
    setPresenting(true);
    const root = rootRef.current;
    if (root?.requestFullscreen && !document.fullscreenElement) {
      try {
        await root.requestFullscreen();
        nativeFullscreenRef.current = true;
      } catch {
        // Not allowed here (e.g. iPhone Safari): the viewer still covers the
        // screen through its own fixed layout (see the root's classes).
        nativeFullscreenRef.current = false;
      }
    }
  }, []);

  const stopPresentation = useCallback(() => {
    setPresenting(false);
    if (nativeFullscreenRef.current && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    nativeFullscreenRef.current = false;
  }, []);

  // Leaving real fullscreen with the browser's own Esc / gesture ends the slideshow too.
  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement && nativeFullscreenRef.current) {
        nativeFullscreenRef.current = false;
        setPresenting(false);
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (nativeFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (presenting) {
      showControls();
    } else {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      setControlsVisible(true);
    }
  }, [presenting, showControls]);

  useEffect(
    () => () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    },
    []
  );

  // Keyboard navigation, PowerPoint-style. Registered in the CAPTURE phase
  // on window so that, during a slideshow, Esc ends the slideshow instead of
  // also reaching the surrounding dialog and closing the whole viewer.
  useEffect(() => {
    if (status !== "ready") return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      const key = event.key;
      if (presenting && key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        stopPresentation();
        return;
      }
      if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " ") {
        event.preventDefault();
        next();
      } else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
        event.preventDefault();
        previous();
      } else if (key === "Home") {
        event.preventDefault();
        goTo(0);
      } else if (key === "End") {
        event.preventDefault();
        goTo(slideCount - 1);
      } else if (key === "F5" && !presenting) {
        event.preventDefault(); // F5 would reload the page
        void startPresentation();
      } else {
        return;
      }
      if (presenting) showControls();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [status, presenting, next, previous, goTo, slideCount, startPresentation, stopPresentation, showControls]);

  function handleStagePointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse") return;
    swipeStartRef.current = { x: event.clientX, y: event.clientY };
  }

  function handleStagePointerUp(event: React.PointerEvent) {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || status !== "ready") return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else previous();
    }
  }

  // During the slideshow a click advances, like PowerPoint — except on a
  // link inside the slide, and except at the end of a touch swipe.
  function handleStageClick(event: React.MouseEvent) {
    if (!presenting || status !== "ready") return;
    if ((event.target as HTMLElement).closest("a, button")) return;
    showControls();
    next();
  }

  if (status === "error") return <>{fallback}</>;

  const railVisible = isDesktop && railOpen && !presenting && status === "ready" && viewer !== null;
  const stripVisible = !isDesktop && !presenting && status === "ready" && viewer !== null;
  const counter = slideCount ? `${current + 1} / ${slideCount}` : "…";

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="présentation"
      aria-label={`Présentation : ${title}`}
      className={cn(
        "flex h-full min-h-0 w-full overflow-hidden",
        // Slideshow: black, full screen. Also the fallback when the browser
        // refuses real fullscreen — fixed to the viewport, above everything.
        presenting ? "fixed inset-0 z-[100000] select-none bg-black" : "relative bg-neutral-900",
        presenting && !controlsVisible && "cursor-none"
      )}
      onMouseMove={presenting ? showControls : undefined}
    >
      {railVisible && viewer && (
        <aside
          aria-label="Diapositives"
          className="flex w-[212px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/10 bg-neutral-950 px-3 py-4"
        >
          {Array.from({ length: slideCount }, (_, index) => (
            <SlideThumbnail
              key={index}
              viewer={viewer}
              index={index}
              width={RAIL_THUMB_WIDTH}
              aspect={aspect}
              active={index === current}
              showNumber
              onSelect={goTo}
            />
          ))}
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          style={{ touchAction: "pan-y pinch-zoom" }}
          onPointerDown={handleStagePointerDown}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={() => {
            swipeStartRef.current = null;
          }}
          onClick={handleStageClick}
        >
          {/* The renderer owns this node's children; React never renders into it. */}
          <div ref={boxRef} className="pptx-stage shrink-0" style={{ width: boxWidth, height: boxHeight }} />

          {status === "loading" && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">Chargement de la présentation...</p>
          )}

          {presenting && (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-6 flex justify-center transition-opacity duration-300",
                controlsVisible ? "opacity-100" : "opacity-0"
              )}
            >
              <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-neutral-900/85 px-2 py-1.5 text-neutral-200 shadow-2xl backdrop-blur">
                <button type="button" onClick={previous} disabled={current <= 0} aria-label="Diapositive précédente" className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <span className="min-w-16 text-center text-sm font-medium tabular-nums">{counter}</span>
                <button type="button" onClick={next} disabled={current >= slideCount - 1} aria-label="Diapositive suivante" className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30">
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="mx-1 h-5 w-px bg-white/15" />
                <button type="button" onClick={stopPresentation} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium hover:bg-white/10">
                  <Minimize2 className="h-4 w-4" />
                  Quitter
                </button>
              </div>
            </div>
          )}
        </div>

        {stripVisible && viewer && (
          <div aria-label="Diapositives" className="flex shrink-0 gap-2 overflow-x-auto border-t border-white/10 bg-neutral-950 px-3 py-2">
            {Array.from({ length: slideCount }, (_, index) => (
              <SlideThumbnail
                key={index}
                viewer={viewer}
                index={index}
                width={STRIP_THUMB_WIDTH}
                aspect={aspect}
                active={index === current}
                showNumber={false}
                onSelect={goTo}
              />
            ))}
          </div>
        )}

        {!presenting && (
          <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-neutral-950 px-3 py-2 text-neutral-200">
            <div className="flex flex-1 items-center">
              {isDesktop && (
                <button
                  type="button"
                  onClick={() => setRailOpen((open) => !open)}
                  aria-label={railOpen ? "Masquer les miniatures" : "Afficher les miniatures"}
                  aria-pressed={railOpen}
                  className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {railOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={previous}
                disabled={status !== "ready" || current <= 0}
                aria-label="Diapositive précédente"
                className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span aria-live="polite" className="min-w-[7.5rem] text-center text-sm font-medium tabular-nums">
                {slideCount ? `Diapositive ${counter}` : counter}
              </span>
              <button
                type="button"
                onClick={next}
                disabled={status !== "ready" || current >= slideCount - 1}
                aria-label="Diapositive suivante"
                className="rounded-full p-2 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-1 justify-end">
              <button
                type="button"
                onClick={() => void startPresentation()}
                disabled={status !== "ready"}
                title="Présenter (F5)"
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-40"
              >
                <Play className="h-4 w-4 fill-current" />
                <span className="hidden sm:inline">Présenter</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
