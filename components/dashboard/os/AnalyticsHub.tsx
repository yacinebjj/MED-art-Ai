"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Brain, Clock3, Flame, Minus, Plus, Target, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { usePomodoro } from "@/providers/PomodoroProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { activeDays, computeStreak, focusLastSevenDays, focusSecondsOn, formatDuration, recentDays } from "@/lib/dashboard/metrics";
import {
  DEFAULT_DAILY_GOAL_MINUTES,
  readDailyGoalMinutes,
  readFlashcardSession,
  writeDailyGoalMinutes,
  type FlashcardSessionSummary,
} from "@/lib/dashboard/local-activity";
import { tCockpit } from "@/lib/translations/cockpit";
import { EmptyHint, OsCard, RadialGauge, Skeleton, WidgetSkeleton, useNow } from "./primitives";
import { ExamCountdownWidget } from "./ExamCountdownWidget";
import { ClinicalPearlWidget } from "./ClinicalPearlWidget";

const GRID = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

/** Day-of-week initial for the heat strip / bar chart. */
function weekdayInitial(date: Date, language: Language) {
  return date.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { weekday: "narrow" });
}

// ---------------------------------------------------------------------------

function StreakWidget({ userId }: { userId: string | null }) {
  const { language } = useLanguage();
  const { focusLog } = usePomodoro();
  const overview = useCockpitStore((state) => state.overview);
  const now = useNow();
  const [goal, setGoal] = useState(DEFAULT_DAILY_GOAL_MINUTES);
  useEffect(() => {
    if (userId) setGoal(readDailyGoalMinutes(userId));
  }, [userId]);

  const dayCount = Object.keys(focusLog).length;
  const days = useMemo(
    () => (overview ? activeDays(overview.activity, focusLog) : null),
    // Only the SET of days matters here, not the per-second focus increments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, dayCount]
  );

  if (!now || !days) return <WidgetSkeleton />;

  const streak = computeStreak(days, now);
  const strip = recentDays(days, now, 14);
  const todaySeconds = focusSecondsOn(focusLog, now);
  const goalPct = Math.min(100, Math.round((todaySeconds / 60 / goal) * 100));

  function changeGoal(delta: number) {
    const next = Math.min(720, Math.max(10, goal + delta));
    setGoal(next);
    if (userId) writeDailyGoalMinutes(userId, next);
  }

  return (
    <OsCard icon={Flame} iconClassName="from-orange-500 to-rose-500" title={tCockpit("streakTitle", language)} glow="hover:shadow-orange-500/15">
      <div className="flex items-center gap-4">
        <div className="relative">
          <motion.span
            className="block text-5xl leading-none"
            animate={streak.current > 0 ? { scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] } : undefined}
            transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2 }}
            aria-hidden
          >
            {streak.current > 0 ? "🔥" : "🪵"}
          </motion.span>
        </div>
        <div className="min-w-0">
          <p className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
            {streak.current}
            <span className="ml-1.5 text-sm font-semibold text-muted-foreground">{tCockpit(streak.current === 1 ? "dayUnit" : "daysUnit", language)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {streak.current === 0 ? tCockpit("streakZero", language) : streak.activeToday ? tCockpit("streakActiveToday", language) : tCockpit("streakKeepAlive", language)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-1" aria-label={tCockpit("streakStripLabel", language)}>
        {strip.map((day, i) => (
          <div key={day.key} className="flex flex-1 flex-col items-center gap-1">
            <motion.span
              initial={{ scaleY: 0.3, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay: i * 0.025 }}
              title={day.date.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB")}
              className={cn(
                "h-6 w-full max-w-[18px] rounded-md",
                day.active ? "bg-gradient-to-t from-orange-500 to-amber-400 shadow-[0_0_10px_rgb(249_115_22/0.35)]" : "bg-muted",
                i === strip.length - 1 && "ring-2 ring-primary-400/60 ring-offset-1 ring-offset-transparent"
              )}
            />
            {/* Every slot keeps the label line (empty on even days) so all bars share one baseline. */}
            <span className="h-3 text-[9px] font-medium uppercase leading-3 text-muted-foreground">{i % 2 === 1 ? weekdayInitial(day.date, language) : ""}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-white/30 bg-white/30 p-3 dark:border-white/5 dark:bg-white/[0.03]">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <Target className="h-3.5 w-3.5 text-orange-500" />
            {tCockpit("dailyGoal", language).replace("{pct}", String(goalPct))}
          </span>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => changeGoal(-15)} aria-label={tCockpit("goalLess", language)} className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[3.5rem] text-center font-medium tabular-nums text-muted-foreground">{formatDuration(goal * 60, language)}</span>
            <button type="button" onClick={() => changeGoal(15)} aria-label={tCockpit("goalMore", language)} className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="h-3 w-3" />
            </button>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <motion.div
            className={cn("h-full rounded-full bg-gradient-to-r", goalPct >= 100 ? "from-emerald-500 to-teal-400" : "from-orange-500 to-amber-400")}
            initial={{ width: 0 }}
            animate={{ width: `${goalPct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{tCockpit("goalSource", language).replace("{time}", formatDuration(todaySeconds, language))}</p>
      </div>
    </OsCard>
  );
}

// ---------------------------------------------------------------------------

function QcmWidget() {
  const { language } = useLanguage();
  const overview = useCockpitStore((state) => state.overview);
  if (!overview) return <WidgetSkeleton />;
  const { qcm, exams } = overview;
  const accuracy = qcm.answeredThisWeek > 0 ? Math.round((qcm.correctThisWeek / qcm.answeredThisWeek) * 100) : null;
  const overall = qcm.answeredTotal > 0 ? Math.round((qcm.correctTotal / qcm.answeredTotal) * 100) : null;

  return (
    <OsCard icon={Target} iconClassName="from-primary-500 to-cyan-500" title={tCockpit("qcmTitle", language)} glow="hover:shadow-primary-500/15">
      <div className="flex items-center gap-4">
        <RadialGauge value={accuracy} gradient={["#14b8a6", "#06b6d4"]}>
          <span className="text-lg font-extrabold tabular-nums text-foreground">{accuracy === null ? "—" : `${accuracy}%`}</span>
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{tCockpit("accuracy", language)}</span>
        </RadialGauge>
        <div className="min-w-0 space-y-1.5">
          <p className="text-2xl font-extrabold tabular-nums text-foreground">
            {qcm.answeredThisWeek}
            <span className="ml-1.5 text-xs font-semibold text-muted-foreground">{tCockpit("qcmThisWeek", language)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {overall === null ? tCockpit("qcmNoneYet", language) : tCockpit("qcmOverall", language).replace("{pct}", String(overall)).replace("{n}", String(qcm.answeredTotal))}
          </p>
        </div>
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <div className="rounded-xl border border-white/30 bg-white/30 p-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-400">{qcm.dueForReview}</p>
          <p className="text-[10px] leading-tight text-muted-foreground">{tCockpit("srsDue", language)}</p>
        </div>
        <div className="rounded-xl border border-white/30 bg-white/30 p-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-lg font-bold tabular-nums text-foreground">{exams.avgScorePctThisWeek === null ? "—" : `${exams.avgScorePctThisWeek}%`}</p>
          <p className="text-[10px] leading-tight text-muted-foreground">{tCockpit("examsWeek", language).replace("{n}", String(exams.attemptsThisWeek))}</p>
        </div>
      </div>
    </OsCard>
  );
}

// ---------------------------------------------------------------------------

function FlashcardWidget({ userId }: { userId: string | null }) {
  const { language } = useLanguage();
  const overview = useCockpitStore((state) => state.overview);
  const [session, setSession] = useState<FlashcardSessionSummary | null | undefined>(undefined);
  useEffect(() => {
    setSession(userId ? readFlashcardSession(userId) : null);
  }, [userId]);

  if (session === undefined) return <WidgetSkeleton />;
  const graded = session ? session.correct + session.incorrect : 0;
  const knownPct = graded > 0 ? Math.round((session!.correct / graded) * 100) : 0;
  const activeModules = overview?.flashcardActiveModuleIds.length ?? null;

  return (
    <OsCard icon={Brain} iconClassName="from-violet-500 to-fuchsia-500" title={tCockpit("flashTitle", language)} glow="hover:shadow-violet-500/15">
      {session && graded > 0 ? (
        <>
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-2xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">{session.correct}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tCockpit("flashKnown", language)}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold tabular-nums text-rose-500">{session.incorrect}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tCockpit("flashToReview", language)}</p>
            </div>
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400" initial={{ width: 0 }} animate={{ width: `${knownPct}%` }} transition={{ duration: 0.8 }} />
            <motion.div className="h-full bg-gradient-to-r from-rose-400 to-rose-500" initial={{ width: 0 }} animate={{ width: `${100 - knownPct}%` }} transition={{ duration: 0.8 }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {tCockpit("flashSession", language).replace("{n}", String(session.reviewedTotal)).replace("{left}", String(session.remainingInBatch))}
          </p>
        </>
      ) : (
        <EmptyHint>{tCockpit("flashEmpty", language)}</EmptyHint>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <div className="text-[11px] text-muted-foreground">
          {activeModules === null ? <Skeleton className="h-3 w-24" /> : tCockpit("flashActiveModules", language).replace("{n}", String(activeModules))}
        </div>
        <Link
          href="/dashboard/study?tab=flashcards"
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-violet-500/25 transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
        >
          {session && session.remainingInBatch > 0 ? tCockpit("flashResume", language) : tCockpit("flashStart", language)}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </OsCard>
  );
}

// ---------------------------------------------------------------------------

function FocusWidget() {
  const { language } = useLanguage();
  const { focusLog, isActive, seconds, toggleActive } = usePomodoro();
  const now = useNow();
  if (!now) return <WidgetSkeleton />;

  const week = focusLastSevenDays(focusLog, now);
  const weekTotal = week.reduce((sum, day) => sum + day.seconds, 0);
  const max = Math.max(...week.map((day) => day.seconds), 60);
  const today = week[week.length - 1].seconds;

  return (
    <OsCard
      icon={Clock3}
      iconClassName="from-sky-500 to-indigo-500"
      title={tCockpit("focusTitle", language)}
      glow="hover:shadow-sky-500/15"
      action={
        isActive ? (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        ) : null
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-2xl font-extrabold tabular-nums text-foreground">{formatDuration(today, language)}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{tCockpit("focusToday", language)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums text-foreground">{formatDuration(weekTotal, language)}</p>
          <p className="text-[10px] text-muted-foreground">{tCockpit("focusWeek", language)}</p>
        </div>
      </div>
      <div className="mt-3 flex h-20 items-end justify-between gap-1.5">
        {week.map((day, i) => (
          <div key={day.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <motion.div
              title={formatDuration(day.seconds, language)}
              className={cn(
                "w-full max-w-[22px] rounded-t-md",
                i === week.length - 1 ? "bg-gradient-to-t from-sky-500 to-indigo-400" : "bg-gradient-to-t from-sky-500/40 to-indigo-400/40"
              )}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(4, (day.seconds / max) * 100)}%` }}
              transition={{ duration: 0.6, delay: i * 0.04 }}
            />
            <span className="text-[9px] font-medium uppercase text-muted-foreground">{weekdayInitial(day.date, language)}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <button
          type="button"
          onClick={toggleActive}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:-translate-y-0.5 active:scale-95",
            isActive ? "bg-amber-500 shadow-amber-500/25" : "bg-gradient-to-r from-sky-600 to-indigo-600 shadow-sky-500/25"
          )}
        >
          <Timer className="h-3.5 w-3.5" />
          {isActive ? tCockpit("focusPause", language) : tCockpit("focusStart", language)}
        </button>
        <Link href="/dashboard/study?tab=session" className="text-[11px] font-semibold text-sky-600 hover:underline dark:text-sky-400">
          {tCockpit("focusOpen", language)}
        </Link>
      </div>
    </OsCard>
  );
}

// ---------------------------------------------------------------------------

/** "Analytics & Productivity Hub" — every number comes from real data; empty states say so instead of inventing one. */
export function AnalyticsHub() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const userId = user?.id ?? null;
  const status = useCockpitStore((state) => state.status);
  const error = useCockpitStore((state) => state.error);
  const refresh = useCockpitStore((state) => state.refresh);
  const hasOverview = useCockpitStore((state) => state.overview !== null);

  return (
    <section aria-labelledby="analytics-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="analytics-heading" className="text-base font-bold tracking-tight text-foreground sm:text-lg">
            {tCockpit("analyticsHeading", language)}
          </h2>
          <p className="text-xs text-muted-foreground">{tCockpit("analyticsSub", language)}</p>
        </div>
        {status === "error" && !hasOverview && (
          <button type="button" onClick={() => void refresh({ force: true })} className="text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400" title={error ?? undefined}>
            {tCockpit("retry", language)}
          </button>
        )}
      </div>
      <motion.div variants={GRID} initial="hidden" animate="show" className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        <StreakWidget userId={userId} />
        <QcmWidget />
        <FlashcardWidget userId={userId} />
        <FocusWidget />
        <ExamCountdownWidget userId={userId} />
        <ClinicalPearlWidget userId={userId} />
      </motion.div>
    </section>
  );
}
