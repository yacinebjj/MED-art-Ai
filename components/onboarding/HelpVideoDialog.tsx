"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2, Play, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { HELP_VIDEOS, type HelpVideo } from "@/lib/onboarding/help-video-content";
import type { TourId } from "@/lib/onboarding/tour-ids";

export interface HelpVideoDialogProps {
  tour: TourId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The micro-tutorial player, opened by a « ▶ » button
 * (components/onboarding/HelpVideoButton.tsx), in its own chunk. A clip is a
 * flat, silent screen recording of the real app (public/help/), with its steps
 * beside it on desktop and as a caption under it on phones. The <video>
 * exists only while the dialog is open: closing unmounts it, which stops the
 * download and frees the decoder.
 */
export function HelpVideoDialog({ tour, open, onOpenChange }: HelpVideoDialogProps) {
  const { language } = useLanguage();
  const clip = HELP_VIDEOS[tour];
  if (!clip) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-4 pt-7 sm:max-w-[44rem] sm:p-6">
        <ClipPlayer clip={clip} language={language} />
      </DialogContent>
    </Dialog>
  );
}

type PlayerState = "loading" | "playing" | "paused" | "ended" | "error";

/** Mounted with the dialog's content, so every opening starts fresh at 0 s. */
function ClipPlayer({ clip, language }: { clip: HelpVideo; language: Language }) {
  const fr = language === "fr";
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlayerState>("loading");
  const [step, setStep] = useState(0);

  // Muted autoplay is allowed everywhere, except where the device refuses it
  // (iOS Low Power Mode): then the play button shows instead of a spinner.
  useEffect(() => {
    const playing = videoRef.current?.play?.();
    if (playing && typeof playing.catch === "function") playing.catch(() => setState((s) => (s === "playing" ? s : "paused")));
  }, []);

  // The progress bar follows each frame while playing, written straight to the DOM (no re-render).
  useEffect(() => {
    if (state !== "playing" || typeof requestAnimationFrame !== "function") return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && barRef.current && video.duration > 0) barRef.current.style.transform = `scaleX(${Math.min(1, video.currentTime / video.duration)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const stepAt = (time: number) => clip.steps.reduce((current, s, index) => (time >= s.at ? index : current), 0);

  function play(video: HTMLVideoElement) {
    const playing = video.play?.();
    if (playing && typeof playing.catch === "function") playing.catch(() => setState("paused"));
  }

  function toggle() {
    const video = videoRef.current;
    if (!video || state === "error") return;
    if (state === "ended") {
      video.currentTime = 0;
      setStep(0);
      play(video);
    } else if (video.paused) play(video);
    else video.pause();
  }

  function seek(index: number) {
    const video = videoRef.current;
    if (!video || state === "error") return;
    video.currentTime = clip.steps[index].at;
    setStep(index);
    play(video);
  }

  const overlayLabel = state === "ended" ? (fr ? "Revoir le tutoriel" : "Watch again") : state === "playing" ? (fr ? "Pause" : "Pause") : fr ? "Lecture" : "Play";
  const current = clip.steps[step];

  return (
    <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-4">
      <div className="pr-8 sm:col-start-2 sm:row-start-1 sm:pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
          {fr ? "Tutoriel vidéo" : "Video tutorial"} · {Math.round(clip.duration)} s
        </p>
        <DialogTitle className="mt-1 leading-snug">{clip.title[language]}</DialogTitle>
        <DialogDescription className="leading-relaxed">{clip.summary[language]}</DialogDescription>
      </div>

      <figure className="relative mx-auto w-fit sm:col-start-1 sm:row-span-2 sm:row-start-1">
        <video
          ref={videoRef}
          src={clip.src}
          poster={clip.poster}
          width={clip.width}
          height={clip.height}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-label={clip.title[language]}
          onPlaying={() => setState("playing")}
          onPause={() => setState((s) => (s === "ended" || s === "error" ? s : "paused"))}
          onWaiting={() => setState("loading")}
          onEnded={() => setState("ended")}
          onError={() => setState("error")}
          onTimeUpdate={(event) => setStep(stepAt(event.currentTarget.currentTime))}
          className="block h-[min(58dvh,36rem)] w-auto max-w-full rounded-[1.25rem] border border-border bg-slate-100 object-contain dark:bg-slate-900 sm:h-[min(68vh,36rem)]"
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={overlayLabel}
          className="absolute inset-0 flex items-center justify-center rounded-[1.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {state === "loading" && (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm dark:bg-slate-800/90 dark:text-slate-200">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
          )}
          {state === "paused" && (
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-md dark:bg-slate-800/95 dark:text-white">
              <Play className="ml-0.5 h-6 w-6 fill-current" />
            </span>
          )}
          {state === "ended" && (
            <span className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-md dark:bg-slate-800/95 dark:text-white">
              <RotateCcw className="h-4 w-4" />
              {fr ? "Revoir" : "Watch again"}
            </span>
          )}
          {state === "error" && (
            <span className="mx-4 flex items-center gap-2 rounded-2xl bg-white/95 px-4 py-3 text-sm font-medium text-slate-700 shadow-md dark:bg-slate-800/95 dark:text-slate-200">
              <CircleAlert className="h-4 w-4 shrink-0" />
              {fr ? "Vidéo indisponible pour le moment." : "Video unavailable right now."}
            </span>
          )}
        </button>
        <div aria-hidden className="pointer-events-none absolute inset-x-3 bottom-2.5 h-1 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/15">
          <div ref={barRef} className="h-full origin-left scale-x-0 rounded-full bg-primary-500" />
        </div>
      </figure>

      {/* Phones: the current step under the video, like a subtitle. */}
      <p aria-live="polite" className="min-h-[2.75rem] text-center text-[0.9375rem] font-medium leading-snug text-foreground sm:hidden">
        <span className="font-semibold text-primary-600 dark:text-primary-400">
          {step + 1}/{clip.steps.length}
        </span>{" "}
        {current.text[language]}
      </p>

      {/* Desktop: every step, the current one lit; a click jumps to it. */}
      <ol className="space-y-1 max-sm:hidden sm:col-start-2 sm:row-start-2">
        {clip.steps.map((s, index) => (
          <li key={s.at}>
            <button
              type="button"
              onClick={() => seek(index)}
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                index === step ? "bg-primary-50 font-medium text-foreground dark:bg-primary-500/10" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold",
                  index === step ? "bg-primary-500 text-white" : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                )}
              >
                {index + 1}
              </span>
              {s.text[language]}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
