"use client";

import { memo, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Pause, Play, Wind } from "lucide-react";
import { cn } from "@/lib/utils";

interface BreathPhase {
  label: string;
  seconds: number;
  /** Target scale of the orb at the END of this phase. */
  scale: number;
}

interface BreathPattern {
  id: string;
  label: string;
  hint: string;
  phases: BreathPhase[];
}

const PATTERNS: BreathPattern[] = [
  {
    id: "coherence",
    label: "Cohérence",
    hint: "5 s / 5 s — calme le stress avant un examen",
    phases: [
      { label: "Inspire", seconds: 5, scale: 1 },
      { label: "Expire", seconds: 5, scale: 0.55 },
    ],
  },
  {
    id: "box",
    label: "Carré",
    hint: "4-4-4-4 — la respiration des pilotes",
    phases: [
      { label: "Inspire", seconds: 4, scale: 1 },
      { label: "Retiens", seconds: 4, scale: 1 },
      { label: "Expire", seconds: 4, scale: 0.55 },
      { label: "Retiens", seconds: 4, scale: 0.55 },
    ],
  },
  {
    id: "478",
    label: "4-7-8",
    hint: "Relâche la tension après une longue session",
    phases: [
      { label: "Inspire", seconds: 4, scale: 1 },
      { label: "Retiens", seconds: 7, scale: 1 },
      { label: "Expire", seconds: 8, scale: 0.55 },
    ],
  },
];

/** Guided breathing between Pomodoro cycles — an animated orb that expands / contracts with the phases. */
export const BreathingPanel = memo(function BreathingPanel({ suggested }: { suggested: boolean }) {
  const reduceMotion = useReducedMotion();
  const [patternId, setPatternId] = useState(PATTERNS[0].id);
  const [running, setRunning] = useState(false);
  const pattern = PATTERNS.find((p) => p.id === patternId) ?? PATTERNS[0];
  const [cursor, setCursor] = useState({ phaseIndex: 0, remaining: pattern.phases[0].seconds, rounds: 0 });
  const { phaseIndex, remaining, rounds } = cursor;
  const phase = pattern.phases[phaseIndex] ?? pattern.phases[0];

  useEffect(() => {
    setCursor({ phaseIndex: 0, remaining: pattern.phases[0].seconds, rounds: 0 });
  }, [pattern]);

  // One-second ticker, only while the guide is running (pure updater — safe under StrictMode).
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setCursor((c) => {
        if (c.remaining > 1) return { ...c, remaining: c.remaining - 1 };
        const next = (c.phaseIndex + 1) % pattern.phases.length;
        return { phaseIndex: next, remaining: pattern.phases[next].seconds, rounds: next === 0 ? c.rounds + 1 : c.rounds };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, pattern]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="cyber-kicker">Mode respiration</p>
        {suggested && !running && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">Idéal pendant la pause</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPatternId(p.id)}
            aria-pressed={p.id === patternId}
            className={cn(
              "min-h-9 rounded-xl border px-3 text-xs font-bold transition-colors",
              p.id === patternId ? "border-violet-400/60 bg-violet-400/15 text-violet-100" : "border-white/[0.07] text-slate-400 hover:text-white"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">{pattern.hint}</p>

      <div className="mt-4 flex items-center gap-5">
        <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
          <span aria-hidden className="absolute inset-0 rounded-full border border-violet-400/20" />
          <motion.span
            aria-hidden
            className="absolute inset-2 rounded-full bg-[radial-gradient(circle_at_35%_30%,rgba(196,181,253,0.9),rgba(139,92,246,0.45)_45%,rgba(34,211,238,0.15)_75%)] shadow-[0_0_40px_rgba(139,92,246,0.45)]"
            initial={false}
            animate={{ scale: running && !reduceMotion ? phase.scale : 0.75 }}
            transition={{ duration: running ? phase.seconds : 0.4, ease: "easeInOut" }}
          />
          <span className="relative text-center">
            <span className="block text-xs font-black uppercase tracking-widest text-white">{running ? phase.label : "Prêt"}</span>
            {running && <span className="block font-mono text-lg font-black tabular-nums text-violet-100">{remaining}</span>}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className={cn(
              "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-transform active:scale-95",
              running ? "bg-white/10 text-white" : "bg-gradient-to-r from-violet-400 to-fuchsia-500 text-white shadow-[0_0_24px_rgba(139,92,246,0.4)]"
            )}
          >
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? "Arrêter" : "Respirer"}
          </button>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Wind className="h-3.5 w-3.5 text-violet-300" />
            {rounds} cycle{rounds > 1 ? "s" : ""} complété{rounds > 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </div>
  );
});
