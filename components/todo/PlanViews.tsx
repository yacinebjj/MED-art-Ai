"use client";

/**
 * Alternate visual planners for the active study plan — Timeline, Kanban and
 * Grid (calendar). Pure views over the SAME `tasks` state PlanExecutionView
 * owns: the only action they expose is the existing completion toggle
 * (PATCH isCompleted), so no data flow changes. Code-split from the list view.
 */

import { memo, useMemo, useState, type DragEvent } from "react";
import { motion } from "framer-motion";
import { CalendarDays, Check, Clock, Flag, Inbox, Sparkles, Sun, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { NeonRing, ParticleBurst } from "@/components/cyber/primitives";
import { useBurst } from "@/components/cyber/hooks";
import { useLanguage } from "@/providers/LanguageProvider";
import type { StudyPlanTask } from "@/types/study-planner";

interface ViewProps {
  tasks: StudyPlanTask[];
  today: string;
  onToggle: (task: StudyPlanTask) => void;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function groupByDate(tasks: StudyPlanTask[]): [string, StudyPlanTask[]][] {
  const map = new Map<string, StudyPlanTask[]>();
  for (const task of tasks) {
    const list = map.get(task.dateScheduled) ?? [];
    list.push(task);
    map.set(task.dateScheduled, list);
  }
  const entries = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [, list] of entries) list.sort((a, b) => a.sortOrder - b.sortOrder);
  return entries;
}

/** Compact task line with a neon check that fires a micro-burst on completion. */
const TaskChip = memo(function TaskChip({ task, onToggle, draggable }: { task: StudyPlanTask; onToggle: (task: StudyPlanTask) => void; draggable?: boolean }) {
  const [burst, fire] = useBurst();
  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e: DragEvent<HTMLDivElement>) => {
              e.dataTransfer.setData("text/plain", String(task.id));
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      className={cn(
        "group flex items-start gap-2.5 rounded-xl border px-2.5 py-2 transition-colors",
        draggable && "cursor-grab active:cursor-grabbing",
        task.isCompleted ? "border-emerald-400/20 bg-emerald-400/[0.04]" : "border-white/[0.08] bg-slate-950/60 hover:border-cyan-400/30"
      )}
    >
      <button
        type="button"
        onClick={() => {
          if (!task.isCompleted) fire();
          onToggle(task);
        }}
        aria-pressed={task.isCompleted}
        aria-label={task.title}
        className={cn(
          "relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-[transform,border-color,background-color,box-shadow] active:scale-90",
          task.isCompleted ? "border-emerald-300 bg-emerald-400 text-slate-950 shadow-[0_0_12px_rgba(52,211,153,0.6)]" : "border-white/25 hover:border-cyan-300"
        )}
      >
        {task.isCompleted && <Check className="h-3.5 w-3.5" />}
        <ParticleBurst nonce={burst} color="rgb(52 211 153)" count={8} spread={22} />
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px] leading-snug", task.isCompleted ? "text-slate-500 line-through" : "text-slate-100")}>{task.title}</span>
        {task.hours !== null && (
          <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-slate-500">
            <Clock className="h-2.5 w-2.5" />
            {task.hours}h
          </span>
        )}
      </span>
    </div>
  );
});

// ── Timeline ────────────────────────────────────────────────────────────

