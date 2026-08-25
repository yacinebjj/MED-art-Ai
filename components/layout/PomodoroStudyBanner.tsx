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
    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-2.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-emerald-500 animate-pulse" />
        <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Chrono d'étude :</span>
        <span className="font-mono text-sm font-black text-emerald-600 dark:text-emerald-400">
          {String(minutes).padStart(2, "0")}:{String(remainingSeconds).padStart(2, "0")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleActive}
          className={cn(
            "flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold text-white transition-all",
            isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
          )}
        >
          {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isActive ? "Pause" : "Démarrer"}
        </button>
        <button
          type="button"
          onClick={resetTimer}
          className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-200 dark:bg-neutral-800 dark:text-gray-300 dark:hover:bg-neutral-700"
        >
          <RotateCcw className="h-3 w-3" />
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
