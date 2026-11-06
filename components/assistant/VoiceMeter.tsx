"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Bars drawn before the strip has been measured (a phone composer's width). */
const DEFAULT_BAR_COUNT = 40;
/** Enough bars to fill the widest composer (a wide desktop Copilot) edge to edge. */
const MAX_BAR_COUNT = 200;
const MIN_BAR_COUNT = 12;
/** One bar (3px, `w-[3px]`) plus the gap after it (`gap-[3px]`). */
const BAR_PITCH_PX = 6;
const BAR_GAP_PX = 3;
/** A new level sample enters on the right this often; older ones scroll left. */
const SAMPLE_MS = 60;

// Layout effect in the browser (the bar count is fixed before the first paint), plain effect on the server.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** How many bars fit across `width` pixels, edge to edge. */
function barCountFor(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return DEFAULT_BAR_COUNT;
  return Math.max(MIN_BAR_COUNT, Math.min(MAX_BAR_COUNT, Math.floor((width + BAR_GAP_PX) / BAR_PITCH_PX)));
}
/** Silence still draws a thin line, never an empty strip. */
const MIN_LEVEL = 0.08;
/** Older samples fade out toward the left edge — over a fixed 64px, so a wide desktop strip stays visible almost edge to edge (on a phone it is the same ~30% fade as before). */
const WAVE_MASK = "linear-gradient(to right, transparent, #000 64px)";

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
 *
 * The waveform spans the whole strip at every width: the number of bars is
 * measured from the strip itself (a ResizeObserver), so a wide desktop
 * composer is filled edge to edge instead of showing a fixed 40-bar block
 * pinned to its right half.
 */
export function VoiceMeter({ stream, label }: { stream: MediaStream | null; label: string }) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [metering, setMetering] = useState(false);
  const [barCount, setBarCount] = useState(DEFAULT_BAR_COUNT);
  // Read by the animation loop, which must not restart when the strip is resized.
  const barCountRef = useRef(DEFAULT_BAR_COUNT);
  barCountRef.current = barCount;

  useIsomorphicLayoutEffect(() => {
    const wave = waveRef.current;
    if (!wave) return;
    const measure = () => {
      const next = barCountFor(wave.clientWidth);
      setBarCount((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(wave);
    return () => observer.disconnect();
  }, []);

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
      // The full history is kept whatever the current width: a strip that grows shows older samples, never blanks.
      const levels = new Array<number>(MAX_BAR_COUNT).fill(MIN_LEVEL);
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
          // The newest sample sits on the right-most bar, whatever the bar count.
          const count = barCountRef.current;
          const offset = MAX_BAR_COUNT - count;
          for (let i = 0; i < count; i++) {
            const bar = barRefs.current[i];
            if (bar) bar.style.transform = `scaleY(${levels[offset + i].toFixed(3)})`;
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
    <div className="flex h-11 w-full min-w-0 flex-1 basis-0 items-center gap-3 pl-2 pr-1 animate-in fade-in-0 slide-in-from-left-2 duration-300" role="status" aria-live="polite" aria-label={label}>
      <span aria-hidden className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-600" />
      </span>
      <div
        ref={waveRef}
        aria-hidden
        className="flex h-8 w-full min-w-0 flex-1 basis-0 items-center justify-end gap-[3px] overflow-hidden"
        style={{ maskImage: WAVE_MASK, WebkitMaskImage: WAVE_MASK }}
      >
        {Array.from({ length: barCount }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            style={metering ? { transform: `scaleY(${MIN_LEVEL})` } : { animationDelay: `${(i % 12) * 90}ms` }}
            className={cn(
              "h-full w-[3px] shrink-0 origin-center rounded-full bg-gradient-to-t from-sky-500 to-cyan-400 transition-transform duration-100 ease-out",
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
