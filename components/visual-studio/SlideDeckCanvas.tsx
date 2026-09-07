"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { VisualRenderer } from "@/components/visual-studio/VisualRenderer";
import { LearningModeDrawer } from "@/components/visual-studio/LearningModeDrawer";
import { DOMAIN_ICON, DOMAIN_LABEL, SLIDE_THEME_STYLES } from "@/lib/presentation-theme";
import type { Slide } from "@/lib/presentation-types";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.2;
const ZOOM_STEP = 0.5;
const SNAP_TO_IDENTITY_EPSILON = 0.02;
const DOUBLE_TAP_MAX_DELAY_MS = 320;
const DOUBLE_TAP_MAX_DISTANCE_PX = 32;
const TAP_MAX_MOVEMENT_PX = 10;
const SWIPE_MIN_DISTANCE_PX = 48;
const SWIPE_MAX_VERTICAL_RATIO = 0.6;

interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY_TRANSFORM: ZoomTransform = { scale: 1, x: 0, y: 0 };

export interface SlideDeckCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

interface SlideDeckCanvasProps {
  slide: Slide;
  slides: Slide[];
  currentIndex: number;
  tocOpen: boolean;
  searchQuery: string;
  isDark?: boolean;
  onGoTo: (index: number) => void;
  onCloseTOC: () => void;
  /** Reports the live zoom scale up to the parent, so the control bar can display/drive it. */
  onZoomChange?: (scale: number) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Rescales a transform while keeping the content point under `focal` (viewport-local px) visually fixed. */
function zoomAtPoint(prev: ZoomTransform, nextScale: number, focal: { x: number; y: number }): ZoomTransform {
  const clampedScale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);
  if (clampedScale <= MIN_ZOOM + SNAP_TO_IDENTITY_EPSILON) return IDENTITY_TRANSFORM;
  const ratio = clampedScale / prev.scale;
  return {
    scale: clampedScale,
    x: focal.x - (focal.x - prev.x) * ratio,
    y: focal.y - (focal.y - prev.y) * ratio,
  };
}

