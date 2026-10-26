/**
 * Pomodoro schedule — the one source of truth shared by PomodoroProvider (the
 * app-wide engine: phase changes, chime, auto-stop, on every page) and the
 * Study page's dial. The provider only counts real elapsed seconds since the
 * last reset; the whole study → break → study … × cycles schedule is derived
 * from that count and the student's durations, a per-device preference the
 * Study page saves.
 */

export type PomodoroMode = "study" | "break";

/** What a phase change announces: a break begins, focus resumes, or the last cycle is done. */
export type PomodoroCue = "break" | "focus" | "complete";

export const POMODORO_SETTINGS_KEY = "medart:pomodoro-settings";
/** Fired on `window` once the Study page has saved new durations: the provider re-reads them at once (other tabs get the native `storage` event). */
export const POMODORO_SETTINGS_EVENT = "medart:pomodoro-settings";
/** Fired on `window` by the provider on each real phase change while the timer runs — the toasts listen to it. */
export const POMODORO_PHASE_EVENT = "medart:pomodoro-phase";

export const DEFAULT_STUDY_MINUTES = 50;
export const DEFAULT_BREAK_MINUTES = 10;
export const DEFAULT_CYCLES = 4;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 120;
export const MIN_CYCLES = 1;
export const MAX_CYCLES = 12;

export interface PomodoroTiming {
  study: number;
  rest: number;
  cycles: number;
}

export interface PomodoroPhaseEventDetail {
  cue: PomodoroCue;
  /** 1-based cycle the new phase belongs to. */
  cycle: number;
  timing: PomodoroTiming;
}

export const DEFAULT_POMODORO_TIMING: PomodoroTiming = {
  study: DEFAULT_STUDY_MINUTES,
  rest: DEFAULT_BREAK_MINUTES,
  cycles: DEFAULT_CYCLES,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The stored settings object as saved (it also carries the Study page's ambience), or null when absent or unreadable. */
export function readStoredPomodoroSettings(): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(POMODORO_SETTINGS_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The durations inside a stored settings object — anything missing or invalid falls back to its default. */
export function parsePomodoroTiming(raw: Record<string, unknown> | null): PomodoroTiming {
  if (!raw) return DEFAULT_POMODORO_TIMING;
  const num = (v: unknown, min: number, max: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(Math.round(v), min, max) : def);
  return {
    study: num(raw.study, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, DEFAULT_STUDY_MINUTES),
    rest: num(raw.rest, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES, DEFAULT_BREAK_MINUTES),
    cycles: num(raw.cycles, MIN_CYCLES, MAX_CYCLES, DEFAULT_CYCLES),
  };
}

/** Saves the Study page's settings (durations + its own extras, like the ambience) and tells the provider right away. */
export function savePomodoroSettings<T extends PomodoroTiming>(settings: T): void {
  try {
    window.localStorage.setItem(POMODORO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Best-effort preference.
  }
  window.dispatchEvent(new Event(POMODORO_SETTINGS_EVENT));
}

export interface PomodoroPhase {
  /** Every cycle elapsed: the session is over. */
  isComplete: boolean;
  /** 0-based. */
  cycleIndex: number;
  mode: PomodoroMode;
  /** Seconds. */
  phaseLength: number;
  phaseElapsed: number;
  phaseRemaining: number;
  /** 0 → 1 through the current phase. */
  phaseProgress: number;
}

export function derivePomodoroPhase(seconds: number, timing: PomodoroTiming): PomodoroPhase {
  const studySec = timing.study * 60;
  const breakSec = timing.rest * 60;
  const cycleSec = studySec + breakSec;
  const totalSec = cycleSec * timing.cycles;
  const isComplete = seconds >= totalSec;
  const elapsed = Math.min(seconds, totalSec);
  const cycleIndex = Math.min(Math.floor(elapsed / cycleSec), timing.cycles - 1);
  const positionInCycle = isComplete ? cycleSec : elapsed - cycleIndex * cycleSec;
  const mode: PomodoroMode = positionInCycle < studySec ? "study" : "break";
  const phaseLength = mode === "study" ? studySec : breakSec;
  const phaseElapsed = mode === "study" ? positionInCycle : positionInCycle - studySec;
  return {
    isComplete,
    cycleIndex,
    mode,
    phaseLength,
    phaseElapsed,
    phaseRemaining: Math.max(0, phaseLength - phaseElapsed),
    phaseProgress: phaseLength > 0 ? phaseElapsed / phaseLength : 0,
  };
}
