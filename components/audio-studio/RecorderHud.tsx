"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square } from "lucide-react";
import { formatClock } from "@/lib/lecture-transcript";
import { cn } from "@/lib/utils";

const METER_SEGMENTS = 24;
const FLOOR_DB = -60;

/**
 * Live lecture recording HUD: pulsing mic orb driven by the real input
 * level, a segmented dBFS meter (-60…0 dB) with peak hold, elapsed time,
 * pause/resume and stop. Levels come from an AnalyserNode on the same
 * MediaStream the MediaRecorder is writing — nothing simulated.
 */
export function RecorderHud({
  stream,
  seconds,
  paused,
  wakeLockActive,
  onPauseToggle,
  onStop,
}: {
  stream: MediaStream | null;
  seconds: number;
  paused: boolean;
  wakeLockActive: boolean;
  onPauseToggle: () => void;
  onStop: () => void;
}) {
  const [db, setDb] = useState(FLOOR_DB);
  const [peakDb, setPeakDb] = useState(FLOOR_DB);
  const orbRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!stream) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame = 0;
    let peak = FLOOR_DB;
    let peakAt = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      const level = Math.max(FLOOR_DB, 20 * Math.log10(rms || 1e-6));
      if (level > peak || now - peakAt > 1500) {
        peak = level;
        peakAt = now;
      }
      const scale = 1 + Math.min(0.35, Math.max(0, (level - FLOOR_DB) / -FLOOR_DB) * 0.45);
      if (orbRef.current) orbRef.current.style.transform = `scale(${scale.toFixed(3)})`;
      if (now - lastPaint > 66) {
        lastPaint = now;
        setDb(level);
        setPeakDb(peak);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
    };
  }, [stream]);

  const lit = Math.round(((db - FLOOR_DB) / -FLOOR_DB) * METER_SEGMENTS);
  const peakSeg = Math.round(((peakDb - FLOOR_DB) / -FLOOR_DB) * METER_SEGMENTS);
  const tooQuiet = !paused && seconds > 3 && db < -50;

  return (
    <div className="relative flex flex-col items-center gap-5 overflow-hidden rounded-3xl border border-rose-400/30 bg-gradient-to-b from-rose-950/80 via-slate-950 to-slate-950 px-5 py-8 text-center text-white shadow-[0_30px_80px_-30px_rgba(244,63,94,0.7)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(244,63,94,0.28),transparent_60%)]" />

      <div className="relative flex h-32 w-32 items-center justify-center">
        {!paused && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-rose-500/25 [animation-duration:1.8s]" />}
        <span aria-hidden className="absolute inset-3 rounded-full bg-rose-500/20 blur-md" />
        <span
          ref={orbRef}
          className={cn(
            "relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 via-rose-500 to-fuchsia-600 shadow-[0_0_40px_rgba(244,63,94,0.75),inset_0_2px_0_rgba(255,255,255,0.35)] transition-transform duration-75",
            paused && "grayscale-[0.6]"
          )}
        >
          <Mic className="h-10 w-10 drop-shadow" />
        </span>
      </div>

      <div className="relative">
        <p className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-rose-200">
          <span className={cn("h-2 w-2 rounded-full", paused ? "bg-amber-400" : "animate-pulse bg-rose-400")} />
          {paused ? "En pause" : "Enregistrement du cours"}
        </p>
        <p className="mt-1 font-mono text-4xl font-black tabular-nums">{formatClock(seconds)}</p>
      </div>

      {/* dBFS meter */}
      <div className="relative w-full max-w-sm">
        <div className="flex h-3 gap-[3px]" role="meter" aria-label="Niveau du micro" aria-valuemin={FLOOR_DB} aria-valuemax={0} aria-valuenow={Math.round(db)}>
          {Array.from({ length: METER_SEGMENTS }, (_, i) => {
            const on = i < lit;
            const isPeak = i === Math.max(0, peakSeg - 1);
            const zone = i >= METER_SEGMENTS - 3 ? "bg-red-500" : i >= METER_SEGMENTS - 8 ? "bg-amber-400" : "bg-emerald-400";
            return <span key={i} className={cn("flex-1 rounded-[2px] transition-opacity duration-75", zone, on ? "opacity-100" : isPeak ? "opacity-80" : "opacity-15")} />;
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-semibold tabular-nums text-white/50">
          <span>-60 dB</span>
          <span className={cn(db > -6 ? "text-red-300" : "text-white/80")}>{db <= FLOOR_DB ? "—" : `${Math.round(db)} dB`}</span>
          <span>0 dB</span>
        </div>
      </div>

      <p className={cn("relative min-h-[1.25rem] text-xs", tooQuiet ? "text-amber-300" : "text-white/55")}>
        {tooQuiet ? "Signal très faible — rapproche le téléphone du professeur." : wakeLockActive ? "Écran maintenu allumé pendant l'enregistrement." : "Garde cette page ouverte pendant tout le cours."}
      </p>

      <div className="relative flex items-center gap-3">
        <button type="button" onClick={onPauseToggle} className="flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-5 text-sm font-bold transition hover:bg-white/20 active:scale-95">
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? "Reprendre" : "Pause"}
        </button>
        <button
          type="button"
          onClick={onStop}
          className="flex min-h-12 items-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 px-6 text-sm font-black shadow-[0_10px_30px_-10px_rgba(244,63,94,0.9)] transition hover:-translate-y-0.5 active:scale-95"
        >
          <Square className="h-4 w-4" />
          Terminer
        </button>
      </div>
    </div>
  );
}