export const SlideDeckCanvas = forwardRef<SlideDeckCanvasHandle, SlideDeckCanvasProps>(function SlideDeckCanvas(
  { slide, slides, currentIndex, tocOpen, searchQuery, isDark = false, onGoTo, onCloseTOC, onZoomChange },
  ref
) {
  const theme = SLIDE_THEME_STYLES[slide.theme];
  const DomainIcon = DOMAIN_ICON[slide.domain];

  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<ZoomTransform>(IDENTITY_TRANSFORM);
  const [isGesturing, setIsGesturing] = useState(false);
  const zoomed = transform.scale > 1;
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Ephemeral gesture bookkeeping — refs so touch/mouse moves don't force re-renders on their own.
  const pinchRef = useRef<{ startDistance: number; startScale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startTransform: ZoomTransform } | null>(null);
  const swipeRef = useRef<{ startX: number; startY: number } | null>(null);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  const applyTransform = (next: ZoomTransform) => {
    setTransform(next);
    onZoomChange?.(next.scale);
  };

  // A lingering zoom must never leak onto the next slide — reset on every slide change.
  useEffect(() => {
    setTransform(IDENTITY_TRANSFORM);
    onZoomChange?.(1);
    // Only currentIndex should trigger this reset — onZoomChange identity churn must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  function viewportCenter() {
    const rect = viewportRef.current?.getBoundingClientRect();
    return rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 };
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => applyTransform(zoomAtPoint(transform, transform.scale + ZOOM_STEP, viewportCenter())),
    zoomOut: () => applyTransform(zoomAtPoint(transform, transform.scale - ZOOM_STEP, viewportCenter())),
    resetZoom: () => applyTransform(IDENTITY_TRANSFORM),
  }));

  // Wheel-to-zoom (desktop) needs a real, non-passive listener: React registers its
  // own onWheel prop as passive (to match the browser's fast-scroll defaults), so
  // calling preventDefault() from that synthetic handler can't stop the page scroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function handleWheelNative(event: WheelEvent) {
      event.preventDefault();
      const rect = el!.getBoundingClientRect();
      const focal = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setTransform((prev) => {
        const factor = Math.exp(-event.deltaY * 0.0015);
        const next = zoomAtPoint(prev, prev.scale * factor, focal);
        onZoomChange?.(next.scale);
        return next;
      });
    }

    el.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", handleWheelNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-and-drag pan (desktop, only once zoomed in).
  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (transform.scale <= 1) return;
    event.preventDefault();
    const startTransform = transform;
    const startX = event.clientX;
    const startY = event.clientY;
    setIsGesturing(true);

    function handleMouseMove(moveEvent: MouseEvent) {
      setTransform({
        scale: startTransform.scale,
        x: startTransform.x + (moveEvent.clientX - startX),
        y: startTransform.y + (moveEvent.clientY - startY),
      });
    }
    function handleMouseUp() {
      setIsGesturing(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  // Touch: two-finger pinch to zoom, one-finger pan once zoomed, one-finger swipe to
  // change slide at 1x, double-tap to toggle zoom. touch-action (set below, on the
  // viewport element) keeps the browser from fighting any of this with its own
  // native scroll/pinch handling, so these handlers never need preventDefault().
  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2) {
      swipeRef.current = null;
      panRef.current = null;
      pinchRef.current = {
        startDistance: distanceBetween(event.touches[0], event.touches[1]),
        startScale: transform.scale,
      };
      setIsGesturing(true);
      return;
    }

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      tapStartRef.current = { x: touch.clientX, y: touch.clientY };

      if (transform.scale > 1) {
        panRef.current = { startX: touch.clientX, startY: touch.clientY, startTransform: transform };
        setIsGesturing(true);
      } else {
        swipeRef.current = { startX: touch.clientX, startY: touch.clientY };
      }
    }
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2 && pinchRef.current) {
      const rect = viewportRef.current?.getBoundingClientRect();
      const [t1, t2] = [event.touches[0], event.touches[1]];
      const distance = distanceBetween(t1, t2);
      const nextScale = pinchRef.current.startScale * (distance / pinchRef.current.startDistance);
      const focal = rect
        ? { x: (t1.clientX + t2.clientX) / 2 - rect.left, y: (t1.clientY + t2.clientY) / 2 - rect.top }
        : { x: 0, y: 0 };
      setTransform((prev) => {
        const next = zoomAtPoint(prev, nextScale, focal);
        onZoomChange?.(next.scale);
        return next;
      });
      return;
    }

    if (event.touches.length === 1 && panRef.current) {
      const touch = event.touches[0];
      const { startX, startY, startTransform } = panRef.current;
      setTransform({
        scale: startTransform.scale,
        x: startTransform.x + (touch.clientX - startX),
        y: startTransform.y + (touch.clientY - startY),
      });
    }
    // At scale 1, a single-finger move is left alone — native vertical scroll
    // (touch-action: pan-y) handles it, and any horizontal swipe is resolved on release.
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const wasPinching = pinchRef.current !== null;
    if (event.touches.length < 2) pinchRef.current = null;
    if (event.touches.length === 0) {
      panRef.current = null;
      setIsGesturing(false);
    }

    const swipe = swipeRef.current;
    swipeRef.current = null;
    const tapStart = tapStartRef.current;
    tapStartRef.current = null;

    const endTouch = event.changedTouches[0];
    if (!endTouch || wasPinching) return;

    // Swipe-to-change-slide — only when not zoomed in, so it never competes with panning.
    if (swipe && transform.scale <= 1) {
      const dx = endTouch.clientX - swipe.startX;
      const dy = endTouch.clientY - swipe.startY;
      if (Math.abs(dx) >= SWIPE_MIN_DISTANCE_PX && Math.abs(dy) <= Math.abs(dx) * SWIPE_MAX_VERTICAL_RATIO) {
        if (dx < 0 && currentIndex < slides.length - 1) onGoTo(currentIndex + 1);
        else if (dx > 0 && currentIndex > 0) onGoTo(currentIndex - 1);
        return;
      }
    }

    // Double-tap to toggle zoom.
    if (!tapStart) return;
    const moved = Math.hypot(endTouch.clientX - tapStart.x, endTouch.clientY - tapStart.y);
    if (moved >= TAP_MAX_MOVEMENT_PX) {
      lastTapRef.current = null;
      return;
    }

    const now = Date.now();
    const lastTap = lastTapRef.current;
    const isDoubleTap =
      !!lastTap &&
      now - lastTap.time < DOUBLE_TAP_MAX_DELAY_MS &&
      Math.hypot(endTouch.clientX - lastTap.x, endTouch.clientY - lastTap.y) < DOUBLE_TAP_MAX_DISTANCE_PX;

    if (isDoubleTap) {
      lastTapRef.current = null;
      const rect = viewportRef.current?.getBoundingClientRect();
      const focal = rect ? { x: endTouch.clientX - rect.left, y: endTouch.clientY - rect.top } : { x: 0, y: 0 };
      applyTransform(transform.scale > 1.05 ? IDENTITY_TRANSFORM : zoomAtPoint(IDENTITY_TRANSFORM, DOUBLE_TAP_ZOOM, focal));
    } else {
      lastTapRef.current = { time: now, x: endTouch.clientX, y: endTouch.clientY };
    }
  }

  const filteredSlides = slides
    .map((s, i) => ({ slide: s, index: i }))
    .filter(
      ({ slide: s }) =>
        searchQuery.trim() === "" || s.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
    );

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border-2 bg-white transition-shadow duration-300",
            isDark ? "shadow-glass-dark" : "shadow-glass",
            theme.border
          )}
        >
          {/* Header */}
          <div
            className={cn(
              "shrink-0 bg-gradient-to-r px-6 py-5 transition-colors duration-500 sm:px-8 sm:py-6",
              theme.gradient
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
                  <DomainIcon className="h-3 w-3" />
                  {DOMAIN_LABEL[slide.domain]}
                </span>
                <h2 className="text-xl font-extrabold text-white sm:text-2xl">{slide.title}</h2>
                <p className="mt-1 text-sm text-white/85">{slide.subtitle}</p>
              </div>
            </div>
          </div>

          {/* Slide content — pinch/wheel-zoomable and, once zoomed, pannable. The zoom
              transform lives on its own inner layer so it never fights the entrance
              (fade + scale-in) animation on the layer above it. */}
          <div
            ref={viewportRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            className={cn(
              "relative min-h-0 flex-1 bg-white",
              zoomed ? "overflow-hidden select-none" : "overflow-y-auto",
              zoomed && (isGesturing ? "cursor-grabbing" : "cursor-grab")
            )}
            style={{ touchAction: zoomed ? "none" : "pan-y" }}
          >
            <div key={slide.id} className="animate-in fade-in-0 zoom-in-95 duration-300">
              <div
                className="p-5 sm:p-8"
                style={{
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transformOrigin: "0 0",
                  transition: isGesturing || prefersReducedMotion ? "none" : "transform 200ms ease-out",
                  willChange: zoomed ? "transform" : undefined,
                }}
              >
                <VisualRenderer slide={slide} />
              </div>
            </div>
          </div>

          <LearningModeDrawer key={slide.id} content={slide.learningMode} />
        </div>
      </div>

      {/* TOC / thumbnail drawer */}
      {tocOpen && (
          <>
            <div
              onClick={onCloseTOC}
              className="animate-in fade-in-0 absolute inset-0 z-20 bg-slate-900/30 backdrop-blur-sm duration-200"
              aria-hidden
            />
            <div
              className={cn(
                "animate-in slide-in-from-right absolute inset-y-0 right-0 z-30 flex w-72 flex-col border-l duration-300 ease-out sm:w-80",
                isDark ? "border-slate-700 bg-slate-800 shadow-glass-dark" : "border-slate-200 bg-white shadow-glass"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-between border-b p-4",
                  isDark ? "border-slate-700" : "border-slate-100"
                )}
              >
                <h3 className={cn("text-sm font-bold", isDark ? "text-white" : "text-slate-900")}>Sommaire</h3>
                <button
                  type="button"
                  onClick={onCloseTOC}
                  aria-label="Fermer le sommaire"
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full transition-colors active:scale-90",
                    isDark ? "text-slate-400 hover:bg-slate-700" : "text-slate-400 hover:bg-slate-100"
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
                {filteredSlides.length === 0 && (
                  <div className="flex flex-col items-center gap-2 p-6 text-center">
                    <Search className={cn("h-5 w-5", isDark ? "text-slate-600" : "text-slate-300")} />
                    <p className={cn("text-sm", isDark ? "text-slate-500" : "text-slate-400")}>
                      Aucune slide ne correspond à la recherche.
                    </p>
                  </div>
                )}
                {filteredSlides.map(({ slide: s, index }) => {
                  const isActive = index === currentIndex;
                  const sTheme = SLIDE_THEME_STYLES[s.theme];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onGoTo(index);
                        onCloseTOC();
                      }}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98]",
                        isActive
                          ? isDark
                            ? "border-white/15 bg-white/10 ring-1 ring-inset ring-white/10"
                            : cn(sTheme.border, sTheme.badgeBg)
                          : isDark
                            ? "border-transparent hover:bg-slate-700"
                            : "border-transparent hover:bg-slate-50"
                      )}
                    >
                      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", sTheme.dot)} />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-400">Slide {index + 1}</span>
                        <span
                          className={cn(
                            "block truncate text-sm font-medium",
                            isActive ? (isDark ? "text-white" : "text-slate-800") : isDark ? "text-slate-100" : "text-slate-800"
                          )}
                        >
                          {s.title}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
    </div>
  );
});
