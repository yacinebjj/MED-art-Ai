"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;

/**
 * Saved "Audio to Smart Notes" recordings are stored as an ORDERED array of
 * chunk URLs (lib/audio/browser-chunking.ts splits a long recording client-
 * side before transcription — see app/api/lecture-notes/process/route.ts's
 * own comment on why one long lecture can genuinely be many small files).
 * Unlike components/course/workspace/AudioPodcastViewer.tsx (a single
 * ~10-15 min file, one <audio> element is enough), this player must advance
 * chunk-to-chunk automatically so playback reads as one continuous
 * recording instead of silently stopping after the first segment.
 */
export function LectureNotesAudioPlayer({ audioUrls, title }: { audioUrls: string[]; title: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);

  const hasMultipleChunks = audioUrls.length > 1;

  function applySpeed(value: (typeof SPEED_OPTIONS)[number]) {
    setSpeed(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  }

  function handleEnded() {
    setActiveIndex((prev) => {
      const next = prev + 1;
      return next < audioUrls.length ? next : prev;
    });
  }

  if (audioUrls.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun enregistrement disponible pour cette note.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="glass-card rounded-2xl border border-border p-4 shadow-soft">
        <audio
          key={activeIndex}
          ref={audioRef}
          src={audioUrls[activeIndex]}
          controls
          autoPlay={activeIndex > 0}
          onEnded={handleEnded}
          className="w-full"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => applySpeed(option)}
              aria-pressed={speed === option}
              className={cn(
                "flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-xs font-semibold transition-all duration-300",
                speed === option
                  ? "bg-primary-600 text-white shadow-glow dark:bg-primary-500"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {option}x
            </button>
          ))}
        </div>

        {hasMultipleChunks && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Segment {activeIndex + 1}/{audioUrls.length}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                disabled={activeIndex === 0}
                className="flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Précédent
              </button>
              <button
                type="button"
                onClick={() => setActiveIndex((i) => Math.min(audioUrls.length - 1, i + 1))}
                disabled={activeIndex === audioUrls.length - 1}
                className="flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold text-foreground transition-all duration-300 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      <a
        href={audioUrls[activeIndex]}
        download={`${title.replace(/[^a-zA-Z0-9-_]/g, "_")}-segment-${activeIndex + 1}.wav`}
        className="w-fit text-xs font-medium text-primary-600 underline-offset-2 hover:underline dark:text-primary-400"
      >
        Télécharger ce segment
      </a>
    </div>
  );
}
