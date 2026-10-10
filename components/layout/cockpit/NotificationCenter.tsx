"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, CalendarClock, CheckCheck, Flame, Gauge, Mic, MessageCircle, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useFocusLog } from "@/providers/PomodoroProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { activeDays, computeStreak, daysUntil } from "@/lib/dashboard/metrics";
import { onLocalActivitySynced, readCustomExam, readSeenNotificationIds, writeSeenNotificationIds } from "@/lib/dashboard/local-activity";
import { tCockpit } from "@/lib/translations/cockpit";
import type { DashboardOverview } from "@/types/dashboard-overview";
import { AUDIO_SMART_NOTES_ENABLED, AUDIO_SMART_NOTES_PAGE } from "@/lib/feature-flags";

interface CockpitNotification {
  /** Stable for one occurrence (includes a date/count), so "read" sticks until something new happens. */
  id: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  body: string;
  href?: string;
}

const DAY_MS = 86_400_000;

function buildNotifications(
  overview: DashboardOverview | null,
  groupsUnread: number,
  streak: { current: number; activeToday: boolean },
  customExamDate: string | null,
  language: Language,
  now: Date
): CockpitNotification[] {
  const list: CockpitNotification[] = [];
  const todayKey = now.toISOString().slice(0, 10);

  if (groupsUnread > 0) {
    list.push({
      id: `groups:${groupsUnread}:${todayKey}`,
      icon: MessageCircle,
      tone: "text-sky-500",
      title: tCockpit("notifGroupsTitle", language),
      body: tCockpit("notifGroupsBody", language).replace("{n}", String(groupsUnread)),
      href: "/dashboard/groups",
    });
  }

  if (!overview) return list;

  const examDate = overview.nextExam?.examDate ?? customExamDate;
  if (examDate) {
    const days = daysUntil(examDate, now);
    if (days >= 0 && days <= 7) {
      list.push({
        id: `exam:${examDate}:${days}`,
        icon: CalendarClock,
        tone: "text-rose-500",
        title: tCockpit("notifExamTitle", language),
        body: days === 0 ? tCockpit("notifExamToday", language) : tCockpit("notifExamBody", language).replace("{n}", String(days)),
        href: overview.nextExam ? "/dashboard/todo" : undefined,
      });
    }
  }

  if (overview.qcm.dueForReview > 0) {
    list.push({
      id: `srs:${overview.qcm.dueForReview}:${todayKey}`,
      icon: RefreshCw,
      tone: "text-violet-500",
      title: tCockpit("notifSrsTitle", language),
      body: tCockpit("notifSrsBody", language).replace("{n}", String(overview.qcm.dueForReview)),
    });
  }

  if (streak.current > 0 && !streak.activeToday && now.getHours() >= 17) {
    list.push({
      id: `streak:${todayKey}`,
      icon: Flame,
      tone: "text-orange-500",
      title: tCockpit("notifStreakTitle", language),
      body: tCockpit("notifStreakBody", language).replace("{n}", String(streak.current)),
      href: "/dashboard/study?tab=flashcards",
    });
  }

  const recentCourses = overview.courses.filter((course) => now.getTime() - new Date(course.updatedAt).getTime() < DAY_MS);
  if (recentCourses.length > 0) {
    const newest = recentCourses[0];
    list.push({
      id: `courses:${newest.id}:${newest.updatedAt}`,
      icon: Sparkles,
      tone: "text-emerald-500",
      title: tCockpit("notifCoursesTitle", language),
      body: recentCourses.length === 1 ? newest.title : tCockpit("notifCoursesBody", language).replace("{n}", String(recentCourses.length)),
      href: `/dashboard/module/${newest.moduleId}?course=${newest.id}`,
    });
  }

  const recentAudio = AUDIO_SMART_NOTES_ENABLED && overview.lectureNotes.find((job) => now.getTime() - new Date(job.updatedAt).getTime() < 2 * DAY_MS);
  if (recentAudio) {
    list.push({
      id: `audio:${recentAudio.id}`,
      icon: Mic,
      tone: "text-orange-500",
      title: tCockpit("notifAudioTitle", language),
      body: recentAudio.title,
      href: `${AUDIO_SMART_NOTES_PAGE}?jobId=${recentAudio.id}`,
    });
  }

  const { plan } = overview;
  if (plan.trialActive && plan.trialDaysRemaining > 0 && plan.trialDaysRemaining <= 3) {
    list.push({
      id: `trial:${plan.trialDaysRemaining}`,
      icon: Gauge,
      tone: "text-amber-500",
      title: tCockpit("notifTrialTitle", language),
      body: tCockpit("notifTrialBody", language).replace("{n}", String(plan.trialDaysRemaining)),
      href: "/dashboard/billing",
    });
  } else if (!plan.unlimitedThisPeriod && plan.generationsCap > 0 && plan.generationsUsed / plan.generationsCap >= 0.8) {
    list.push({
      id: `quota:${plan.generationsUsed}/${plan.generationsCap}`,
      icon: Gauge,
      tone: "text-amber-500",
      title: tCockpit("notifQuotaTitle", language),
      body: tCockpit("notifQuotaBody", language).replace("{used}", String(plan.generationsUsed)).replace("{cap}", String(plan.generationsCap)),
      href: "/dashboard/billing",
    });
  }

  return list;
}

