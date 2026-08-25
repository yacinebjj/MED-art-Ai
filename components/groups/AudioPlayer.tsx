"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  src: string;
  /** true when rendered inside the current user's own (themed, colored) bubble — flips the player to light-on-color instead of the neutral default. */
  onColoredBubble: boolean;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Custom voice-note player — native <audio> underneath, fully custom play/pause + progress bar UI on top. */
export function AudioPlayer({ src, onColoredBubble }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
    setIsPlaying(!isPlaying);
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * duration;
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={cn("flex w-56 items-center gap-2.5", onColoredBubble ? "text-white" : "text-foreground")}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105",
          onColoredBubble ? "bg-white/25" : "bg-primary/15 text-primary"
        )}
        aria-label={isPlaying ? "Pause" : "Lecture"}
      >
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
      </button>

      <div className="flex-1">
        <div
          onClick={seek}
          className={cn("h-1.5 w-full cursor-pointer overflow-hidden rounded-full", onColoredBubble ? "bg-white/25" : "bg-muted-foreground/20")}
        >
          <div
            className={cn("h-full rounded-full transition-[width]", onColoredBubble ? "bg-white" : "bg-primary")}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <span className={cn("shrink-0 text-[10px] tabular-nums", onColoredBubble ? "text-white/80" : "text-muted-foreground")}>
        {formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  );
}
