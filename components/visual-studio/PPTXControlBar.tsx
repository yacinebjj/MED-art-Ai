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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  onGoTo: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onToggleFullscreen: () => void;
  onToggleTOC: () => void;
  onSearchChange: (query: string) => void;
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
}: PPTXControlBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

  function handleScrubberClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const targetIndex = Math.min(totalSlides - 1, Math.max(0, Math.floor(ratio * totalSlides)));
    onGoTo(targetIndex);
  }

  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-col gap-2 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-md",
        isDark ? "border-slate-700/60 bg-slate-800/90" : "border-slate-200/60 bg-white/90"
      )}
    >
      {/* Scrubber / narration-sync timeline */}
      <div
        onClick={handleScrubberClick}
        className="flex h-2 w-full cursor-pointer gap-1 overflow-hidden rounded-full bg-slate-100"
        role="slider"
        aria-label="Progression de la présentation"
        aria-valuemin={1}
        aria-valuemax={totalSlides}
        aria-valuenow={currentIndex + 1}
      >
        {Array.from({ length: totalSlides }).map((_, i) => (
          <div key={i} className="relative h-full flex-1 overflow-hidden rounded-full bg-slate-200">
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

      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="flex items-center">
          {searchOpen ? (
            <div
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1.5",
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
                  "w-36 bg-transparent text-xs outline-none placeholder:text-slate-400 sm:w-48",
                  isDark ? "text-slate-100" : "text-slate-700"
                )}
              />
              <button
                type="button"
                onClick={() => {
                  onSearchChange("");
                  setSearchOpen(false);
                }}
                aria-label="Fermer la recherche"
              >
                <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-500" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Rechercher"
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                isDark ? "text-slate-300 hover:bg-slate-700" : "text-slate-500 hover:bg-slate-100"
              )}
            >
              <Search className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className={cn("mx-1 h-6 w-px", isDark ? "bg-slate-700" : "bg-slate-200")} />

        {/* Prev / Play / Next */}
        <button
          type="button"
          onClick={onPrev}
          disabled={currentIndex === 0}
          aria-label="Slide précédente"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-30",
            isDark ? "text-slate-200 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
          )}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Mettre en pause" : "Lecture automatique"}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition-opacity hover:opacity-90"
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={currentIndex === totalSlides - 1}
          aria-label="Slide suivante"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-30",
            isDark ? "text-slate-200 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
          )}
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

        <div className="ml-auto flex items-center gap-1">
          {/* Speed selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSpeedMenuOpen((v) => !v)}
              className={cn(
                "flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors",
                isDark ? "text-slate-200 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {playbackSpeed}x
            </button>
            {speedMenuOpen && (
              <div
                className={cn(
                  "absolute bottom-full right-0 mb-2 flex flex-col gap-0.5 rounded-xl border p-1 shadow-lg",
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
                        ? "bg-blue-50 text-blue-700"
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

          <button
            type="button"
            onClick={onToggleTOC}
            aria-label="Sommaire / miniatures"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
              isDark ? "text-slate-300 hover:bg-slate-700" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
              isDark ? "text-slate-300 hover:bg-slate-700" : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
