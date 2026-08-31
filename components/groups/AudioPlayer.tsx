"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  /** true when rendered inside the current user's own (themed, colored) bubble — flips the player to light-on-color instead of the neutral default. */
  onColoredBubble: boolean;
}

const BAR_COUNT = 28;

/**
 * Deterministic pseudo-random bar heights seeded from `src` — a visual
 * waveform, NOT real decoded audio amplitude (that would need Web Audio API
 * offline decoding of the whole file up front). Seeding on `src` keeps the
 * same clip's "waveform" shape stable across re-renders/reloads instead of
 * jittering randomly, which is what actually matters for it to read as a
 * real waveform rather than noise.
 */
function seededBarHeights(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const heights: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    heights.push(4 + (h % 1000 / 1000) * 24); // 4px – 28px
  }
  return heights;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Custom voice-note player — native <audio> underneath, a decorative-but-progress-aware waveform on top (bars fill with the accent color up to the current playback position). */
export function AudioPlayer({ src, onColoredBubble }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const barHeights = useMemo(() => seededBarHeights(src), [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    // `isPlaying` is derived from the audio element's own play/pause events
    // rather than toggled optimistically in togglePlay() below — play() can
    // legitimately reject (autoplay policy, a 404'd clip, being interrupted
    // by a rapid second click) and an optimistic toggle would then show
    // "Pause" while nothing is actually playing, with no way to recover.
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      // isPlaying flips via the "play"/"pause" listeners above once playback
      // actually starts/fails — nothing to reconcile here on rejection.
      audio.play().catch(() => {});
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }

  const progressRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div className={cn("flex w-60 items-center gap-3", onColoredBubble ? "text-white" : "text-foreground")}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105",
          onColoredBubble ? "bg-white/25" : "bg-primary text-primary-foreground"
        )}
        aria-label={isPlaying ? "Pause" : "Lecture"}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
      </button>

      <div onClick={seek} className="flex h-8 flex-1 cursor-pointer items-center gap-[3px]">
        {barHeights.map((height, i) => {
          const played = i / BAR_COUNT <= progressRatio;
          return (
            <div
              key={i}
              style={{ height: `${height}px` }}
              className={cn(
                "w-[3px] shrink-0 rounded-full transition-colors",
                played ? (onColoredBubble ? "bg-white" : "bg-primary") : onColoredBubble ? "bg-white/30" : "bg-muted-foreground/25"
              )}
            />
          );
        })}
      </div>

      <span className={cn("shrink-0 text-[10px] tabular-nums", onColoredBubble ? "text-white/80" : "text-muted-foreground")}>
        {formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  );
}
