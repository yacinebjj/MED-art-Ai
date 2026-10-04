"use client";

import { useEffect, useRef, useState } from "react";
import { CloudRain, Volume2, VolumeX, Waves, Wind, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

export type AmbienceId = "none" | "rain" | "ocean" | "brown" | "ember";

interface AmbienceDef {
  id: AmbienceId;
  label: string;
  icon: typeof Waves;
  /** Visual tint applied to the cockpit dial backdrop. */
  tint: string;
}

export const AMBIENCES: AmbienceDef[] = [
  { id: "none", label: "Silence", icon: VolumeX, tint: "from-cyan-500/10 via-transparent to-violet-500/10" },
  { id: "rain", label: "Pluie", icon: CloudRain, tint: "from-sky-500/20 via-transparent to-indigo-500/15" },
  { id: "ocean", label: "Océan", icon: Waves, tint: "from-cyan-400/20 via-transparent to-blue-600/20" },
  { id: "brown", label: "Bruit brun", icon: Wind, tint: "from-violet-500/20 via-transparent to-fuchsia-500/10" },
  { id: "ember", label: "Braise", icon: Flame, tint: "from-amber-500/20 via-transparent to-rose-500/15" },
];

type NoiseColor = "pink" | "brown";

/** Fills a looping buffer with pink or brown noise — generated locally, nothing is downloaded. */
function createNoiseBuffer(ctx: AudioContext, color: NoiseColor): AudioBuffer {
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (color === "brown") {
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  } else {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  return buffer;
}

interface AudioGraph {
  ctx: AudioContext;
  source: AudioBufferSourceNode;
  master: GainNode;
  lfo: OscillatorNode | null;
}

/**
 * "Ambiances sonores visuelles": a procedural soundscape (Web Audio, generated
 * on the fly) plus a matching tint for the dial. Starts only on an explicit
 * click (autoplay policies) and is fully torn down on unmount.
 */
export function AmbiencePanel({ ambience, onAmbienceChange }: { ambience: AmbienceId; onAmbienceChange: (id: AmbienceId) => void }) {
  const graphRef = useRef<AudioGraph | null>(null);
  const [volume, setVolume] = useState(0.35);
  const [playing, setPlaying] = useState(false);

  function stop() {
    const graph = graphRef.current;
    graphRef.current = null;
    setPlaying(false);
    if (!graph) return;
    try {
      graph.source.stop();
      graph.lfo?.stop();
      void graph.ctx.close();
    } catch {
      // Already stopped.
    }
  }

  function start(id: AmbienceId) {
    stop();
    if (id === "none") return;
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const source = ctx.createBufferSource();
      source.buffer = createNoiseBuffer(ctx, id === "rain" ? "pink" : "brown");
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = id === "rain" ? "highpass" : "lowpass";
      filter.frequency.value = id === "rain" ? 900 : id === "ember" ? 420 : id === "ocean" ? 700 : 1200;

      const master = ctx.createGain();
      master.gain.value = volume;

      let lfo: OscillatorNode | null = null;
      if (id === "ocean" || id === "ember") {
        // Slow swell: waves (~0.12 Hz) or a crackling hearth (~0.4 Hz).
        const swell = ctx.createGain();
        swell.gain.value = 0.55;
        lfo = ctx.createOscillator();
        lfo.frequency.value = id === "ocean" ? 0.12 : 0.4;
        const depth = ctx.createGain();
        depth.gain.value = 0.4;
        lfo.connect(depth);
        depth.connect(swell.gain);
        source.connect(filter);
        filter.connect(swell);
        swell.connect(master);
        lfo.start();
      } else {
        source.connect(filter);
        filter.connect(master);
      }
      master.connect(ctx.destination);
      source.start();
      graphRef.current = { ctx, source, master, lfo };
      setPlaying(true);
    } catch (error) {
      console.warn("Ambiance sonore indisponible:", error);
    }
  }

  useEffect(() => {
    const graph = graphRef.current;
    if (graph) graph.master.gain.setTargetAtTime(volume, graph.ctx.currentTime, 0.1);
  }, [volume]);

  // Tear the audio graph down when the panel unmounts.
  useEffect(
    () => () => {
      const graph = graphRef.current;
      graphRef.current = null;
      if (!graph) return;
      try {
        graph.source.stop();
        graph.lfo?.stop();
        void graph.ctx.close();
      } catch {
        // Already stopped.
      }
    },
    []
  );

  function handlePick(id: AmbienceId) {
    onAmbienceChange(id);
    start(id);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="cyber-kicker">Ambiances sonores</p>
        {playing && (
          <span aria-hidden className="flex h-4 items-end gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="w-1 rounded-full bg-cyan-300 motion-safe:animate-pulse" style={{ height: `${40 + ((i * 23) % 60)}%`, animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {AMBIENCES.map(({ id, label, icon: Icon }) => {
          const active = ambience === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handlePick(id)}
              aria-pressed={active}
              title={label}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-bold transition-all active:scale-95",
                active ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.25)]" : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-3 flex items-center gap-2.5 text-slate-400">
        {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        <span className="sr-only">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer accent-cyan-400"
        />
      </label>
    </div>
  );
}
