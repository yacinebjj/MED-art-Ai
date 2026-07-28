"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useFullscreen } from "@/hooks/useFullscreen";
import { SlideDeckCanvas } from "@/components/visual-studio/SlideDeckCanvas";
import { PPTXControlBar, type PlaybackSpeed } from "@/components/visual-studio/PPTXControlBar";
import type { PresentationDeck } from "@/lib/presentation-types";

/** Base dwell time per slide at 1x speed, in milliseconds. */
const BASE_AUTOPLAY_DURATION_MS = 14000;
const AUTOPLAY_TICK_MS = 100;

export function VisualPresentationEngine({ deck }: { deck: PresentationDeck }) {
  const { slides } = deck;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState<"light" | "dark">("light");
  const [autoplayProgress, setAutoplayProgress] = useState(0);

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  const goTo = useCallback((index: number) => {
    setCurrentIndex(Math.min(slides.length - 1, Math.max(0, index)));
    setAutoplayProgress(0);
  }, [slides.length]);

  const goNext = useCallback(() => {
    setCurrentIndex((current) => {
      if (current >= slides.length - 1) {
        setIsPlaying(false);
        return current;
      }
      return current + 1;
    });
    setAutoplayProgress(0);
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((current) => Math.max(0, current - 1));
    setAutoplayProgress(0);
  }, []);

  // Autoplay timer — also drives the scrubber's per-slide "narration sync" fill.
  useEffect(() => {
    if (!isPlaying) return;
    const durationMs = BASE_AUTOPLAY_DURATION_MS / playbackSpeed;

    const interval = setInterval(() => {
      setAutoplayProgress((progress) => {
        const next = progress + AUTOPLAY_TICK_MS / durationMs;
        if (next >= 1) {
          goNext();
          return 0;
        }
        return next;
      });
    }, AUTOPLAY_TICK_MS);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, currentIndex, goNext]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      switch (event.key) {
        case "ArrowRight":
        case " ":
          event.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          event.preventDefault();
          goPrev();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "m":
        case "M":
          setActiveTheme((t) => (t === "light" ? "dark" : "light"));
          break;
        case "t":
        case "T":
          setTocOpen((v) => !v);
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, toggleFullscreen]);

  const currentSlide = slides[currentIndex];
  const isDark = activeTheme === "dark";

  return (
    <div
      className={cn(
        "flex h-screen flex-col",
        isFullscreen && "fixed inset-0 z-50",
        isDark ? "bg-slate-950" : "bg-slate-100"
      )}
    >
      <SlideDeckCanvas
        slide={currentSlide}
        slides={slides}
        currentIndex={currentIndex}
        tocOpen={tocOpen}
        searchQuery={searchQuery}
        isDark={isDark}
        onGoTo={goTo}
        onCloseTOC={() => setTocOpen(false)}
      />

      <div className="flex shrink-0 justify-center px-4 pb-4 sm:pb-6">
        <PPTXControlBar
          currentIndex={currentIndex}
          totalSlides={slides.length}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          isFullscreen={isFullscreen}
          searchQuery={searchQuery}
          autoplayProgress={autoplayProgress}
          isDark={isDark}
          onGoTo={goTo}
          onPrev={goPrev}
          onNext={goNext}
          onTogglePlay={() => setIsPlaying((v) => !v)}
          onSpeedChange={setPlaybackSpeed}
          onToggleFullscreen={toggleFullscreen}
          onToggleTOC={() => setTocOpen((v) => !v)}
          onSearchChange={setSearchQuery}
        />
      </div>
    </div>
  );
}
