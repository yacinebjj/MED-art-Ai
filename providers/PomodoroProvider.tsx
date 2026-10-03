"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type PomodoroMode = "study" | "break";

interface PomodoroContextType {
  seconds: number;
  isActive: boolean;
  isVisible: boolean;
  toggleActive: () => void;
  toggleVisible: () => void;
  resetTimer: () => void;
  /** Called once the real signed-in user is known (see PomodoroAuthSync in providers/PomodoroAuthSync.tsx) — this Provider is mounted ABOVE AuthProvider in app/layout.tsx, so it has no way to read the current user itself. */
  setUserId: (userId: string | null) => void;
  /**
   * Cycle/mode were previously local state INSIDE StudyDashboard.tsx (the
   * Study Space page's own "Cycle X / Y" display) — meaning the Topbar
   * widget's and PomodoroStudyBanner's own "Réinitialiser" buttons, which
   * only ever called this Provider's resetTimer() directly, had no way to
   * reach StudyDashboard's local state at all. Clicking either of those
   * (both are simultaneously visible alongside StudyDashboard on the Study
   * page) reset `seconds`/`isActive` but silently left "Cycle 3 / 4" (or
   * "Pause" mode) exactly where it was — a real, reported bug: reset felt
   * like it "didn't do anything" depending on which of the 3 reset buttons
   * was clicked. Moved here so EVERY reset button shares one true state and
   * resetTimer() below can reset all of it in one place.
   */
  currentCycle: number;
  currentMode: PomodoroMode;
  setCurrentCycle: (cycle: number) => void;
  setCurrentMode: (mode: PomodoroMode) => void;
  /**
   * Seconds actually spent with the timer RUNNING, per local calendar day
   * ("YYYY-MM-DD" → seconds), for this account on this device. Unlike
   * `seconds` (the current session, zeroed by reset), this survives resets —
   * it is what the dashboard's focus-time / streak widgets read.
   */
  focusLog: FocusLog;
}

export type FocusLog = Record<string, number>;

/** Days kept in the focus log — enough for weekly stats and a long streak, small enough for localStorage. */
const FOCUS_LOG_MAX_DAYS = 120;

/** Local calendar day, "YYYY-MM-DD" (not UTC: a late-evening session must count for the student's own day). */
export function localDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readFocusLog(key: string): FocusLog {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const log: FocusLog = {};
    for (const [day, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof value === "number" && Number.isFinite(value) && value > 0) log[day] = value;
    }
    return log;
  } catch {
    return {};
  }
}

function pruneFocusLog(log: FocusLog): FocusLog {
  const days = Object.keys(log).sort();
  if (days.length <= FOCUS_LOG_MAX_DAYS) return log;
  const kept: FocusLog = {};
  for (const day of days.slice(-FOCUS_LOG_MAX_DAYS)) kept[day] = log[day];
  return kept;
}

const PomodoroContext = createContext<PomodoroContextType | undefined>(undefined);

// "anonymous" — the bucket used before a real user id is known (logged-out
// visitor on a public page). Not a privacy concern on its own (nothing
// personal accumulates for a visitor with no account), only a STARTING
// point every account briefly passes through before setUserId swaps it out.
const ANONYMOUS_BUCKET = "anonymous";

/**
 * Keys were previously flat, global strings ("medart_pomo_seconds", no user
 * id anywhere in them) — meaning a SECOND real student account logging in on
 * the same browser/machine inherited whatever elapsed time/running state the
 * FIRST account had left behind, instead of starting at 00:00. Found while
 * preparing a clean-state demo recording.
 */
function keysFor(bucket: string) {
  return {
    seconds: `medart_pomo_seconds:${bucket}`,
    active: `medart_pomo_active:${bucket}`,
    visible: `medart_pomo_visible:${bucket}`,
    focusLog: `medart_focus_log:${bucket}`,
  };
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [bucket, setBucket] = useState(ANONYMOUS_BUCKET);
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [currentCycle, setCurrentCycle] = useState(1);
  const [currentMode, setCurrentMode] = useState<PomodoroMode>("study");
  const [focusLog, setFocusLog] = useState<FocusLog>({});

  // استرجاع الحالة الحقيقية من localStorage عند تحميل التطبيق — يعاد أيضاً
  // في كل مرة يتغيّر فيها bucket (تبديل حساب على نفس الجهاز، أو تحديد هوية
  // المستخدم لأول مرة بعد التحميل الأولي).
  useEffect(() => {
    const keys = keysFor(bucket);
    const savedSeconds = localStorage.getItem(keys.seconds);
    const savedActive = localStorage.getItem(keys.active);
    const savedVisible = localStorage.getItem(keys.visible);

    setSeconds(savedSeconds ? parseInt(savedSeconds, 10) : 0);
    setIsActive(savedActive === "true");
    if (savedVisible !== null) setIsVisible(savedVisible === "true");
    setFocusLog(readFocusLog(keys.focusLog));
  }, [bucket]);

  // تشغيل العداد وتحديث التخزين المحلي في الخلفية بشكل متزامن
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isActive) {
      interval = setInterval(() => {
        setSeconds((prev) => {
          const next = prev + 1;
          localStorage.setItem(keysFor(bucket).seconds, next.toString());
          return next;
        });
        setFocusLog((prev) => {
          const day = localDayKey(new Date());
          const next = pruneFocusLog({ ...prev, [day]: (prev[day] ?? 0) + 1 });
          try {
            localStorage.setItem(keysFor(bucket).focusLog, JSON.stringify(next));
          } catch {
            // Storage full or blocked: the in-memory log still counts this session.
          }
          return next;
        });
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, bucket]);

  const toggleActive = () => {
    const nextState = !isActive;
    setIsActive(nextState);
    localStorage.setItem(keysFor(bucket).active, nextState.toString());
  };

  const toggleVisible = () => {
    const nextState = !isVisible;
    setIsVisible(nextState);
    localStorage.setItem(keysFor(bucket).visible, nextState.toString());
  };

  const resetTimer = () => {
    setSeconds(0);
    setIsActive(false);
    setCurrentCycle(1);
    setCurrentMode("study");
    const keys = keysFor(bucket);
    localStorage.setItem(keys.seconds, "0");
    localStorage.setItem(keys.active, "false");
  };

  const setUserId = (userId: string | null) => {
    setBucket(userId ?? ANONYMOUS_BUCKET);
  };

  return (
    <PomodoroContext.Provider
      value={{
        seconds,
        isActive,
        isVisible,
        toggleActive,
        toggleVisible,
        resetTimer,
        setUserId,
        currentCycle,
        currentMode,
        setCurrentCycle,
        setCurrentMode,
        focusLog,
      }}
    >
      {children}
    </PomodoroContext.Provider>
  );
}

export function usePomodoro() {
  const context = useContext(PomodoroContext);
  if (!context) {
    throw new Error("usePomodoro must be used within a PomodoroProvider");
  }
  return context;
}