"use client";

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Search,
  LayoutGrid,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_ZOOM, MAX_ZOOM } from "@/components/visual-studio/SlideDeckCanvas";

export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 1.5, 2];

interface PPTXControlBarProps {
  currentIndex: number;
  totalSlides: number;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  isFullscreen: boolean;
  searchQuery: string;
  /** 0-1 fill fraction of the current slide's autoplay dwell time — doubles as the "narration sync" timeline. */
  autoplayProgress: number;
  /** Dark stage mode — inverts the dock's own chrome; slide content cards intentionally keep their designed light palette (the medical color-coding must stay legible/consistent regardless of stage theme). */
  isDark?: boolean;
  /** Current slide-canvas zoom, 1 = fit (no zoom) through MAX_ZOOM. */
  zoomLevel: number;
  onGoTo: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onToggleFullscreen: () => void;
  onToggleTOC: () => void;
  onSearchChange: (query: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function PPTXControlBar({
  currentIndex,
  totalSlides,
  isPlaying,
  playbackSpeed,
  isFullscreen,
  searchQuery,
  autoplayProgress,
  onGoTo,
  onPrev,
  onNext,
  onTogglePlay,
  onSpeedChange,
  onToggleFullscreen,
  onToggleTOC,
  onSearchChange,
  isDark = false,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: PPTXControlBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

  function handleScrubberClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const targetIndex = Math.min(totalSlides - 1, Math.max(0, Math.floor(ratio * totalSlides)));
    onGoTo(targetIndex);
  }

  const iconButtonClass = (extra?: string) =>
    cn(
      "flex h-10 w-10 items-center justify-center rounded-full transition-colors active:scale-90 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100",
      isDark ? "text-slate-300 hover:bg-slate-700" : "text-slate-500 hover:bg-slate-100",
      extra
    );

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-md flex-col gap-1.5 rounded-2xl border px-3 py-3 backdrop-blur-md transition-shadow sm:px-4",
        isDark ? "border-slate-700/60 bg-slate-800/90 shadow-glass-dark" : "border-slate-200/60 bg-white/90 shadow-glass"
      )}
    >
      {/* Scrubber / narration-sync timeline — the click/tap target (py-2.5) is
          taller than the visible bar itself, so it stays comfortably tappable
          on touch screens without visually thickening the track. */}
      <div
        onClick={handleScrubberClick}
        className="group cursor-pointer py-2.5"
        role="slider"
        aria-label="Progression de la présentation"
        aria-valuemin={1}
        aria-valuemax={totalSlides}
        aria-valuenow={currentIndex + 1}
      >
        <div
          className={cn(
            "flex h-2 w-full gap-1 overflow-hidden rounded-full transition-[height] duration-150 group-hover:h-2.5",
            isDark ? "bg-slate-700/60" : "bg-slate-100"
          )}
        >
          {Array.from({ length: totalSlides }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "relative h-full flex-1 overflow-hidden rounded-full",
                isDark ? "bg-slate-600/60" : "bg-slate-200"
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500",
                  i === currentIndex ? "" : "transition-none"
                )}
                style={{
                  width: i < currentIndex ? "100%" : i === currentIndex ? `${autoplayProgress * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Primary transport — prev / play / next / counter always stay visible,
          even on the narrowest phones. */}
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={currentIndex === 0}
          aria-label="Slide précédente"
          className={iconButtonClass()}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Mettre en pause" : "Lecture automatique"}
          aria-pressed={isPlaying}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition-all duration-200 hover:opacity-90 active:scale-90",
            // Steady (non-animated) ring while autoplay is running — a clear,
            // at-a-glance "this is live" state without an eye-catching pulse
            // that would fight the deck's own content for attention.
            isPlaying && (isDark ? "ring-4 ring-blue-400/30" : "ring-4 ring-blue-500/25")
          )}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={currentIndex === totalSlides - 1}
          aria-label="Slide suivante"
          className={iconButtonClass()}
        >
          <ChevronRight className="h-5 w-5" />
        </button>

        <span
          className={cn(
            "ml-1 shrink-0 text-xs font-semibold tabular-nums",
            isDark ? "text-slate-400" : "text-slate-500"
          )}
        >
          Slide {currentIndex + 1} / {totalSlides}
        </span>
      </div>

      {/* Secondary controls — search, zoom, sommaire, plein écran scroll
          horizontally rather than overflowing/hiding when they don't fit
          (phones from 320px up); on wider screens the strip simply fits and
          never scrolls. Speed stays outside that scrollable strip (see
          below) since overflow-x-auto would otherwise clip its popup. */}
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {/* Search */}
          <div className="flex shrink-0 items-center">
            {searchOpen ? (
              <div
                className={cn(
                  "animate-in fade-in-0 zoom-in-95 flex items-center gap-1 rounded-full border px-2.5 py-1.5 duration-150",
                  isDark ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-white"
                )}
              >
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Rechercher une slide..."
                  className={cn(
                    "w-36 bg-transparent text-base outline-none sm:w-48 sm:text-xs",
                    isDark ? "text-slate-100 placeholder:text-slate-500" : "text-slate-700 placeholder:text-slate-400"
                  )}
                />
                <button
                  type="button"
                  onClick={() => {
                    onSearchChange("");
                    setSearchOpen(false);
                  }}
                  aria-label="Fermer la recherche"
                  className={cn(
                    "rounded-full transition-colors active:scale-90",
                    isDark ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setSearchOpen(true)} aria-label="Rechercher" className={iconButtonClass()}>
                <Search className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className={cn("mx-0.5 h-6 w-px shrink-0", isDark ? "bg-slate-700" : "bg-slate-200")} />

          {/* Zoom controls — the whole feature is otherwise gesture-only, so this is
              what makes it discoverable at all. */}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onZoomOut}
              disabled={zoomLevel <= MIN_ZOOM}
              aria-label="Dézoomer"
              className={iconButtonClass()}
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onZoomReset}
              disabled={zoomLevel <= MIN_ZOOM}
              aria-label="Réinitialiser le zoom"
              className={cn(
                "flex h-10 min-w-[3rem] shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-xs font-semibold tabular-nums transition-colors active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100",
                zoomLevel > MIN_ZOOM
                  ? isDark
                    ? "bg-blue-500/20 text-blue-300"
                    : "bg-blue-50 text-blue-700"
                  : isDark
                    ? "text-slate-500"
                    : "text-slate-400"
              )}
            >
              <RotateCcw className="h-3 w-3" />
              {Math.round(zoomLevel * 100)}%
            </button>

            <button
              type="button"
              onClick={onZoomIn}
              disabled={zoomLevel >= MAX_ZOOM}
              aria-label="Zoomer"
              className={iconButtonClass()}
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>

          <div className={cn("mx-0.5 h-6 w-px shrink-0", isDark ? "bg-slate-700" : "bg-slate-200")} />

          <button type="button" onClick={onToggleTOC} aria-label="Sommaire / miniatures" className={iconButtonClass("shrink-0")}>
            <LayoutGrid className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            className={iconButtonClass("shrink-0")}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>

        <div className={cn("mx-0.5 h-6 w-px shrink-0", isDark ? "bg-slate-700" : "bg-slate-200")} />

        {/* Speed selector — kept outside the scrollable strip above: its popup opens
            upward past the strip's own bounds, and overflow-x-auto would clip it. */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setSpeedMenuOpen((v) => !v)}
            aria-label="Vitesse de lecture"
            aria-expanded={speedMenuOpen}
            className={cn(
              "flex h-10 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors active:scale-95",
              playbackSpeed !== 1
                ? isDark
                  ? "bg-blue-500/20 text-blue-300"
                  : "bg-blue-50 text-blue-700"
                : isDark
                  ? "text-slate-200 hover:bg-slate-700"
                  : "text-slate-600 hover:bg-slate-100"
            )}
          >
            {playbackSpeed}x
          </button>
          {speedMenuOpen && (
            <div
              className={cn(
                "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 absolute bottom-full right-0 z-10 mb-2 flex flex-col gap-0.5 rounded-xl border p-1 shadow-lg duration-150",
                isDark ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-white"
              )}
            >
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => {
                    onSpeedChange(speed);
                    setSpeedMenuOpen(false);
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-left text-xs font-medium transition-colors",
                    speed === playbackSpeed
                      ? isDark
                        ? "bg-blue-500/20 text-blue-300"
                        : "bg-blue-50 text-blue-700"
                      : isDark
                        ? "text-slate-200 hover:bg-slate-600"
                        : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {speed}x
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
