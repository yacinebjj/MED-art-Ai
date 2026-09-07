"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Studio's "Podcast Audio" tab content — a single ~10-15 min narrated
 * episode (openai/gpt-audio-mini via OpenRouter, cross-student cached — see
 * app/api/studio/podcast/route.ts). A real <audio> element (native
 * play/pause/seek/volume) plus a playback-speed row — genuinely useful here
 * given the product's own "en allant à l'hôpital" use case, unlike the
 * native browser controls' own speed menu which is either hidden behind a
 * right-click or absent depending on the browser.
 */
const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;

export function AudioPodcastViewer({ audioUrl, courseTitle }: { audioUrl: string; courseTitle: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);

  function applySpeed(value: (typeof SPEED_OPTIONS)[number]) {
    setSpeed(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-soft">
        <audio ref={audioRef} src={audioUrl} controls className="w-full" />
      </div>

      <div className="flex items-center gap-1.5 rounded-full border border-border bg-card p-1 shadow-soft">
        {SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => applySpeed(option)}
            aria-pressed={speed === option}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold transition-all duration-300",
              speed === option
                ? "bg-primary-600 text-white dark:bg-primary-500"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {option}x
          </button>
        ))}
      </div>

      <a
        href={audioUrl}
        download={`podcast-${courseTitle.replace(/[^a-zA-Z0-9-_]/g, "_")}.mp3`}
        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary-500 hover:shadow-glow dark:bg-primary-500 dark:hover:bg-primary-400"
      >
        <Download className="h-4 w-4" />
        Télécharger le podcast
      </a>
    </div>
  );
}