export function NotificationCenter() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { language } = useLanguage();
  const focusLog = useFocusLog();
  const overview = useCockpitStore((state) => state.overview);
  const [groupsUnread, setGroupsUnread] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);
  const [customExamDate, setCustomExamDate] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (!userId) return;
    setSeen(readSeenNotificationIds(userId));
    setCustomExamDate(readCustomExam(userId)?.date ?? null);
    // Exam date set or cleared on another device (cross-device sync).
    const unsubscribe = onLocalActivitySynced(() => setCustomExamDate(readCustomExam(userId)?.date ?? null));
    let cancelled = false;
    function loadGroupsUnread() {
      fetch("/api/groups")
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (cancelled || !body?.success || !Array.isArray(body.groups)) return;
          setGroupsUnread(body.groups.reduce((sum: number, group: { unreadCount?: number }) => sum + (Number(group.unreadCount) || 0), 0));
        })
        .catch(() => {});
    }
    // Once per session + when the app comes back to the foreground. It used
    // to re-run on every overview update (twice at startup alone), and
    // /api/groups is one of the heaviest routes (several queries per group).
    function handleVisibility() {
      if (document.visibilityState === "visible") loadGroupsUnread();
    }
    loadGroupsUnread();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [userId]);

  const streak = useMemo(
    () => (overview && now ? computeStreak(activeDays(overview.activity, focusLog), now) : { current: 0, activeToday: false }),
    // focusLog changes every second while the timer runs; the streak only needs the day set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, now, Object.keys(focusLog).length]
  );

  const notifications = useMemo(
    () => (now ? buildNotifications(overview, groupsUnread, streak, customExamDate, language, now) : []),
    [overview, groupsUnread, streak, customExamDate, language, now]
  );
  const unread = notifications.filter((n) => !seen.includes(n.id));

  function markAllRead() {
    if (!userId) return;
    const next = Array.from(new Set([...seen, ...notifications.map((n) => n.id)]));
    setSeen(next);
    writeSeenNotificationIds(userId, next);
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && unread.length > 0 && markAllRead()}>
      <DropdownMenuTrigger
        aria-label={tCockpit("notifications", language)}
        className="relative flex h-10 w-10 items-center sm:h-9 sm:w-9 justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className={cn("h-4 w-4", unread.length > 0 && "text-foreground")} />
        <AnimatePresence>
          {unread.length > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-background"
            >
              {unread.length > 9 ? "9+" : unread.length}
            </motion.span>
          )}
        </AnimatePresence>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{tCockpit("notifications", language)}</p>
          {unread.length > 0 && (
            <button type="button" onClick={markAllRead} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-400">
              <CheckCheck className="h-3.5 w-3.5" />
              {tCockpit("markAllRead", language)}
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <BellOff className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">{tCockpit("notifEmpty", language)}</p>
            </div>
          ) : (
            notifications.map((n) => {
              const Icon = n.icon;
              const isUnread = !seen.includes(n.id);
              const content = (
                <>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className={cn("h-4 w-4", n.tone)} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {n.title}
                      {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                  </span>
                </>
              );
              return n.href ? (
                <DropdownMenuItem key={n.id} asChild className="items-start gap-3 rounded-xl px-2.5 py-2">
                  <Link href={n.href}>{content}</Link>
                </DropdownMenuItem>
              ) : (
                <div key={n.id} className="flex gap-3 rounded-xl px-2.5 py-2">
                  {content}
                </div>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
