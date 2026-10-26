"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 40;
/** A new level sample enters on the right this often; older ones scroll left. */
const SAMPLE_MS = 60;
/** Silence still draws a thin line, never an empty strip. */
const MIN_LEVEL = 0.08;
/** Older samples fade out toward the left edge. */
const WAVE_MASK = "linear-gradient(to right, transparent, #000 28%)";

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/**
 * Live recording strip shown in place of the text field during dictation: a
 * scrolling waveform of the REAL microphone level (an AnalyserNode on the
 * same MediaStream being recorded — it rises while the student speaks and
 * settles to a quiet line when they don't), newest sample on the right, and
 * an elapsed timer read from the clock rather than counted (no drift). If the
 * Web Audio graph can't start (some embedded webviews), the bars fall back to
 * a gentle CSS pulse rather than sitting dead.
 */
export function VoiceMeter({ stream, label }: { stream: MediaStream | null; label: string }) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [metering, setMetering] = useState(false);

  useEffect(() => {
    const startedAt = performance.now();
    const interval = window.setInterval(() => setSeconds(Math.floor((performance.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!stream) return;
    let context: AudioContext | null = null;
    let frame = 0;
    try {
      const AudioContextCtor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const levels = new Array<number>(BAR_COUNT).fill(MIN_LEVEL);
      // iOS creates the context suspended when it isn't inside the tap that started it.
      void context.resume().catch(() => {});
      setMetering(true);

      let smoothed = 0;
      let lastSampleAt = 0;
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const value = (samples[i] - 128) / 128;
          sum += value * value;
        }
        // Speech RMS sits around 0.02–0.3: a square root lifts it into view, capped at full height.
        const target = Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * 1.6);
        // Fast attack, slow release: syllables pop up, pauses glide down.
        smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.15);
        if (now - lastSampleAt >= SAMPLE_MS) {
          lastSampleAt = now;
          levels.shift();
          levels.push(Math.max(MIN_LEVEL, smoothed));
          for (let i = 0; i < BAR_COUNT; i++) {
            const bar = barRefs.current[i];
            if (bar) bar.style.transform = `scaleY(${levels[i].toFixed(3)})`;
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch {
      setMetering(false);
    }
    return () => {
      cancelAnimationFrame(frame);
      void context?.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="flex h-11 min-w-0 flex-1 items-center gap-3 pl-2 pr-1 animate-in fade-in-0 slide-in-from-left-2 duration-300" role="status" aria-live="polite" aria-label={label}>
      <span aria-hidden className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <div
        aria-hidden
        className="flex h-8 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden"
        style={{ maskImage: WAVE_MASK, WebkitMaskImage: WAVE_MASK }}
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            style={metering ? { transform: `scaleY(${MIN_LEVEL})` } : { animationDelay: `${(i % 12) * 90}ms` }}
            className={cn(
              "h-full w-[3px] shrink-0 origin-center rounded-full bg-gradient-to-t from-emerald-500 to-cyan-400 transition-transform duration-100 ease-out",
              !metering && "animate-pulse"
            )}
          />
        ))}
      </div>
      <span aria-hidden className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
        {formatClock(seconds)}
      </span>
    </div>
  );
}
