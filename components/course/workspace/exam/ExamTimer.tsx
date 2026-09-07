"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A real, honest client-side stopwatch — counts actual elapsed seconds since
 * this component mounted. Never persisted, never sent to the server, never
 * factored into scoring (scoreExamAttempt only ever reads `answers`). The
 * exam page mounts this with a `key` tied to the active exam id so it
 * restarts at 00:00 for each fresh "Épreuve Clinique" sitting rather than
 * carrying over a stale count from a previously viewed exam.
 */
export function ExamTimer({ className }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <span
      className={cn(
        "glass-panel inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tabular-nums text-foreground shadow-soft",
        className
      )}
    >
      <Timer className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
      {mm}:{ss}
    </span>
  );
}
