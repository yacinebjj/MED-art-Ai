"use client";

import { forwardRef } from "react";
import { EyeOff, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The study chrono in the app's top bars (components/layout/Topbar.tsx and
 * the module workspace's WorkspaceCommandBar): one seamless glass pill —
 * a calm status dot, the time in tabular monospace digits (they never
 * jitter as they tick), a hairline, then its controls. Every control is the
 * same circle, concentric with the pill's ends: Play/Pause filled in the
 * Copilot's blue, Reset and Hide quiet.
 */

/** "MM:SS"; minutes keep counting past 59, like the engine (a long session reads 75:12). */
export function formatPomodoroClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** The pill surface, shared by the running chrono and its collapsed "Chrono" chip. */
export const POMODORO_PILL_SURFACE =
  "border border-black/[0.06] bg-white/75 shadow-[0_1px_2px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl dark:border-white/[0.09] dark:bg-white/[0.05] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50";

const SIZES = {
  // Topbar: a 36 px pill, 28 px controls.
  md: { pill: "h-9 p-1", button: "h-7 w-7", glyph: "h-3 w-3", icon: "h-3.5 w-3.5", digits: "text-[0.8125rem]" },
  // Workspace bar: a 32 px pill beside its other 32 px controls, 24 px controls.
  sm: { pill: "h-8 p-1", button: "h-6 w-6", glyph: "h-2.5 w-2.5", icon: "h-3 w-3", digits: "text-[0.75rem]" },
} as const;

interface PomodoroPillProps {
  seconds: number;
  isActive: boolean;
  onToggle: () => void;
  onReset: () => void;
  /** Topbar only: folds the chrono back into its chip. */
  onHide?: () => void;
  labels: { start: string; pause: string; reset: string; hide?: string };
  size?: keyof typeof SIZES;
  /** Phones (Topbar): the running pill stays compact — time and Play/Pause only. */
  compactOnPhones?: boolean;
  className?: string;
}

export const PomodoroPill = forwardRef<HTMLDivElement, PomodoroPillProps>(function PomodoroPill(
  { seconds, isActive, onToggle, onReset, onHide, labels, size = "md", compactOnPhones = false, className },
  ref
) {
  const s = SIZES[size];
  const quietButton = cn(
    "flex shrink-0 items-center justify-center rounded-full text-slate-500 transition-[background-color,color,transform] duration-150 hover:bg-black/[0.06] hover:text-slate-900 active:scale-[0.92] dark:text-white/55 dark:hover:bg-white/[0.1] dark:hover:text-white",
    s.button,
    FOCUS_RING,
    compactOnPhones && "max-sm:hidden"
  );

  return (
    <div ref={ref} role="group" aria-label="Chrono d'étude" className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full", POMODORO_PILL_SURFACE, s.pill, className)}>
      {/* Status: sky and softly breathing while the clock runs, a quiet grey at rest — never an urgent flash. */}
      <span aria-hidden className="relative ml-1.5 flex h-2 w-2 shrink-0">
        {isActive && <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/50 [animation-duration:2.4s]" />}
        <span
          className={cn(
            "relative h-2 w-2 rounded-full transition-colors duration-300",
            isActive ? "bg-sky-500 shadow-[0_0_8px_rgba(56,189,248,0.75)] dark:bg-sky-400" : "bg-slate-300 dark:bg-white/25"
          )}
        />
      </span>

      {/* Tabular monospace digits: every tick keeps the same width. */}
      <span className={cn("min-w-[3.25rem] px-1.5 text-center font-mono font-semibold tabular-nums tracking-[-0.02em] text-slate-900 dark:text-white", s.digits)}>
        {formatPomodoroClock(seconds)}
      </span>

      <span aria-hidden className="mr-0.5 h-4 w-px shrink-0 bg-black/[0.08] dark:bg-white/[0.12]" />

      <button
        type="button"
        onClick={onToggle}
        title={isActive ? labels.pause : labels.start}
        aria-label={isActive ? labels.pause : labels.start}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_4px_12px_-4px_rgba(14,165,233,0.7)] transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.92]",
          s.button,
          FOCUS_RING
        )}
      >
        {/* Filled glyphs; the play triangle nudged right so it sits optically centred. */}
        {isActive ? <Pause className={cn(s.glyph, "fill-current")} /> : <Play className={cn(s.glyph, "translate-x-px fill-current")} />}
      </button>

      <button type="button" onClick={onReset} title={labels.reset} aria-label={labels.reset} className={quietButton}>
        <RotateCcw className={s.icon} strokeWidth={2.25} />
      </button>

      {onHide && labels.hide && (
        <button type="button" onClick={onHide} title={labels.hide} aria-label={labels.hide} className={quietButton}>
          <EyeOff className={s.icon} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
});

/** The collapsed chrono (Topbar): the same pill, a timer glyph and "Chrono". */
export const PomodoroChip = forwardRef<HTMLButtonElement, { onShow: () => void; className?: string }>(function PomodoroChip({ onShow, className }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onShow}
      title="Afficher le chronomètre"
      aria-label="Afficher le chronomètre d'étude"
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-medium text-slate-600 transition-colors duration-150 hover:text-slate-900 dark:text-white/65 dark:hover:text-white",
        POMODORO_PILL_SURFACE,
        FOCUS_RING,
        className
      )}
    >
      <Timer className="h-4 w-4 text-sky-600 dark:text-sky-400" strokeWidth={2.25} />
      Chrono
    </button>
  );
});
