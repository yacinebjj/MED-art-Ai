"use client";

/**
 * Pomodoro cockpit — connected globally with the Topbar via PomodoroProvider.
 *
 * The provider counts real elapsed seconds since the last reset; this view
 * derives the whole schedule from it (study → break → study … × cycles), so
 * phase changes happen on their own with a chime, and the session stops by
 * itself after the last cycle. Durations are a per-device preference.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpenCheck, Coffee, Flame, Minus, Pause, Play, Plus, RotateCcw, ShieldAlert, Timer, Trophy, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { localDayKey, usePomodoro } from "@/providers/PomodoroProvider";
import { CyberPanel, NeonRing } from "@/components/cyber/primitives";
import { useMagnetic, useRichEffects } from "@/components/cyber/hooks";
import { AMBIENCES, AmbiencePanel, type AmbienceId } from "./pomodoro/AmbiencePanel";
import { BreathingPanel } from "./pomodoro/BreathingPanel";

const DEFAULT_STUDY_MINUTES = 50;
const DEFAULT_BREAK_MINUTES = 10;
const DEFAULT_CYCLES = 4;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 120;
const MIN_CYCLES = 1;
const MAX_CYCLES = 12;
const SETTINGS_KEY = "medart:pomodoro-settings";

const PRESETS = [
  { label: "Classique", study: 25, rest: 5, cycles: 4 },
  { label: "Deep work", study: 50, rest: 10, cycles: 4 },
  { label: "Marathon", study: 90, rest: 15, cycles: 2 },
] as const;

interface PomodoroSettings {
  study: number;
  rest: number;
  cycles: number;
  ambience: AmbienceId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** "2h 15" / "45min" — real totals only (session since reset, focus log per day). */
