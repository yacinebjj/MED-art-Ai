"use client";

import { useEffect, useState } from "react";
import { Hourglass, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExamTimerMode = "chrono" | "countdown";

/** Exam-condition pace used by the countdown: 90 s per question. */
export const SECONDS_PER_QUESTION = 90;

function format(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/**
 * Client-side exam clock — never persisted, never sent to the server, never
 * factored into scoring (scoreExamAttempt only reads `answers`). The page
 * mounts it with a `key` tied to the active exam so each sitting restarts.
 *  - "chrono": elapsed time since the sitting started;
 *  - "countdown": exam conditions (90 s per question), turns red in the last
 *    5 minutes and shows "Temps écoulé" at zero — it never locks answers.
 */
export function ExamTimer({ className, mode = "chrono", questionCount = 0 }: { className?: string; mode?: ExamTimerMode; questionCount?: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const total = questionCount * SECONDS_PER_QUESTION;
  const isCountdown = mode === "countdown" && total > 0;
  const remaining = total - elapsed;
  const urgent = isCountdown && remaining <= 5 * 60;
  const over = isCountdown && remaining <= 0;
  const Icon = isCountdown ? Hourglass : Timer;

  return (
    <span
      role="timer"
      aria-label={isCountdown ? `Temps restant ${format(remaining)}` : `Temps écoulé ${format(elapsed)}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold tabular-nums transition-colors",
        over
          ? "border-rose-400/60 bg-rose-500/15 text-rose-500"
          : urgent
            ? "border-amber-400/60 bg-amber-500/15 text-amber-600 dark:text-amber-300"
            : "border-white/10 bg-white/[0.04] text-foreground",
        className
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", over ? "text-rose-500" : urgent ? "text-amber-500" : "text-cyan-500")} />
      {over ? "Temps écoulé" : isCountdown ? format(remaining) : format(elapsed)}
    </span>
  );
}
