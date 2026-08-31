"use client";

import { Play, Pause, RotateCcw, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePomodoro } from "@/providers/PomodoroProvider";

/**
 * The full-width "Chrono d'étude" banner shown under the topbar on the demo
 * workspace and the Module Summary Workspace — was duplicated verbatim in
 * both page files. Isolated in its own component (like Topbar.tsx's
 * PomodoroWidget) so the ticking `seconds` context value, which changes
 * every second while the timer is active, only re-renders this small banner
 * instead of the whole workspace page around it.
 */
export function PomodoroStudyBanner() {
  const { seconds, isActive, toggleActive, resetTimer } = usePomodoro();
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/80 px-6 py-2.5 shadow-soft backdrop-blur-sm">
      <div className="flex items-center gap-2">
        {/* Pulses only while running — a banner that's always "ticking" even
            when paused reads as ambient pressure, which contradicts what a
            study-wellbeing timer is for. Calm and static when idle/paused. */}
        <Timer className={cn("h-4 w-4 text-primary-500", isActive && "animate-pulse")} />
        <span className="text-xs font-bold text-muted-foreground">Chrono d'étude :</span>
        <span className="font-mono text-sm font-black text-primary-600 dark:text-primary-300">
          {String(minutes).padStart(2, "0")}:{String(remainingSeconds).padStart(2, "0")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleActive}
          aria-label={isActive ? "Mettre en pause le chrono d'étude" : "Démarrer le chrono d'étude"}
          className={cn(
            "flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold text-white transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
          )}
        >
          {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isActive ? "Pause" : "Démarrer"}
        </button>
        <button
          type="button"
          onClick={resetTimer}
          aria-label="Réinitialiser le chrono d'étude"
          className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-muted-foreground transition-all duration-200 hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <RotateCcw className="h-3 w-3" />
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