function formatHoursMinutes(totalSeconds: number): string {
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}` : `${minutes}min`;
}

function loadSettings(): PomodoroSettings {
  const fallback: PomodoroSettings = { study: DEFAULT_STUDY_MINUTES, rest: DEFAULT_BREAK_MINUTES, cycles: DEFAULT_CYCLES, ambience: "none" };
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return fallback;
    const raw = parsed as Record<string, unknown>;
    const num = (v: unknown, min: number, max: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), min, max) : def);
    const ambience = AMBIENCES.some((a) => a.id === raw.ambience) ? (raw.ambience as AmbienceId) : "none";
    return {
      study: num(raw.study, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, fallback.study),
      rest: num(raw.rest, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, fallback.rest),
      cycles: num(raw.cycles, MIN_CYCLES, MAX_CYCLES, fallback.cycles),
      ambience,
    };
  } catch {
    return fallback;
  }
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
  const buttonClass =
    "flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition-all hover:border-cyan-400/40 hover:text-white active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100";
  return (
    <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Icon className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[10px] font-bold uppercase tracking-[0.16em]">{label}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => onChange(clamp(value - step, min, max))} disabled={disabled || value <= min} aria-label={`Diminuer ${label}`} className={buttonClass}>
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-14 text-center text-xl font-black tabular-nums text-white">
          {value}
          <span className="ml-0.5 text-[11px] font-semibold text-slate-500">{unit}</span>
        </span>
        <button type="button" onClick={() => onChange(clamp(value + step, min, max))} disabled={disabled || value >= max} aria-label={`Augmenter ${label}`} className={buttonClass}>
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function StudyDashboard() {
  const { toast } = useToast();
  const rich = useRichEffects();
  const isWide = useMediaQuery("(min-width: 640px)");
  const startRef = useMagnetic<HTMLButtonElement>(0.2);

  const { seconds, isActive: isRunning, toggleActive, resetTimer: globalReset, currentCycle, currentMode, setCurrentCycle, setCurrentMode, focusLog } = usePomodoro();

  const [settings, setSettings] = useState<PomodoroSettings>({ study: DEFAULT_STUDY_MINUTES, rest: DEFAULT_BREAK_MINUTES, cycles: DEFAULT_CYCLES, ambience: "none" });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [cheatWarningVisible, setCheatWarningVisible] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Best-effort preference.
    }
  }, [settings, settingsLoaded]);

  // ── Schedule derived from the provider's real elapsed seconds ─────────
  const studySec = settings.study * 60;
  const breakSec = settings.rest * 60;
  const cycleSec = studySec + breakSec;
  const totalSec = cycleSec * settings.cycles;
  const isComplete = seconds >= totalSec;
  const elapsed = Math.min(seconds, totalSec);
  const cycleIndex = Math.min(Math.floor(elapsed / cycleSec), settings.cycles - 1);
  const positionInCycle = isComplete ? cycleSec : elapsed - cycleIndex * cycleSec;
  const derivedMode = positionInCycle < studySec ? "study" : "break";
  const phaseLength = derivedMode === "study" ? studySec : breakSec;
  const phaseElapsed = derivedMode === "study" ? positionInCycle : positionInCycle - studySec;
  const phaseRemaining = Math.max(0, phaseLength - phaseElapsed);
  const phaseProgress = phaseLength > 0 ? phaseElapsed / phaseLength : 0;
  const isStudyMode = derivedMode === "study";

  function playChime(frequencies: number[] = [880, 1108.73]) {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) audioContextRef.current = new AudioCtx();
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      frequencies.forEach((frequency, i) => {
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

  // Keep the provider's shared cycle/mode (Topbar, banner) in step with the
  // derived schedule, and announce real transitions while the timer runs.
  const lastPhaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settingsLoaded) return;
    const key = `${cycleIndex}:${derivedMode}`;
    if (currentCycle !== cycleIndex + 1) setCurrentCycle(cycleIndex + 1);
    if (currentMode !== derivedMode) setCurrentMode(derivedMode);
    const previous = lastPhaseRef.current;
    lastPhaseRef.current = key;
    if (previous === null || previous === key || !isRunning) return;
    playChime(derivedMode === "break" ? [880, 1108.73] : [659.25, 880]);
    toast({
      variant: "info",
      title: derivedMode === "break" ? "Pause méritée ☕" : `Cycle ${cycleIndex + 1} — on repart !`,
      description: derivedMode === "break" ? `${settings.rest} min pour souffler. Essaie le mode respiration.` : `${settings.study} min de concentration.`,
    });
    // Only phase changes matter here — not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleIndex, derivedMode, settingsLoaded]);

  // The whole session is done: stop the clock once and celebrate.
  const completionAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!isComplete) {
      completionAnnouncedRef.current = false;
      return;
    }
    if (!isRunning || completionAnnouncedRef.current) return;
    completionAnnouncedRef.current = true;
    toggleActive();
    playChime([523.25, 659.25, 783.99, 1046.5]);
    toast({ variant: "success", title: "Session terminée 🏆", description: `${settings.cycles} cycle${settings.cycles > 1 ? "s" : ""} bouclé${settings.cycles > 1 ? "s" : ""}. Bravo !` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, isRunning]);

  // Anti-cheat: pause automatically if the window loses focus during study mode.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && derivedMode === "study" && isRunning) {
        toggleActive();
        setCheatWarningVisible(true);
        toast({ variant: "error", title: "Session mise en pause", description: "Activité en arrière-plan détectée. Reste concentré !" });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [derivedMode, isRunning, toast, toggleActive]);

  function handleToggleRunning() {
    if (!isRunning) setCheatWarningVisible(false);
    if (!isRunning && isComplete) {
      // Start a fresh session (resetTimer pauses; toggleActive then starts from 00:00).
      globalReset();
    }
    toggleActive();
  }

  function handleReset() {
    setCheatWarningVisible(false);
    globalReset();
  }

  function patchSettings(patch: Partial<PomodoroSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  // ── Real focus history from the provider's per-day log ────────────────
  const week = useMemo(() => {
    const days: { key: string; label: string; seconds: number }[] = [];
    const formatter = new Intl.DateTimeFormat("fr-FR", { weekday: "narrow" });
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = localDayKey(date);
      days.push({ key, label: formatter.format(date), seconds: focusLog[key] ?? 0 });
    }
    return days;
  }, [focusLog]);
  const todaySeconds = week[week.length - 1]?.seconds ?? 0;
  const weekMax = Math.max(1, ...week.map((d) => d.seconds));
  const weekTotal = week.reduce((sum, d) => sum + d.seconds, 0);
  const streak = useMemo(() => {
    let count = 0;
    for (let i = week.length - 1; i >= 0; i--) {
      if (week[i].seconds >= 60) count++;
      else if (i !== week.length - 1) break;
    }
    return count;
  }, [week]);

  const ambienceTint = AMBIENCES.find((a) => a.id === settings.ambience)?.tint ?? AMBIENCES[0].tint;
  const dialSize = isWide ? 320 : 264;
  const ringFrom = isStudyMode ? "#22d3ee" : "#fbbf24";
  const ringTo = isStudyMode ? "#8b5cf6" : "#f43f5e";

  return (
    <div className="space-y-5">
      <AnimatePresence>
        {cheatWarningVisible && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200"
          >
            <ShieldAlert className="h-5 w-5 shrink-0" />
            <p className="text-sm font-bold">Session en pause : activité en arrière-plan détectée. Reste concentré !</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* ── Monumental dial ─────────────────────────────────────────── */}
        <CyberPanel laser={rich ? "spin" : true} accent={isStudyMode ? "cyan" : "amber"} className="overflow-hidden p-5 sm:p-8">
          <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br transition-colors duration-1000", ambienceTint)} />
          <div className="relative flex flex-col items-center gap-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={derivedMode}
                initial={{ opacity: 0, y: -10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.2em]",
                  isStudyMode ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-amber-400/40 bg-amber-400/10 text-amber-200"
                )}
              >
                {isStudyMode ? <BookOpenCheck className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
                {isComplete ? "Session terminée" : isStudyMode ? "Session d'étude" : "Pause"}
              </motion.div>
            </AnimatePresence>

            <div className="relative">
              {/* Scanner ring + breathing halo (desktop only — see cyber.css). */}
              <span aria-hidden className="cyber-rotate absolute -inset-3 rounded-full border border-dashed border-white/10" />
              {isRunning && rich && <span aria-hidden className={cn("cyber-breathe absolute inset-6 rounded-full blur-2xl", isStudyMode ? "bg-cyan-500/25" : "bg-amber-500/25")} />}
              <NeonRing value={isComplete ? 1 : phaseProgress} size={dialSize} stroke={isWide ? 14 : 12} ticks={60} from={ringFrom} to={ringTo} aria-label={`Temps restant ${formatTime(phaseRemaining)}`}>
                <span className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400">{isStudyMode ? "Focus" : "Récup"}</span>
                <span className="mt-2 font-mono text-5xl font-black tabular-nums tracking-tight text-white sm:text-6xl">{formatTime(phaseRemaining)}</span>
                <span className="mt-2 text-xs font-semibold text-slate-400">
                  Cycle {cycleIndex + 1} / {settings.cycles}
                </span>
              </NeonRing>
            </div>

            {/* Cycle timeline: one segment per study + break block. */}
            <div className="flex w-full max-w-md items-center gap-1" aria-hidden>
              {Array.from({ length: settings.cycles }, (_, i) => {
                const studyFill = i < cycleIndex || isComplete ? 1 : i === cycleIndex ? (isStudyMode ? phaseProgress : 1) : 0;
                const breakFill = i < cycleIndex || isComplete ? 1 : i === cycleIndex && !isStudyMode ? phaseProgress : 0;
                return (
                  <div key={i} className="flex flex-1 gap-0.5" style={{ flexGrow: settings.study + settings.rest }}>
                    <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" style={{ flexGrow: settings.study }}>
                      <span className="block h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width] duration-1000 ease-linear" style={{ width: `${studyFill * 100}%` }} />
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" style={{ flexGrow: settings.rest }}>
                      <span className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-rose-500 transition-[width] duration-1000 ease-linear" style={{ width: `${breakFill * 100}%` }} />
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                ref={startRef}
                type="button"
                onClick={handleToggleRunning}
                className={cn(
                  "cyber-magnetic group relative flex min-h-14 items-center gap-2.5 overflow-hidden rounded-2xl px-8 text-sm font-black uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70",
                  isRunning ? "bg-amber-400 text-slate-950 shadow-[0_0_30px_rgba(251,191,36,0.45)]" : "bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-500 text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.5)]"
                )}
              >
                <span aria-hidden className="cyber-sheen" />
                {isRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                {isRunning ? "Pause" : seconds === 0 || isComplete ? "Décollage" : "Reprendre"}
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex min-h-14 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-6 text-sm font-bold text-slate-300 transition-all hover:border-white/25 hover:text-white active:scale-95"
              >
                <RotateCcw className="h-4 w-4" />
                Réinitialiser
              </button>
            </div>
          </div>

          {/* Presets + steppers */}
          <div className="relative mt-8 border-t border-white/[0.07] pt-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="cyber-kicker mr-1">Programmes</span>
              {PRESETS.map((preset) => {
                const active = settings.study === preset.study && settings.rest === preset.rest && settings.cycles === preset.cycles;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={isRunning}
                    onClick={() => patchSettings({ study: preset.study, rest: preset.rest, cycles: preset.cycles })}
                    className={cn(
                      "min-h-9 rounded-xl border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      active ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100" : "border-white/[0.08] text-slate-400 hover:text-white"
                    )}
                  >
                    {preset.label} · {preset.study}/{preset.rest}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <DurationStepper label="Étude" icon={BookOpenCheck} value={settings.study} unit="min" min={MIN_DURATION_MINUTES} max={MAX_DURATION_MINUTES} step={5} disabled={isRunning} onChange={(study) => patchSettings({ study })} />
              <DurationStepper label="Pause" icon={Coffee} value={settings.rest} unit="min" min={MIN_DURATION_MINUTES} max={MAX_DURATION_MINUTES} step={5} disabled={isRunning} onChange={(rest) => patchSettings({ rest })} />
              <DurationStepper label="Cycles" icon={Timer} value={settings.cycles} unit="x" min={MIN_CYCLES} max={MAX_CYCLES} disabled={isRunning} onChange={(cycles) => patchSettings({ cycles })} />
            </div>
          </div>
        </CyberPanel>

        {/* ── Side console ────────────────────────────────────────────── */}
        <div className="space-y-5">
          <CyberPanel className="p-5">
            <p className="cyber-kicker">Télémétrie de focus</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Aujourd&apos;hui</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{formatHoursMinutes(todaySeconds)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cette session</p>
                <p className="mt-1 text-2xl font-black tabular-nums text-white">{formatHoursMinutes(seconds)}</p>
              </div>
            </div>
            <div className="mt-4 flex h-24 items-end gap-1.5" aria-label="Temps de concentration des 7 derniers jours">
              {week.map((day, i) => (
                <div key={day.key} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-20 w-full items-end overflow-hidden rounded-md bg-white/[0.04]">
                    <motion.div
                      className={cn("w-full rounded-md", i === week.length - 1 ? "bg-gradient-to-t from-cyan-500 to-violet-400" : "bg-gradient-to-t from-cyan-500/50 to-sky-400/50")}
                      initial={false}
                      animate={{ height: `${Math.max(day.seconds > 0 ? 6 : 0, (day.seconds / weekMax) * 100)}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      title={`${formatHoursMinutes(day.seconds)}`}
                    />
                  </div>
                  <span className="text-[10px] font-bold uppercase text-slate-500">{day.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Zap className="h-3.5 w-3.5 text-cyan-300" /> 7 jours : <b className="text-white">{formatHoursMinutes(weekTotal)}</b>
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <Flame className="h-3.5 w-3.5 text-amber-300" /> Série : <b className="text-white">{streak} j</b>
              </span>
            </div>
            {isComplete && (
              <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-200">
                <Trophy className="h-3.5 w-3.5" /> Programme bouclé — relance pour un nouveau tour.
              </p>
            )}
          </CyberPanel>

          <CyberPanel className="p-5">
            <BreathingPanel suggested={!isStudyMode && !isComplete} />
          </CyberPanel>

          <CyberPanel className="p-5">
            <AmbiencePanel ambience={settings.ambience} onAmbienceChange={(ambience) => patchSettings({ ambience })} />
          </CyberPanel>
        </div>
      </div>
    </div>
  );
}
