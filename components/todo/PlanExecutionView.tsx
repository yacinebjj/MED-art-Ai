"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";
import type { StudyPlanTask } from "@/types/study-planner";

interface PlanExecutionViewProps {
  planId: number;
  initialTasks: StudyPlanTask[];
}

const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Étape 4 — la to-do list réelle, cases à cocher optimistes, et le serment en bas de page. */
export function PlanExecutionView({ planId, initialTasks }: PlanExecutionViewProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<StudyPlanTask[]>(initialTasks);
  const today = todayIso();

  const groupedByDate = useMemo(() => {
    const map = new Map<string, StudyPlanTask[]>();
    for (const task of tasks) {
      const list = map.get(task.dateScheduled) ?? [];
      list.push(task);
      map.set(task.dateScheduled, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  const completedCount = tasks.filter((t) => t.isCompleted).length;
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  async function toggleTask(task: StudyPlanTask) {
    const nextCompleted = !task.isCompleted;
    // Optimistic UI — flips instantly, reverts only if the server write fails.
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, isCompleted: nextCompleted } : t)));

    try {
      const res = await fetch(`/api/study-planner/plans/${planId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: nextCompleted }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La mise à jour a échoué.");
    } catch (err) {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, isCompleted: task.isCompleted } : t)));
      toast({ variant: "error", title: err instanceof Error ? err.message : "La mise à jour a échoué." });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Ton planning en cours</h2>
          <span className="text-sm font-semibold text-primary">{progressPct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="space-y-4">
        {groupedByDate.map(([date, dayTasks]) => (
          <div
            key={date}
            className={cn(
              "rounded-2xl border p-4",
              date === today ? "border-primary/40 bg-primary/5" : "border-border bg-card"
            )}
          >
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold capitalize text-foreground">
              {DAY_FORMAT.format(new Date(`${date}T12:00:00`))}
              {date === today && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">Aujourd'hui</span>}
            </p>
            <ul className="space-y-2">
              {dayTasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3">
                  <Checkbox checked={task.isCompleted} onCheckedChange={() => toggleTask(task)} id={`task-${task.id}`} />
                  <label
                    htmlFor={`task-${task.id}`}
                    className={cn(
                      "flex-1 cursor-pointer text-sm transition-colors",
                      task.isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                    )}
                  >
                    {task.title}
                  </label>
                  {task.hours !== null && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {task.hours}h
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <StudyOathBanner />
    </div>
  );
}

/**
 * The "guilt-trip" — a deliberately grave, sacred-oath-like reminder, not a
 * casual note. Visually set apart (soft red/orange border + tint, warning
 * icon) so it reads as weight-bearing, not decorative.
 */
function StudyOathBanner() {
  return (
    <div className="rounded-2xl border border-orange-300/60 bg-orange-50/70 p-5 text-center dark:border-orange-500/30 dark:bg-orange-950/20">
      <AlertTriangle className="mx-auto h-6 w-6 text-orange-500" />
      <p className="mx-auto mt-3 max-w-xl text-base font-serif italic leading-relaxed text-orange-900 dark:text-orange-200">
        « Ne te mens pas à toi-même en cochant une case sans avoir réellement maîtrisé le cours. N'oublie jamais : demain, la vie de tes patients sera entre tes mains. »
      </p>
    </div>
  );
}
