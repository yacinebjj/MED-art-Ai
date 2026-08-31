"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PresentationIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFullscreen } from "@/hooks/useFullscreen";
import { SlideDeckCanvas, type SlideDeckCanvasHandle } from "@/components/visual-studio/SlideDeckCanvas";
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
  const [zoomLevel, setZoomLevel] = useState(1);
  const slideDeckRef = useRef<SlideDeckCanvasHandle>(null);

  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Sync the stage's initial light/dark to the app's own theme (the `dark`
  // class on <html>) so a viewer already in dark mode doesn't get blasted
  // with a bright white stage the instant the deck opens. Read after mount
  // (not as a lazy useState initializer) so server- and first-client-render
  // markup always match — no hydration mismatch — with the correction
  // applying a frame later. The 'm' shortcut still overrides it manually.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.documentElement.classList.contains("dark")) {
      setActiveTheme("dark");
    }
  }, []);

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
      // Never hijack OS/browser chords (Cmd/Ctrl+F for find, +P for print,
      // etc.) — only bare key presses drive the deck's own shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

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
        case "Home":
          event.preventDefault();
          goTo(0);
          break;
        case "End":
          event.preventDefault();
          goTo(slides.length - 1);
          break;
        case "Escape":
          // Mirrors real presentation software: Escape closes the topmost
          // overlay first, then backs out of fullscreen — it never does
          // both at once.
          if (tocOpen) {
            setTocOpen(false);
          } else if (isFullscreen) {
            toggleFullscreen();
          }
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
  }, [goNext, goPrev, goTo, slides.length, tocOpen, isFullscreen, toggleFullscreen]);

  const isDark = activeTheme === "dark";

  // Defensive guard — an empty deck (a failed generation, a demo wired up
  // with no slides yet) would otherwise crash downstream on `slides[0]`
  // being undefined instead of showing a calm, on-brand empty state.
  if (slides.length === 0) {
    return (
      <div
        className={cn(
          "flex h-dvh flex-col items-center justify-center gap-3",
          isDark ? "bg-slate-950 text-slate-500" : "bg-slate-100 text-slate-400"
        )}
      >
        <PresentationIcon className="h-8 w-8" />
        <p className="text-sm font-medium">Aucune slide à afficher pour le moment.</p>
      </div>
    );
  }

  const currentSlide = slides[currentIndex];

  return (
    <div
      className={cn(
        "flex h-dvh flex-col",
        isFullscreen && "fixed inset-0 z-50",
        isDark ? "bg-slate-950" : "bg-slate-100"
      )}
    >
      <SlideDeckCanvas
        ref={slideDeckRef}
        slide={currentSlide}
        slides={slides}
        currentIndex={currentIndex}
        tocOpen={tocOpen}
        searchQuery={searchQuery}
        isDark={isDark}
        onGoTo={goTo}
        onCloseTOC={() => setTocOpen(false)}
        onZoomChange={setZoomLevel}
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
          zoomLevel={zoomLevel}
          onGoTo={goTo}
          onPrev={goPrev}
          onNext={goNext}
          onTogglePlay={() => setIsPlaying((v) => !v)}
          onSpeedChange={setPlaybackSpeed}
          onToggleFullscreen={toggleFullscreen}
          onToggleTOC={() => setTocOpen((v) => !v)}
          onSearchChange={setSearchQuery}
          onZoomIn={() => slideDeckRef.current?.zoomIn()}
          onZoomOut={() => slideDeckRef.current?.zoomOut()}
          onZoomReset={() => slideDeckRef.current?.resetZoom()}
        />
      </div>
    </div>
  );
}
