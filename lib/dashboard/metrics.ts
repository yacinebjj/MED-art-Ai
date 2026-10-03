import { localDayKey, type FocusLog } from "@/providers/PomodoroProvider";

/** A focus-log day only counts as "studied" past this many seconds (an accidental start/stop isn't a study day). */
const MIN_FOCUS_SECONDS_FOR_ACTIVE_DAY = 5 * 60;

/** Local calendar days with real study activity: server timestamps (QCMs, exams, Lab, notes, courses, plan tasks) + Pomodoro focus. */
export function activeDays(activity: string[], focusLog: FocusLog): Set<string> {
  const days = new Set<string>();
  for (const iso of activity) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) days.add(localDayKey(date));
  }
  for (const [day, seconds] of Object.entries(focusLog)) {
    if (seconds >= MIN_FOCUS_SECONDS_FOR_ACTIVE_DAY) days.add(day);
  }
  return days;
}

function shiftDay(date: Date, delta: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

/**
 * Consecutive active days ending today — or ending yesterday when today has
 * no activity YET (the streak is still alive until midnight).
 */
export function computeStreak(days: Set<string>, now: Date): { current: number; activeToday: boolean } {
  const activeToday = days.has(localDayKey(now));
  let cursor = activeToday ? now : shiftDay(now, -1);
  let current = 0;
  while (days.has(localDayKey(cursor))) {
    current += 1;
    cursor = shiftDay(cursor, -1);
  }
  return { current, activeToday };
}

/** The last `count` local days (oldest first), each with whether it was active — for the streak heat strip. */
export function recentDays(days: Set<string>, now: Date, count: number): { key: string; date: Date; active: boolean }[] {
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDay(now, -(count - 1 - i));
    const key = localDayKey(date);
    return { key, date, active: days.has(key) };
  });
}

export function focusSecondsOn(focusLog: FocusLog, date: Date): number {
  return focusLog[localDayKey(date)] ?? 0;
}

/** Focus seconds over the last 7 local days, today included, oldest first. */
export function focusLastSevenDays(focusLog: FocusLog, now: Date): { key: string; date: Date; seconds: number }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDay(now, -(6 - i));
    return { key: localDayKey(date), date, seconds: focusSecondsOn(focusLog, date) };
  });
}

export function formatDuration(seconds: number, language: "fr" | "en"): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return language === "fr" ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours}h ${String(rest).padStart(2, "0")}m`;
}

/** Whole local days from today to a "YYYY-MM-DD" date (0 = today, negative = past). */
export function daysUntil(dateKey: string, now: Date): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
