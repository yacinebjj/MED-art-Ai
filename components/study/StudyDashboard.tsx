"use client";

/**
 * Smart Anti-Cheat Pomodoro System — connected globally with the Topbar via PomodoroProvider.
 */

import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, Coffee, Minus, Pause, Play, Plus, RotateCcw, ShieldAlert, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { usePomodoro } from "@/providers/PomodoroProvider";

const DEFAULT_STUDY_MINUTES = 50;
const DEFAULT_BREAK_MINUTES = 10;
const DEFAULT_CYCLES = 4;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 120;
const MIN_CYCLES = 1;
const MAX_CYCLES = 12;

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** "2h 15" / "45min" — used for the two REAL stat tiles below (total elapsed
 * since last reset, and completed cycles), never the 3 fabricated period
 * breakdowns ("Aujourd'hui"/"Cette semaine"/"Ce mois") this replaced — no
 * backend tracks a per-day/week/month history, only the provider's own
 * running total since the last reset (see PomodoroProvider.tsx), so that's
 * the only real number available to show here. */
function formatHoursMinutes(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}` : `${minutes}min`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function DurationStepper({
  label,
  icon: Icon,
  value,
  unit,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  icon: typeof Timer;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="glass-card flex flex-1 flex-col items-center gap-2 rounded-2xl p-4 shadow-soft">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step, min, max))}
          disabled={disabled || value <= min}
          aria-label={`Diminuer ${label}`}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-accent-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-16 text-center text-lg font-black tabular-nums text-foreground">
          {value}
          <span className="ml-0.5 text-xs font-medium text-muted-foreground">{unit}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + step, min, max))}
          disabled={disabled || value >= max}
          aria-label={`Augmenter ${label}`}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-accent-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function StudyDashboard() {
  const { toast } = useToast();

  // currentCycle/currentMode also live in the Provider now (not local state
  // here) — see PomodoroProvider.tsx's own comment on PomodoroContextType:
  // this is what makes the Topbar widget's and PomodoroStudyBanner's own
  // "Réinitialiser" buttons reset the SAME cycle/mode this page displays,
  // instead of only resetting seconds/isActive and silently leaving
  // "Cycle 3 / 4" behind.
  const {
    seconds,
    isActive: isRunning,
    toggleActive,
    resetTimer: globalReset,
    currentCycle,
    currentMode,
    setCurrentCycle,
    setCurrentMode,
  } = usePomodoro();

  const [studyDuration, setStudyDuration] = useState(DEFAULT_STUDY_MINUTES);
  const [breakDuration, setBreakDuration] = useState(DEFAULT_BREAK_MINUTES);
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);
  const [cheatWarningVisible, setCheatWarningVisible] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);

  function playNotificationSound() {
    try {
      const AudioCtx =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) audioContextRef.current = new AudioCtx();
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") void ctx.resume();

      [880, 1108.73].forEach((frequency, i) => {
        const startAt = ctx.currentTime + i * 0.18;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.5);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.5);
      });
    } catch (error) {
      console.warn("Notification sonore indisponible:", error);
    }
  }

  // Anti-Cheat: Pause automatically if the window loses focus during study mode
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && currentMode === "study" && isRunning) {
        toggleActive();
        setCheatWarningVisible(true);
        toast({
          variant: "error",
          title: "Session mise en pause",
          description: "Activité en arrière-plan détectée. Reste concentré !",
        });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [currentMode, isRunning, toast, toggleActive]);

  function handleToggleRunning() {
    if (!isRunning) setCheatWarningVisible(false);
    toggleActive();
  }

  function handleReset() {
    setCheatWarningVisible(false);
    // globalReset() now resets currentCycle/currentMode too (see
    // PomodoroProvider.tsx) — no need to set them here separately, and
    // doing so here as well would be redundant, not incorrect, but this
    // keeps a single source of truth for what "reset" actually means.
    globalReset();
  }

  function handleStudyDurationChange(minutes: number) {
    setStudyDuration(minutes);
  }

  function handleBreakDurationChange(minutes: number) {
    setBreakDuration(minutes);
  }

  function handleCyclesChange(next: number) {
    setCycles(next);
    if (currentCycle > next) setCurrentCycle(1);
  }

  const totalPhaseSeconds = (currentMode === "study" ? studyDuration : breakDuration) * 60;
  const progress = totalPhaseSeconds > 0 ? 1 - (seconds % totalPhaseSeconds) / totalPhaseSeconds : 0;

  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamp(progress, 0, 1));

  const isStudyMode = currentMode === "study";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 font-sans text-foreground">
      {cheatWarningVisible && (
        <div className="flex animate-in items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-rose-800 shadow-sm fade-in slide-in-from-top-2 duration-300 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">Session en pause : activité en arrière-plan détectée. Reste concentré !</p>
        </div>
      )}

      {/* Centralized Pomodoro Timer — glass chrome, ambient glow that shifts
          hue with study/break mode, a breathing ring-pulse behind the timer
          while actively running (reuses tailwind.config.ts's own
          ring-pulse keyframe, already used for the animated brand mark). */}
      <Card className="glass-card relative overflow-hidden p-6 shadow-glass dark:shadow-glass-dark sm:p-10">
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl transition-colors duration-700",
            isStudyMode ? "bg-primary-400/20" : "bg-amber-400/25"
          )}
        />
        <div className="relative flex flex-col items-center gap-6">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors duration-300",
              isStudyMode
                ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            )}
          >
            {isStudyMode ? <BookOpenCheck className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
            {isStudyMode ? "Session d'étude" : "Pause"}
          </div>

          {/* Circular progress ring */}
          <div className="relative flex w-[220px] max-w-full items-center justify-center">
            {isRunning && (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-0 -m-4 animate-ring-pulse rounded-full",
                  isStudyMode ? "bg-primary-400/20" : "bg-amber-400/20"
                )}
              />
            )}
            <svg width="100%" height="100%" viewBox="0 0 220 220" className="relative -rotate-90">
              <circle cx={110} cy={110} r={radius} fill="none" strokeWidth={12} className="stroke-muted" />
              <circle
                cx={110}
                cy={110}
                r={radius}
                fill="none"
                strokeWidth={12}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={cn("transition-[stroke-dashoffset] duration-1000 ease-linear", isStudyMode ? "stroke-primary-500" : "stroke-amber-500")}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <p className="text-5xl font-black tabular-nums tracking-tight text-foreground sm:text-6xl">
                {formatTime(seconds % totalPhaseSeconds)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Cycle {currentCycle} / {cycles}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleToggleRunning}
              className={cn(
                "flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold text-white shadow-md transition-all duration-200 active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isRunning
                  ? "bg-amber-500 hover:bg-amber-600 hover:shadow-[0_0_25px_rgba(245,158,11,0.45)]"
                  : "bg-primary-600 hover:bg-primary-700 hover:shadow-[0_0_25px_rgba(20,184,166,0.45)]"
              )}
            >
              {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isRunning ? "Pause" : seconds === 0 ? "Démarrer" : "Reprendre"}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-2 rounded-full bg-muted px-6 py-3.5 text-sm font-bold text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-accent-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <RotateCcw className="h-4 w-4" />
              Réinitialiser
            </button>
          </div>
        </div>

        {/* Duration / cycles settings */}
        <div className="relative mt-8 flex flex-col gap-3 border-t border-border/60 pt-6 sm:flex-row">
          <DurationStepper
            label="Étude"
            icon={BookOpenCheck}
            value={studyDuration}
            unit="min"
            min={MIN_DURATION_MINUTES}
            max={MAX_DURATION_MINUTES}
            step={5}
            disabled={isRunning}
            onChange={handleStudyDurationChange}
          />
          <DurationStepper
            label="Pause"
            icon={Coffee}
            value={breakDuration}
            unit="min"
            min={MIN_DURATION_MINUTES}
            max={MAX_DURATION_MINUTES}
            step={5}
            disabled={isRunning}
            onChange={handleBreakDurationChange}
          />
          <DurationStepper
            label="Cycles"
            icon={Timer}
            value={cycles}
            unit="x"
            min={MIN_CYCLES}
            max={MAX_CYCLES}
            disabled={isRunning}
            onChange={handleCyclesChange}
          />
        </div>
      </Card>

      {/* Real, honest stat — replaces the previous 3-card fake "Aujourd'hui
          / Cette semaine / Ce mois" breakdown: no backend tracks a per-day/
          week/month history, only this running total since the last reset
          (see PomodoroProvider.tsx). Showing a fabricated period split would
          have been actively misleading, so this shows the one number that's
          actually real instead. */}
      <Card className="glass-card flex items-center gap-4 p-5 shadow-soft">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
          <Timer className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Temps de concentration — depuis la dernière réinitialisation
          </p>
          <p className="mt-0.5 text-2xl font-black text-foreground">{formatHoursMinutes(seconds)}</p>
        </div>
      </Card>
    </div>
  );
}