"use client";

/**
 * Smart Anti-Cheat Pomodoro System — replaces the earlier XP-grid prototype
 * entirely. Zero backend: everything here is local React state, per spec.
 *
 * Anti-cheat mechanism: a `visibilitychange` listener auto-pauses the timer
 * the instant the tab/window loses focus WHILE a study phase is running —
 * tabbing away to a video, another app, or a different browser tab
 * immediately stops the clock instead of letting it silently keep counting
 * unattended "focus" time.
 *
 * Notification sound: synthesized with the Web Audio API (a short sine
 * beep) rather than shipping an embedded base64 audio file — this
 * guarantees the sound is byte-correct and needs no asset file, while still
 * satisfying "audio feedback on completion, handled safely." Swap in
 * `new Audio("/sounds/bell.mp3")` inside playNotificationSound() below if a
 * real sound asset gets added to /public later; the try/catch around it
 * already covers browser autoplay-policy rejections either way.
 */

import { useEffect, useRef, useState } from "react";
import { BookOpenCheck, Coffee, Minus, Pause, Play, Plus, RotateCcw, ShieldAlert, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

type TimerMode = "study" | "break";

const DEFAULT_STUDY_MINUTES = 50;
const DEFAULT_BREAK_MINUTES = 10;
const DEFAULT_CYCLES = 4;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 120;
const MIN_CYCLES = 1;
const MAX_CYCLES = 12;

// Mocked lifetime stats — independent of the live timer above, exactly like
// the header stats in the previous XP prototype were independent of its
// live session counter. No backend field exists yet for real study-time
// aggregation; wiring this to qcm_attempts/course_chat_history timestamps
// (the only real activity timestamps this app has) would be a separate,
// larger feature.
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

/** Small labeled stepper for the study/break/cycles settings — disabled entirely while the timer is running, since changing it mid-session would desync timeLeft from a duration the user can no longer see reflected on the clock. */
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
    <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step, min, max))}
          disabled={disabled || value <= min}
          aria-label={`Diminuer ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-16 text-center text-lg font-black tabular-nums text-slate-900 dark:text-white">
          {value}
          <span className="ml-0.5 text-xs font-medium text-slate-400 dark:text-slate-500">{unit}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + step, min, max))}
          disabled={disabled || value >= max}
          aria-label={`Augmenter ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function StudyDashboard() {
  const { toast } = useToast();

  const [studyDuration, setStudyDuration] = useState(DEFAULT_STUDY_MINUTES);
  const [breakDuration, setBreakDuration] = useState(DEFAULT_BREAK_MINUTES);
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [currentMode, setCurrentMode] = useState<TimerMode>("study");
  const [timeLeft, setTimeLeft] = useState(DEFAULT_STUDY_MINUTES * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [cheatWarningVisible, setCheatWarningVisible] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  /** Synthesizes a short two-tone chime — no external asset, so it can never 404 or ship corrupted. */
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
      // Autoplay policy blocked it, AudioContext unavailable, or the tab was
      // never interacted with yet — the timer keeps working regardless,
      // audio feedback is a nice-to-have, never a hard requirement.
      console.warn("Notification sonore indisponible:", error);
    }
  }

  // Ticks once per second, only while running. Cleared on every isRunning
  // change and on unmount, so no interval ever outlives this effect.
  useEffect(() => {
    if (!isRunning) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [isRunning]);

  // Phase-completion transitions — study -> break -> study -> ... until all
  // cycles are done, then stops. Guarded on timeLeft === 0 so it only fires
  // once per phase (setTimeLeft below immediately moves it away from 0).
  useEffect(() => {
    if (timeLeft !== 0) return;
    playNotificationSound();

    if (currentMode === "study") {
      if (currentCycle >= cycles) {
        setIsRunning(false);
        toast({
          variant: "success",
          title: "Session terminée !",
          description: `${cycles} cycle${cycles > 1 ? "s" : ""} d'étude complété${cycles > 1 ? "s" : ""}. Excellent travail.`,
        });
        setCurrentCycle(1);
        setCurrentMode("study");
        setTimeLeft(studyDuration * 60);
      } else {
        toast({ variant: "info", title: "Pause méritée", description: `${breakDuration} min de pause avant le prochain cycle.` });
        setCurrentMode("break");
        setTimeLeft(breakDuration * 60);
      }
    } else {
      toast({ variant: "info", title: "Pause terminée", description: "Retour à l'étude." });
      setCurrentCycle((c) => c + 1);
      setCurrentMode("study");
      setTimeLeft(studyDuration * 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  // Anti-Cheat: the instant the tab/window is hidden during a RUNNING study
  // phase, pause immediately — never during a break (leaving the tab during
  // a break is expected and fine) and never when already paused.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && currentMode === "study" && isRunning) {
        setIsRunning(false);
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
  }, [currentMode, isRunning, toast]);

  function handleToggleRunning() {
    if (!isRunning) setCheatWarningVisible(false);
    setIsRunning((prev) => !prev);
  }

  function handleReset() {
    setIsRunning(false);
    setCheatWarningVisible(false);
    setCurrentMode("study");
    setCurrentCycle(1);
    setTimeLeft(studyDuration * 60);
  }

  function handleStudyDurationChange(minutes: number) {
    setStudyDuration(minutes);
    if (!isRunning && currentMode === "study") setTimeLeft(minutes * 60);
  }

  function handleBreakDurationChange(minutes: number) {
    setBreakDuration(minutes);
    if (!isRunning && currentMode === "break") setTimeLeft(minutes * 60);
  }

  function handleCyclesChange(next: number) {
    setCycles(next);
    if (currentCycle > next) setCurrentCycle(1);
  }

  const totalPhaseSeconds = (currentMode === "study" ? studyDuration : breakDuration) * 60;
  const progress = totalPhaseSeconds > 0 ? 1 - timeLeft / totalPhaseSeconds : 0;

  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamp(progress, 0, 1));

  const isStudyMode = currentMode === "study";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 font-sans text-slate-800 dark:text-slate-200">
      {/* Anti-cheat warning banner — persists (unlike the auto-dismissing toast) until the student explicitly resumes, so it can't be missed if they were away when it fired. */}
      {cheatWarningVisible && (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-rose-800 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">Session en pause : activité en arrière-plan détectée. Reste concentré !</p>
        </div>
      )}

      {/* Centralized Pomodoro Timer */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-soft dark:border-slate-800 dark:bg-slate-900 sm:p-10">
        <div className="flex flex-col items-center gap-6">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest transition-colors duration-300",
              isStudyMode
                ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            )}
          >
            {isStudyMode ? <BookOpenCheck className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
            {isStudyMode ? "Session d'étude" : "Pause"}
          </div>

          {/* Circular progress ring around the clock */}
          <div className="relative flex items-center justify-center">
            <svg width={220} height={220} viewBox="0 0 220 220" className="-rotate-90">
              <circle cx={110} cy={110} r={radius} fill="none" strokeWidth={12} className="stroke-slate-100 dark:stroke-slate-800" />
              <circle
                cx={110}
                cy={110}
                r={radius}
                fill="none"
                strokeWidth={12}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className={cn("transition-[stroke-dashoffset] duration-1000 ease-linear", isStudyMode ? "stroke-teal-500" : "stroke-amber-500")}
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <p className="text-5xl font-black tabular-nums tracking-tight text-slate-900 dark:text-white sm:text-6xl">
                {formatTime(timeLeft)}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-400 dark:text-slate-500">
                Cycle {currentCycle} / {cycles}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleToggleRunning}
              className={cn(
                "flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-white shadow-sm transition-all duration-200 active:scale-95",
                isRunning ? "bg-amber-500 hover:bg-amber-600" : "bg-teal-600 hover:bg-teal-700"
              )}
            >
              {isRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isRunning ? "Pause" : timeLeft === totalPhaseSeconds ? "Démarrer" : "Reprendre"}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-2 rounded-xl bg-slate-100 px-6 py-3 text-sm font-bold text-slate-600 shadow-sm transition-all duration-200 hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <RotateCcw className="h-4 w-4" />
              Réinitialiser
            </button>
          </div>
        </div>

        {/* Duration / cycles settings — locked while a phase is actively running */}
        <div className="mt-8 flex flex-col gap-3 border-t border-slate-100 pt-6 dark:border-slate-800 sm:flex-row">
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
      </div>

      {/* Mocked time-tracking stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {MOCK_STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-soft dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Temps d&apos;étude — {stat.label}
            </p>
            <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
