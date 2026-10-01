"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 22;

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/**
 * Live recording strip shown in place of the text field during dictation:
 * a pulsing dot, bars driven by the REAL microphone level (an AnalyserNode on
 * the same MediaStream being recorded — the bars move when the student speaks
 * and stay flat when they don't), and an elapsed clock. If the Web Audio
 * graph can't start (some embedded webviews), the bars fall back to a plain
 * CSS pulse rather than sitting dead.
 */
export function VoiceMeter({ stream, label }: { stream: MediaStream | null; label: string }) {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [metering, setMetering] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setSeconds((s) => s + 1), 1000);
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
      // At a 48 kHz context, 256 samples gives ~187 Hz bins: bins 1..22 span
      // ≈190 Hz–4.3 kHz, i.e. the speech band including a voice's fundamental.
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      context.createMediaStreamSource(stream).connect(analyser);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      // iOS creates the context suspended when it isn't inside the tap that started it.
      void context.resume().catch(() => {});
      setMetering(true);

      const tick = () => {
        analyser.getByteFrequencyData(bins);
        // Bin 0 (0–187 Hz) is mostly DC/rumble, so the bars start at bin 1.
        for (let i = 0; i < BAR_COUNT; i++) {
          const bar = barRefs.current[i];
          if (bar) bar.style.transform = `scaleY(${Math.max(0.14, Math.min(1, (bins[i + 1] / 255) * 1.35))})`;
        }
        frame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setMetering(false);
    }
    return () => {
      cancelAnimationFrame(frame);
      void context?.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 px-2.5" role="status" aria-live="polite" aria-label={label}>
      <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-70" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
      </span>
      <div aria-hidden className="flex h-7 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden">
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            style={metering ? { transform: "scaleY(0.14)" } : { animationDelay: `${i * 70}ms` }}
            className={cn(
              "h-full w-[3px] shrink-0 origin-center rounded-full bg-rose-500/80 transition-transform duration-75 dark:bg-rose-400/80",
              !metering && "animate-pulse"
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatClock(seconds)}</span>
    </div>
  );
}
