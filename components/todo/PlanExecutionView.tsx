"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, ClipboardCheck, Clock, PartyPopper, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import type { StudyPlanTask } from "@/types/study-planner";

interface PlanExecutionViewProps {
  planId: number;
  initialTasks: StudyPlanTask[];
  onReset: () => void;
}

const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Étape 4 — la to-do list réelle, cases à cocher optimistes, et le serment en bas de page. */
export function PlanExecutionView({ planId, initialTasks, onReset }: PlanExecutionViewProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const [tasks, setTasks] = useState<StudyPlanTask[]>(initialTasks);
  const today = todayIso();
  const todayRef = useRef<HTMLDivElement | null>(null);

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

  // A multi-week plan otherwise opens on day one every time — the student
  // has to scroll past everything already behind them just to reach the
  // tasks that actually matter today. Only worth it when there IS history to
  // skip: on a plan that just started, today already sits at the top.
  useEffect(() => {
    const todayIndex = groupedByDate.findIndex(([date]) => date === today);
    if (todayIndex > 0) {
      todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Run once on mount only — this is a "land me where it matters" nudge,
    // not something that should re-fire every time a checkbox is toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-foreground">{tTodo("executionTitle", language)}</h2>
          {tasks.length > 0 &&
            (progressPct === 100 ? (
              <motion.span
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400"
              >
                <PartyPopper className="h-4 w-4" />
                {tTodo("progress100", language)}
              </motion.span>
            ) : (
              <span className="shrink-0 text-sm font-semibold text-primary">{progressPct}%</span>
            ))}
        </div>
        <div className="mt-3">
          <Button type="button" variant="outline" size="lg" onClick={onReset} className="w-full sm:w-auto">
            <RotateCcw className="h-4 w-4" />
            {tTodo("backRestart", language)}
          </Button>
        </div>
        {tasks.length > 0 && (
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn(
                "h-full rounded-full shadow-glow",
                progressPct === 100 ? "bg-gradient-to-r from-emerald-500 to-primary" : "bg-gradient-to-r from-primary to-violet-500"
              )}
              initial={false}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{tTodo("emptyStateText", language)}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByDate.map(([date, dayTasks]) => {
            const isToday = date === today;
            const isPast = date < today;
            const isDayDone = dayTasks.every((t) => t.isCompleted);
            const isOverdue = isPast && !isDayDone;

            return (
              <div
                key={date}
                ref={isToday ? todayRef : undefined}
                className={cn(
                  "rounded-2xl border p-4 transition-all duration-300",
                  isToday
                    ? "border-primary/40 bg-primary/5 shadow-glow"
                    : isOverdue
                      ? "border-orange-300/50 bg-orange-50/40 hover:shadow-soft dark:border-orange-500/25 dark:bg-orange-950/10"
                      : "border-border bg-card hover:border-primary/20 hover:shadow-soft"
                )}
              >
                <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold capitalize text-foreground">
                  {DAY_FORMAT.format(new Date(`${date}T12:00:00`))}
                  {isToday && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">{tTodo("todayBadge", language)}</span>}
                  {isOverdue && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-orange-600 dark:text-orange-300">
                      <AlertTriangle className="h-2.5 w-2.5" />{tTodo("overdueBadge", language)}
                    </span>
                  )}
                  {isPast && !isOverdue && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                      <Check className="h-2.5 w-2.5" />{tTodo("doneBadge", language)}
                    </span>
                  )}
                </p>
                <ul className="space-y-1">
                  {dayTasks.map((task) => (
                    <li key={task.id} className="rounded-xl transition-colors hover:bg-accent/50">
                      <label
                        htmlFor={`task-${task.id}`}
                        className="flex w-full cursor-pointer items-center gap-3 px-2 py-2 sm:py-1"
                      >
                        <Checkbox checked={task.isCompleted} onCheckedChange={() => toggleTask(task)} id={`task-${task.id}`} />
                        <span
                          className={cn(
                            "flex-1 text-sm transition-colors",
                            task.isCompleted ? "text-muted-foreground line-through" : "text-foreground"
                          )}
                        >
                          {task.title}
                        </span>
                        {task.hours !== null && (
                          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {task.hours}h
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

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
  const { language } = useLanguage();
  return (
    <div className="rounded-2xl border border-orange-300/60 bg-orange-50/70 p-5 text-center dark:border-orange-500/30 dark:bg-orange-950/20">
      <AlertTriangle className="mx-auto h-6 w-6 text-orange-500" />
      <p className="mx-auto mt-3 max-w-xl text-base font-serif italic leading-relaxed text-orange-900 dark:text-orange-200">
        {tTodo("studyOathText", language)}
      </p>
    </div>
  );
}
