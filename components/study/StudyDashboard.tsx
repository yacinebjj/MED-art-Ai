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

const MOCK_STATS = [
  { label: "Aujourd'hui", value: "2h 15m" },
  { label: "Cette semaine", value: "14h 30m" },
  { label: "Ce mois", value: "48h 00m" },
];

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
    <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-border bg-muted/40 p-4">
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
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
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
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function StudyDashboard() {
  const { toast } = useToast();

  // 👈 ربط العداد مباشرة مع الـ Context العالمي لتتم المزامنة تلقائياً مع الـ Topbar
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
  // استخدام الـ seconds القادم من الـ Provider العالمي
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

      {/* Centralized Pomodoro Timer */}
      <Card className="p-6 sm:p-10">
        <div className="flex flex-col items-center gap-6">
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
            <svg width="100%" height="100%" viewBox="0 0 220 220" className="-rotate-90">
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
                "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white shadow-sm transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isRunning ? "bg-amber-500 hover:bg-amber-600" : "bg-primary-600 hover:bg-primary-700"
              )}
            >
              {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isRunning ? "Pause" : seconds === 0 ? "Démarrer" : "Reprendre"}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-2 rounded-xl bg-muted px-6 py-3 text-sm font-bold text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-accent-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <RotateCcw className="h-4 w-4" />
              Réinitialiser
            </button>
          </div>
        </div>

        {/* Duration / cycles settings */}
        <div className="mt-8 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row">
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

      {/* Mocked time-tracking stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MOCK_STATS.map((stat) => (
          <Card key={stat.label} className="p-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Temps d&apos;étude — {stat.label}
            </p>
            <p className="mt-1 text-2xl font-black text-foreground">{stat.value}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}