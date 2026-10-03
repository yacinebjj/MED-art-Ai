"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarClock, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { daysUntil } from "@/lib/dashboard/metrics";
import { readCustomExam, writeCustomExam, type CustomExam } from "@/lib/dashboard/local-activity";
import { localDayKey } from "@/providers/PomodoroProvider";
import { tCockpit } from "@/lib/translations/cockpit";
import { OsCard, WidgetSkeleton, useNow } from "./primitives";

/**
 * Next exam: the nearest exam date of the student's own study plans
 * (study_plans.exam_date, To-Do page) — or, when they have none, a date they
 * set right here (kept on this device). The bar shows how much of the
 * revision window, from when the countdown started to the exam, is used up.
 */
export function ExamCountdownWidget({ userId }: { userId: string | null }) {
  const { language } = useLanguage();
  const overview = useCockpitStore((state) => state.overview);
  const now = useNow();
  const [custom, setCustom] = useState<CustomExam | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDate, setDraftDate] = useState("");

  useEffect(() => {
    setCustom(userId ? readCustomExam(userId) : null);
  }, [userId]);

  if (!now || custom === undefined || !overview) return <WidgetSkeleton />;

  const fromPlan = overview.nextExam;
  const exam = fromPlan
    ? { label: tCockpit("examFromPlan", language), date: fromPlan.examDate, start: fromPlan.planCreatedAt, source: "plan" as const }
    : custom && daysUntil(custom.date, now) >= 0
      ? { label: custom.label, date: custom.date, start: custom.setAt, source: "custom" as const }
      : null;

  function startEdit() {
    setDraftLabel(custom?.label ?? "");
    setDraftDate(custom?.date ?? "");
    setEditing(true);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(draftDate) || !now || daysUntil(draftDate, now) < 0) return;
    const next: CustomExam = {
      label: draftLabel.trim().slice(0, 60) || tCockpit("examDefaultLabel", language),
      date: draftDate,
      setAt: custom?.date === draftDate ? custom.setAt : new Date().toISOString(),
    };
    writeCustomExam(userId, next);
    setCustom(next);
    setEditing(false);
  }

  function clear() {
    if (!userId) return;
    writeCustomExam(userId, null);
    setCustom(null);
    setEditing(false);
  }

  const days = exam ? daysUntil(exam.date, now) : null;
  let elapsedPct = 0;
  if (exam) {
    const start = new Date(exam.start).getTime();
    const [y, m, d] = exam.date.split("-").map(Number);
    const end = new Date(y, m - 1, d).getTime();
    elapsedPct = end > start ? Math.min(100, Math.max(0, Math.round(((now.getTime() - start) / (end - start)) * 100))) : 100;
  }
  const urgent = days !== null && days <= 7;

  return (
    <OsCard
      icon={CalendarClock}
      iconClassName="from-rose-500 to-pink-500"
      title={tCockpit("examTitle", language)}
      glow="hover:shadow-rose-500/15"
      action={
        !fromPlan && !editing ? (
          <button type="button" onClick={startEdit} aria-label={tCockpit("examEdit", language)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : null
      }
    >
      {editing ? (
        <form onSubmit={save} className="space-y-2">
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder={tCockpit("examLabelPlaceholder", language)}
            maxLength={60}
            className="h-9 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
          />
          <input
            type="date"
            required
            value={draftDate}
            min={localDayKey(now)}
            onChange={(e) => setDraftDate(e.target.value)}
            className="h-9 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            {custom ? (
              <button type="button" onClick={clear} className="flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline dark:text-rose-400">
                <Trash2 className="h-3.5 w-3.5" />
                {tCockpit("examRemove", language)}
              </button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-xl px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">
                {tCockpit("cancel", language)}
              </button>
              <button type="submit" className="rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-rose-500/25">
                {tCockpit("save", language)}
              </button>
            </span>
          </div>
        </form>
      ) : exam && days !== null ? (
        <>
          <div className="flex items-end gap-3">
            <motion.p
              key={days}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={cn("text-5xl font-black tabular-nums leading-none tracking-tight", urgent ? "text-rose-600 dark:text-rose-400" : "text-foreground")}
            >
              {days}
            </motion.p>
            <div className="min-w-0 pb-0.5">
              <p className="text-xs font-semibold text-foreground">{days === 0 ? tCockpit("examToday", language) : tCockpit(days === 1 ? "dayLeft" : "daysLeft", language)}</p>
              <p className="truncate text-xs text-muted-foreground">{exam.label}</p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {new Date(`${exam.date}T00:00:00`).toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </p>
          <div className="mt-auto pt-4">
            <div className="mb-1 flex justify-between text-[10px] font-medium text-muted-foreground">
              <span>{tCockpit("examWindow", language)}</span>
              <span className="tabular-nums">{elapsedPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn("h-full rounded-full bg-gradient-to-r", urgent ? "from-rose-500 to-orange-500" : "from-rose-400 to-pink-500")}
                initial={{ width: 0 }}
                animate={{ width: `${elapsedPct}%` }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
            </div>
            {exam.source === "plan" && (
              <Link href="/dashboard/todo" className="mt-2 inline-block text-[11px] font-semibold text-rose-600 hover:underline dark:text-rose-400">
                {tCockpit("examOpenPlan", language)}
              </Link>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{tCockpit("examEmpty", language)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={startEdit} className="rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-rose-500/25 transition-all hover:-translate-y-0.5">
              {tCockpit("examSet", language)}
            </button>
            <Link href="/dashboard/todo" className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
              {tCockpit("examPlanner", language)}
            </Link>
          </div>
        </div>
      )}
    </OsCard>
  );
}
