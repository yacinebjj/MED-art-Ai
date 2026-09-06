"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, Reorder, useReducedMotion } from "framer-motion";
import { AlertTriangle, ChevronDown, ClipboardCheck, Coffee, PartyPopper, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import { ProgressRing } from "./ProgressRing";
import { TaskRow } from "./TaskRow";
import type { StudyPlanTask } from "@/types/study-planner";

interface PlanExecutionViewProps {
  planId: number;
  initialTasks: StudyPlanTask[];
  onReset: () => void;
}

const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const UNDO_WINDOW_MS = 4500;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sortByOrder(a: StudyPlanTask, b: StudyPlanTask): number {
  return a.sortOrder - b.sortOrder;
}

/** Étape 4 — la to-do list réelle : hero "Aujourd'hui" + accordéons En retard/Cette semaine/À venir/Terminé, cases à cocher optimistes, et le serment en bas de page. */
export function PlanExecutionView({ planId, initialTasks, onReset }: PlanExecutionViewProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const reduceMotion = useReducedMotion();
  const [tasks, setTasks] = useState<StudyPlanTask[]>(initialTasks);
  const [suggestions, setSuggestions] = useState<Record<number, string[]>>({});
  const [suggestingIds, setSuggestingIds] = useState<Set<number>>(new Set());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    overdue: true,
    thisWeek: true,
    upcoming: false,
    done: false,
  });
  const [todayBurstNonce, setTodayBurstNonce] = useState(0);
  const [planBurstNonce, setPlanBurstNonce] = useState(0);

  const today = todayIso();
  const weekEnd = addDaysIso(today, 6);

  const completedCount = tasks.filter((t) => t.isCompleted).length;
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const buckets = useMemo(() => {
    const todayTasks: StudyPlanTask[] = [];
    const overdueTasks: StudyPlanTask[] = [];
    const thisWeekMap = new Map<string, StudyPlanTask[]>();
    const upcomingMap = new Map<string, StudyPlanTask[]>();
    const doneTasks: StudyPlanTask[] = [];

    for (const task of tasks) {
      if (task.dateScheduled === today) {
        todayTasks.push(task);
      } else if (task.dateScheduled < today) {
        (task.isCompleted ? doneTasks : overdueTasks).push(task);
      } else if (task.dateScheduled <= weekEnd) {
        const list = thisWeekMap.get(task.dateScheduled) ?? [];
        list.push(task);
        thisWeekMap.set(task.dateScheduled, list);
      } else {
        const list = upcomingMap.get(task.dateScheduled) ?? [];
        list.push(task);
        upcomingMap.set(task.dateScheduled, list);
      }
    }

    todayTasks.sort(sortByOrder);
    overdueTasks.sort((a, b) => a.dateScheduled.localeCompare(b.dateScheduled) || sortByOrder(a, b));
    doneTasks.sort((a, b) => b.dateScheduled.localeCompare(a.dateScheduled) || sortByOrder(a, b));
    const thisWeekByDate = Array.from(thisWeekMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const upcomingByDate = Array.from(upcomingMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [, list] of thisWeekByDate) list.sort(sortByOrder);
    for (const [, list] of upcomingByDate) list.sort(sortByOrder);

    return { todayTasks, overdueTasks, thisWeekByDate, upcomingByDate, doneTasks };
  }, [tasks, today, weekEnd]);

  const todayTotal = buckets.todayTasks.length;
  const todayCompleted = buckets.todayTasks.filter((t) => t.isCompleted).length;
  const thisWeekTasks = useMemo(() => buckets.thisWeekByDate.flatMap(([, list]) => list), [buckets.thisWeekByDate]);
  const upcomingTasks = useMemo(() => buckets.upcomingByDate.flatMap(([, list]) => list), [buckets.upcomingByDate]);

  // Fires the "journée terminée" burst exactly on the render where today's
  // count crosses from less-than-total to exactly-total — never on mount,
  // never on an unrelated re-render while already at 100%.
  const prevTodayCompletedRef = useRef(todayCompleted);
  useEffect(() => {
    const prev = prevTodayCompletedRef.current;
    if (todayTotal > 0 && prev < todayTotal && todayCompleted === todayTotal) {
      setTodayBurstNonce((n) => n + 1);
    }
    prevTodayCompletedRef.current = todayCompleted;
  }, [todayCompleted, todayTotal]);

  const prevProgressPctRef = useRef(progressPct);
  useEffect(() => {
    const prev = prevProgressPctRef.current;
    if (tasks.length > 0 && prev < 100 && progressPct === 100) {
      setPlanBurstNonce((n) => n + 1);
    }
    prevProgressPctRef.current = progressPct;
  }, [progressPct, tasks.length]);

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

  async function handleReorder(newOrderIds: number[]) {
    const previousTasks = tasks;
    const nextSortOrders = new Map(newOrderIds.map((id, index) => [id, index]));

    setTasks((prev) => prev.map((t) => (nextSortOrders.has(t.id) ? { ...t, sortOrder: nextSortOrders.get(t.id)! } : t)));

    const changed = newOrderIds
      .map((id, index) => ({ id, index }))
      .filter(({ id, index }) => previousTasks.find((t) => t.id === id)?.sortOrder !== index);
    if (changed.length === 0) return;

    try {
      const results = await Promise.all(
        changed.map(({ id, index }) =>
          fetch(`/api/study-planner/plans/${planId}/tasks/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortOrder: index }),
          }).then((res) => res.json())
        )
      );
      if (results.some((r) => !r.success)) throw new Error("reorder failed");
    } catch {
      setTasks(previousTasks);
      toast({ variant: "error", title: tTodo("reorderFailedToast", language) });
    }
  }

  /** Optimistic removal with an undo window — the real DELETE only fires after UNDO_WINDOW_MS if the student hasn't clicked "Annuler". */
  function deleteTaskWithUndo(task: StudyPlanTask) {
    const previousTasks = tasks;
    let undone = false;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));

    toast({
      variant: "info",
      title: tTodo("taskDeletedToast", language),
      action: {
        label: tTodo("undoAction", language),
        onClick: () => {
          undone = true;
          setTasks(previousTasks);
        },
      },
    });

    void (async () => {
      await delay(UNDO_WINDOW_MS);
      if (undone) return;
      try {
        const res = await fetch(`/api/study-planner/plans/${planId}/tasks/${task.id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error ?? "failed");
      } catch {
        if (!undone) {
          setTasks(previousTasks);
          toast({ variant: "error", title: tTodo("taskDeleteFailedToast", language) });
        }
      }
    })();
  }

  async function requestSuggestions(task: StudyPlanTask) {
    setSuggestingIds((prev) => new Set(prev).add(task.id));
    try {
      const res = await fetch(`/api/study-planner/plans/${planId}/tasks/${task.id}/suggest-subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: task.title, moduleId: task.moduleId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? tTodo("aiSuggestErrorToast", language));
      setSuggestions((prev) => ({ ...prev, [task.id]: data.suggestions }));
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : tTodo("aiSuggestErrorToast", language) });
    } finally {
      setSuggestingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  function dismissSuggestions(taskId: number) {
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function rowProps(task: StudyPlanTask, extra: { showAiButton?: boolean } = {}) {
    return {
      task,
      onToggle: toggleTask,
      onDelete: deleteTaskWithUndo,
      onSuggest: requestSuggestions,
      isSuggesting: suggestingIds.has(task.id),
      suggestions: suggestions[task.id] ?? null,
      onDismissSuggestions: dismissSuggestions,
      showAiButton: extra.showAiButton ?? false,
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-foreground">{tTodo("executionTitle", language)}</h2>
          {tasks.length > 0 && (
            <div className="relative shrink-0">
              {progressPct === 100 ? (
                <motion.span
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center gap-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400"
                >
                  <PartyPopper className="h-4 w-4" />
                  {tTodo("progress100", language)}
                </motion.span>
              ) : (
                <span className="text-sm font-semibold text-primary">{progressPct}%</span>
              )}
              {planBurstNonce > 0 && !reduceMotion && (
                <CelebrationBurst key={planBurstNonce} count={22} spread={70} duration={1.3} />
              )}
            </div>
          )}
        </div>
        <div className="mt-3">
          <Button type="button" variant="outline" size="lg" onClick={onReset} className="w-full sm:w-auto">
            <RotateCcw className="h-4 w-4" />
            {tTodo("backRestart", language)}
          </Button>
        </div>
        {/* Ambient hairline — the hero ring now owns the "what should I look at" job, this is just quiet whole-plan context. */}
        {tasks.length > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn("h-full rounded-full", progressPct === 100 ? "bg-gradient-to-r from-emerald-500 to-primary" : "bg-gradient-to-r from-primary to-violet-500")}
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
          {/* HERO — Aujourd'hui, toujours visible en premier */}
          <div className="glass-card relative overflow-hidden rounded-3xl border border-primary/30 p-4 shadow-glow sm:p-6">
            {todayTotal === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Coffee className="h-8 w-8 text-primary/70" />
                <p className="text-sm font-bold text-foreground">{tTodo("restDayTitle", language)}</p>
                <p className="max-w-sm text-xs text-muted-foreground">{tTodo("restDayBody", language)}</p>
              </div>
            ) : (
              <>
                <div className="relative flex items-center gap-4">
                  <ProgressRing
                    completed={todayCompleted}
                    total={todayTotal}
                    size={84}
                    strokeWidth={7}
                    label={
                      <span className="text-sm font-bold text-foreground">
                        {todayCompleted}/{todayTotal}
                      </span>
                    }
                  />
                  {todayBurstNonce > 0 && !reduceMotion && (
                    <CelebrationBurst key={todayBurstNonce} count={14} spread={44} duration={0.8} />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">{tTodo("todayBadge", language)}</p>
                    <p className="truncate text-sm capitalize text-muted-foreground">{DAY_FORMAT.format(new Date(`${today}T12:00:00`))}</p>
                  </div>
                </div>
                <Reorder.Group as="div" axis="y" values={buckets.todayTasks.map((t) => t.id)} onReorder={handleReorder} className="mt-4 space-y-2">
                  {buckets.todayTasks.map((task) => (
                    <TaskRow key={task.id} variant="hero" reorderable {...rowProps(task, { showAiButton: true })} />
                  ))}
                </Reorder.Group>
              </>
            )}
          </div>

          {/* EN RETARD — omise entièrement quand vide */}
          {buckets.overdueTasks.length > 0 && (
            <SectionAccordion
              title={tTodo("overdueSection", language)}
              subtitle={tTodo("overdueSectionSubtitle", language)}
              count={buckets.overdueTasks.length}
              accentClassName="text-orange-600 dark:text-orange-400"
              isOpen={openSections.overdue}
              onToggle={() => toggleSection("overdue")}
            >
              <ul className="space-y-2">
                {buckets.overdueTasks.map((task) => (
                  <li key={task.id} className="border-l-2 border-orange-400/70 pl-2">
                    <TaskRow reorderable={false} {...rowProps(task)} />
                  </li>
                ))}
              </ul>
            </SectionAccordion>
          )}

          {/* CETTE SEMAINE */}
          <SectionAccordion
            title={tTodo("thisWeekSection", language)}
            count={thisWeekTasks.length}
            ring={<ProgressRing completed={thisWeekTasks.filter((t) => t.isCompleted).length} total={thisWeekTasks.length} size={26} strokeWidth={3} showLabel={false} />}
            isOpen={openSections.thisWeek}
            onToggle={() => toggleSection("thisWeek")}
          >
            <div className="space-y-3">
              {buckets.thisWeekByDate.map(([date, dayTasks]) => (
                <div key={date}>
                  <p className="mb-1.5 px-1 text-xs font-semibold capitalize text-muted-foreground">{DAY_FORMAT.format(new Date(`${date}T12:00:00`))}</p>
                  <Reorder.Group as="div" axis="y" values={dayTasks.map((t) => t.id)} onReorder={handleReorder} className="space-y-2">
                    {dayTasks.map((task) => (
                      <TaskRow key={task.id} reorderable {...rowProps(task, { showAiButton: true })} />
                    ))}
                  </Reorder.Group>
                </div>
              ))}
            </div>
          </SectionAccordion>

          {/* À VENIR */}
          {buckets.upcomingByDate.length > 0 && (
            <SectionAccordion
              title={tTodo("upcomingSection", language)}
              count={upcomingTasks.length}
              ring={<ProgressRing completed={upcomingTasks.filter((t) => t.isCompleted).length} total={upcomingTasks.length} size={26} strokeWidth={3} showLabel={false} />}
              isOpen={openSections.upcoming}
              onToggle={() => toggleSection("upcoming")}
            >
              <div className="space-y-3">
                {buckets.upcomingByDate.map(([date, dayTasks]) => (
                  <div key={date}>
                    <p className="mb-1.5 px-1 text-xs font-semibold capitalize text-muted-foreground">{DAY_FORMAT.format(new Date(`${date}T12:00:00`))}</p>
                    <Reorder.Group as="div" axis="y" values={dayTasks.map((t) => t.id)} onReorder={handleReorder} className="space-y-2">
                      {dayTasks.map((task) => (
                        <TaskRow key={task.id} reorderable {...rowProps(task)} />
                      ))}
                    </Reorder.Group>
                  </div>
                ))}
              </div>
            </SectionAccordion>
          )}

          {/* TERMINÉ — archive, toujours repliée par défaut */}
          {buckets.doneTasks.length > 0 && (
            <SectionAccordion
              title={tTodo("doneSection", language)}
              count={buckets.doneTasks.length}
              accentClassName="text-emerald-600 dark:text-emerald-400"
              isOpen={openSections.done}
              onToggle={() => toggleSection("done")}
            >
              <ul className="space-y-1.5">
                {buckets.doneTasks.map((task) => (
                  <li key={task.id}>
                    <TaskRow reorderable={false} {...rowProps(task)} />
                  </li>
                ))}
              </ul>
            </SectionAccordion>
          )}
        </div>
      )}

      <StudyOathBanner />
    </div>
  );
}

interface SectionAccordionProps {
  title: string;
  subtitle?: string;
  count: number;
  ring?: React.ReactNode;
  accentClassName?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** Plain CSS grid-template-rows 0fr<->1fr expand/collapse — same approach this app's Tabs.tsx already prefers over a fragile shared layoutId animation. */
function SectionAccordion({ title, subtitle, count, ring, accentClassName, isOpen, onToggle, children }: SectionAccordionProps) {
  return (
    <div className="glass-card overflow-hidden rounded-2xl border border-border shadow-glass dark:shadow-glass-dark">
      <button type="button" onClick={onToggle} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <span className={cn("flex items-center gap-2 text-sm font-bold text-foreground", accentClassName)}>
          {title}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{count}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {ring}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", isOpen && "rotate-180")} />
        </span>
      </button>
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          {subtitle && <p className="px-4 pb-1.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>}
          <div className="px-3 pb-3 pt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Contained particle burst (never full-screen) — pure CSS/framer-motion, no canvas-confetti dependency. Index-seeded angles for an even circular burst instead of random placement. */
function CelebrationBurst({ count, spread, duration }: { count: number; spread: number; duration: number }) {
  const particles = useMemoParticles(count, spread);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-visible" aria-hidden>
      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{ opacity: 1, scale: 0.6, x: 0, y: 0 }}
          animate={{ opacity: 0, scale: 1, x: p.x, y: p.y }}
          transition={{ duration, ease: "easeOut" }}
          className="absolute text-lg"
        >
          {p.emoji}
        </motion.span>
      ))}
    </div>
  );
}

const BURST_EMOJI = ["✨", "🎉", "💪"];

function useMemoParticles(count: number, spread: number) {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const distance = spread + (i % 3) * (spread / 3);
        return { id: i, emoji: BURST_EMOJI[i % BURST_EMOJI.length], x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
      }),
    [count, spread]
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