export function TimelineView({ tasks, today, onToggle }: ViewProps) {
  const { language } = useLanguage();
  const fr = language === "fr";
  const days = useMemo(() => groupByDate(tasks), [tasks]);
  const formatter = useMemo(() => new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long" }), [fr]);

  return (
    <ol className="relative space-y-4 pl-8">
      <span aria-hidden className="absolute bottom-2 left-[11px] top-2 w-px bg-gradient-to-b from-cyan-400/60 via-violet-500/40 to-transparent" />
      {days.map(([date, dayTasks]) => {
        const done = dayTasks.filter((t) => t.isCompleted).length;
        const allDone = done === dayTasks.length;
        const isToday = date === today;
        const isPast = date < today;
        const hours = dayTasks.reduce((sum, t) => sum + (t.hours ?? 0), 0);
        return (
          <li key={date} className="relative">
            <span
              aria-hidden
              className={cn(
                "absolute -left-8 top-3 flex h-6 w-6 items-center justify-center rounded-full border-2",
                allDone
                  ? "border-emerald-300 bg-emerald-400 text-slate-950 shadow-[0_0_14px_rgba(52,211,153,0.6)]"
                  : isToday
                    ? "border-cyan-300 bg-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.7)]"
                    : isPast
                      ? "border-orange-400 bg-slate-950"
                      : "border-white/20 bg-slate-950"
              )}
            >
              {allDone ? <Check className="h-3.5 w-3.5" /> : isToday ? <span className="h-2 w-2 animate-ping rounded-full bg-cyan-300" /> : null}
            </span>
            <div className={cn("rounded-2xl border p-3.5 [contain-intrinsic-size:auto_160px] [content-visibility:auto]", isToday ? "border-cyan-400/40 bg-cyan-400/[0.05]" : "border-white/[0.07] bg-white/[0.02]")}>
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-black capitalize", isToday ? "text-cyan-100" : "text-white")}>
                    {formatter.format(new Date(`${date}T12:00:00`))}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {isToday ? (fr ? "Aujourd'hui · " : "Today · ") : isPast && !allDone ? (fr ? "En retard · " : "Overdue · ") : ""}
                    {dayTasks.length} {fr ? "tâche" : "task"}
                    {dayTasks.length > 1 ? "s" : ""}
                    {hours > 0 ? ` · ${hours}h` : ""}
                  </p>
                </div>
                <NeonRing value={done / dayTasks.length} size={40} stroke={4} glow={false} from={allDone ? "#34d399" : "#22d3ee"} to={allDone ? "#22d3ee" : "#8b5cf6"}>
                  <span className="text-[9px] font-black tabular-nums text-white">
                    {done}/{dayTasks.length}
                  </span>
                </NeonRing>
              </div>
              <div className="space-y-1.5">
                {dayTasks.map((task) => (
                  <TaskChip key={task.id} task={task} onToggle={onToggle} />
                ))}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Kanban ──────────────────────────────────────────────────────────────

type ColumnId = "overdue" | "today" | "week" | "later" | "done";

const COLUMN_STYLE: Record<ColumnId, { icon: typeof Sun; accent: string; dot: string }> = {
  overdue: { icon: Flag, accent: "border-orange-400/40 text-orange-200", dot: "bg-orange-400" },
  today: { icon: Sun, accent: "border-cyan-400/50 text-cyan-100", dot: "bg-cyan-300" },
  week: { icon: CalendarDays, accent: "border-violet-400/40 text-violet-200", dot: "bg-violet-400" },
  later: { icon: Inbox, accent: "border-white/15 text-slate-300", dot: "bg-slate-400" },
  done: { icon: Trophy, accent: "border-emerald-400/40 text-emerald-200", dot: "bg-emerald-400" },
};

export function KanbanView({ tasks, today, onToggle }: ViewProps) {
  const { language } = useLanguage();
  const fr = language === "fr";
  const [dragOver, setDragOver] = useState<ColumnId | null>(null);
  const weekEnd = addDaysIso(today, 6);

  const columns = useMemo(() => {
    const buckets: Record<ColumnId, StudyPlanTask[]> = { overdue: [], today: [], week: [], later: [], done: [] };
    for (const task of tasks) {
      if (task.isCompleted) buckets.done.push(task);
      else if (task.dateScheduled < today) buckets.overdue.push(task);
      else if (task.dateScheduled === today) buckets.today.push(task);
      else if (task.dateScheduled <= weekEnd) buckets.week.push(task);
      else buckets.later.push(task);
    }
    for (const list of Object.values(buckets)) list.sort((a, b) => a.dateScheduled.localeCompare(b.dateScheduled) || a.sortOrder - b.sortOrder);
    return buckets;
  }, [tasks, today, weekEnd]);

  const labels: Record<ColumnId, string> = fr
    ? { overdue: "En retard", today: "Aujourd'hui", week: "Cette semaine", later: "À venir", done: "Terminé" }
    : { overdue: "Overdue", today: "Today", week: "This week", later: "Upcoming", done: "Done" };

  function handleDrop(column: ColumnId, e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(null);
    const id = Number(e.dataTransfer.getData("text/plain"));
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    // Only completion can change here: into "Terminé" completes, out of it re-opens (dates stay as planned).
    if (column === "done" && !task.isCompleted) onToggle(task);
    else if (column !== "done" && task.isCompleted) onToggle(task);
  }

  const order: ColumnId[] = ["overdue", "today", "week", "later", "done"];

  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Sparkles className="h-3 w-3 text-cyan-300" />
        {fr ? "Glisse une carte dans « Terminé » pour la valider (ordinateur), ou coche-la." : "Drag a card into “Done” to complete it (desktop), or tick it."}
      </p>
      <div className="cyber-scrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
        {order
          .filter((id) => id !== "overdue" || columns.overdue.length > 0)
          .map((id) => {
            const style = COLUMN_STYLE[id];
            const Icon = style.icon;
            return (
              <div
                key={id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(id);
                }}
                onDragLeave={() => setDragOver((current) => (current === id ? null : current))}
                onDrop={(e) => handleDrop(id, e)}
                className={cn(
                  "flex max-h-[70vh] w-[78vw] shrink-0 snap-start flex-col rounded-2xl border bg-white/[0.02] transition-[border-color,box-shadow,background-color] sm:w-64",
                  dragOver === id ? "border-cyan-300/70 bg-cyan-400/[0.06] shadow-[0_0_30px_-8px_rgba(34,211,238,0.6)]" : "border-white/[0.07]"
                )}
              >
                <div className={cn("flex items-center justify-between gap-2 border-b px-3 py-2.5", style.accent)}>
                  <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider">
                    <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
                    <Icon className="h-3.5 w-3.5" />
                    {labels[id]}
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-white">{columns[id].length}</span>
                </div>
                <div className="cyber-scrollbar min-h-24 flex-1 space-y-1.5 overflow-y-auto p-2">
                  {columns[id].length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-slate-600">—</p>
                  ) : (
                    columns[id].map((task) => (
                      <motion.div key={task.id} layout transition={{ duration: 0.2 }}>
                        <TaskChip task={task} onToggle={onToggle} draggable />
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── Grid (calendar) ─────────────────────────────────────────────────────

export function GridView({ tasks, today, onToggle }: ViewProps) {
  const { language } = useLanguage();
  const fr = language === "fr";
  const byDate = useMemo(() => new Map(groupByDate(tasks)), [tasks]);
  const [selected, setSelected] = useState<string | null>(null);

  const weeks = useMemo(() => {
    const dates = Array.from(byDate.keys());
    if (dates.length === 0) return [] as string[][];
    const first = dates[0];
    const last = dates[dates.length - 1];
    // Start on the Monday on/before the first date.
    const firstDay = new Date(`${first}T12:00:00`).getDay();
    let cursor = addDaysIso(first, -((firstDay + 6) % 7));
    const rows: string[][] = [];
    while (cursor <= last && rows.length < 26) {
      const row: string[] = [];
      for (let i = 0; i < 7; i++) {
        row.push(cursor);
        cursor = addDaysIso(cursor, 1);
      }
      rows.push(row);
    }
    return rows;
  }, [byDate]);

  const activeDate = selected ?? (byDate.has(today) ? today : (Array.from(byDate.keys()).find((d) => d >= today) ?? Array.from(byDate.keys())[0] ?? null));
  const activeTasks = activeDate ? (byDate.get(activeDate) ?? []) : [];
  const weekdayLabels = fr ? ["L", "M", "M", "J", "V", "S", "D"] : ["M", "T", "W", "T", "F", "S", "S"];
  const longFormatter = new Intl.DateTimeFormat(fr ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-black uppercase tracking-wider text-slate-500">
        {weekdayLabels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
      <div className="space-y-1.5">
        {weeks.map((row) => (
          <div key={row[0]} className="grid grid-cols-7 gap-1.5">
            {row.map((date) => {
              const dayTasks = byDate.get(date);
              const total = dayTasks?.length ?? 0;
              const done = dayTasks?.filter((t) => t.isCompleted).length ?? 0;
              const ratio = total > 0 ? done / total : 0;
              const isToday = date === today;
              const isActive = date === activeDate;
              return (
                <button
                  key={date}
                  type="button"
                  disabled={total === 0}
                  onClick={() => setSelected(date)}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-xl border text-xs transition-[border-color,box-shadow] disabled:cursor-default",
                    total === 0 ? "border-transparent text-slate-700" : "border-white/[0.08] text-white hover:border-cyan-400/40",
                    isActive && "border-cyan-300/80 shadow-[0_0_18px_-4px_rgba(34,211,238,0.7)]",
                    isToday && !isActive && "border-cyan-400/40"
                  )}
                  style={
                    total > 0
                      ? { backgroundColor: ratio >= 1 ? "rgb(16 185 129 / 0.22)" : `rgb(34 211 238 / ${0.05 + ratio * 0.18})` }
                      : undefined
                  }
                  aria-label={`${date} — ${done}/${total}`}
                >
                  <span className={cn("font-black tabular-nums", isToday && "text-cyan-200")}>{Number(date.slice(8, 10))}</span>
                  {total > 0 && <span className="text-[9px] font-bold tabular-nums text-slate-400">{done}/{total}</span>}
                  {total > 0 && (
                    <span className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-white/10">
                      <span className={cn("block h-full rounded-full", ratio >= 1 ? "bg-emerald-300" : "bg-cyan-300")} style={{ width: `${ratio * 100}%` }} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {activeDate && (
        <motion.div key={activeDate} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5">
          <p className="mb-2.5 text-sm font-black capitalize text-white">{longFormatter.format(new Date(`${activeDate}T12:00:00`))}</p>
          <div className="space-y-1.5">
            {activeTasks.map((task) => (
              <TaskChip key={task.id} task={task} onToggle={onToggle} />
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}
