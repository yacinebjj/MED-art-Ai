"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { fetchSyncNamespace, putSyncDoc, type SyncedValue } from "@/lib/user-sync";
import { hydrateLocalActivityFromServer } from "@/lib/dashboard/local-activity";

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

/** Cross-device sync (lib/user-sync.ts): the whole focus log is one document. Running-timer keys stay local. */
const FOCUS_LOG_SYNC_NS = "activity";
const FOCUS_LOG_SYNC_KEY = "focus-log";

/** While the timer runs, the focus log is merged with the server copy this often. */
const FOCUS_LOG_SYNC_INTERVAL_MS = 60_000;

/**
 * While the timer runs, the per-second focus count accumulates in a ref and is
 * published (React state + localStorage) only this often, on stop, and when
 * the page is hidden. Publishing it every second re-rendered every focus-log
 * reader (notifications, streak/focus widgets, study page) 60 times a minute
 * and re-serialized the whole log to localStorage on each tick — for a number
 * no widget displays to the second.
 */
const FOCUS_LOG_COMMIT_EVERY_S = 15;

/** Per day, the larger count wins: time studied on two devices never erases itself, and re-merging is harmless. */
function mergeFocusLogs(a: FocusLog, b: FocusLog): FocusLog {
  const merged: FocusLog = { ...a };
  for (const [day, value] of Object.entries(b)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof value === "number" && Number.isFinite(value) && value > (merged[day] ?? 0)) merged[day] = value;
  }
  return pruneFocusLog(merged);
}

function sameFocusLog(a: FocusLog, b: FocusLog): boolean {
  const days = Object.keys(a);
  return days.length === Object.keys(b).length && days.every((day) => a[day] === b[day]);
}

const PomodoroContext = createContext<Omit<PomodoroContextType, "focusLog"> | undefined>(undefined);
/** Separate from the ticking clock: readers of the focus log alone never re-render on each second. */
const FocusLogContext = createContext<FocusLog | undefined>(undefined);

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
  // Authoritative in-memory focus log (see FOCUS_LOG_COMMIT_EVERY_S); `focusLog` state is its last published snapshot.
  const focusLogRef = useRef<FocusLog>({});
  // Updated synchronously in setUserId (before any effect cleanup runs), so a
  // sync started for one account never writes into another one.
  const bucketRef = useRef(ANONYMOUS_BUCKET);

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
    focusLogRef.current = readFocusLog(keys.focusLog);
    setFocusLog(focusLogRef.current);
  }, [bucket]);

  /** Publishes the in-memory focus log to React state and localStorage. */
  const commitFocusLog = useCallback(() => {
    const log = focusLogRef.current;
    try {
      localStorage.setItem(keysFor(bucketRef.current).focusLog, JSON.stringify(log));
    } catch {
      // Storage full or blocked: the in-memory log still counts this session.
    }
    setFocusLog(log);
  }, []);

  // Cross-device focus log: merged with the server copy (per-day max, written
  // back to both sides) once the account is known, every minute while the
  // timer runs, and when it stops. The local side is read from localStorage
  // (written every tick), never from possibly-stale state. Sync unavailable =
  // no-op, the log stays device-local exactly as before.
  const syncFocusLog = useCallback(async () => {
    if (bucket === ANONYMOUS_BUCKET || bucketRef.current !== bucket) return;
    const docs = await fetchSyncNamespace(FOCUS_LOG_SYNC_NS, FOCUS_LOG_SYNC_KEY);
    if (!docs || bucketRef.current !== bucket) return;
    const doc = docs.find((d) => d.key === FOCUS_LOG_SYNC_KEY && !d.deleted);
    const remoteValue = doc && doc.data && typeof doc.data === "object" ? (doc.data as Partial<SyncedValue<unknown>>).value : null;
    const remote = remoteValue && typeof remoteValue === "object" ? mergeFocusLogs({}, remoteValue as FocusLog) : {};
    const local = focusLogRef.current;
    const merged = mergeFocusLogs(local, remote);
    if (!sameFocusLog(merged, local)) {
      focusLogRef.current = mergeFocusLogs(focusLogRef.current, remote);
      commitFocusLog();
    }
    if (!doc || !sameFocusLog(merged, remote)) {
      const upload: SyncedValue<FocusLog> = { value: merged, savedAt: Date.now() };
      putSyncDoc(FOCUS_LOG_SYNC_NS, FOCUS_LOG_SYNC_KEY, upload, true);
    }
  }, [bucket, commitFocusLog]);

  // Account known: merge the focus log, and reconcile the dashboard's own
  // synced values (lib/dashboard/local-activity.ts). This Provider is the one
  // place always mounted with the real user id, so it hydrates once here and
  // the dashboard widgets re-read on its "medart:local-activity-synced" event.
  useEffect(() => {
    if (bucket === ANONYMOUS_BUCKET) return;
    void syncFocusLog();
    void hydrateLocalActivityFromServer(bucket);
  }, [bucket, syncFocusLog]);

  useEffect(() => {
    if (!isActive || bucket === ANONYMOUS_BUCKET) return;
    const id = setInterval(() => void syncFocusLog(), FOCUS_LOG_SYNC_INTERVAL_MS);
    return () => {
      clearInterval(id);
      // Timer stopped (or unmount): push the time counted since the last merge.
      // After an account switch this is a no-op (bucketRef already moved on).
      void syncFocusLog();
    };
  }, [isActive, bucket, syncFocusLog]);

  // تشغيل العداد وتحديث التخزين المحلي في الخلفية بشكل متزامن
  useEffect(() => {
    if (!isActive) return;
    let uncommitted = 0;
    const interval = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        try {
          localStorage.setItem(keysFor(bucket).seconds, next.toString());
        } catch {
          // Storage blocked: the running session still counts in memory.
        }
        return next;
      });
      const day = localDayKey(new Date());
      const log = focusLogRef.current;
      focusLogRef.current = pruneFocusLog({ ...log, [day]: (log[day] ?? 0) + 1 });
      uncommitted += 1;
      if (uncommitted >= FOCUS_LOG_COMMIT_EVERY_S) {
        uncommitted = 0;
        commitFocusLog();
      }
    }, 1000);
    // A backgrounded / closed tab never loses the last few seconds.
    function handleHide() {
      if (document.visibilityState === "hidden") commitFocusLog();
    }
    document.addEventListener("visibilitychange", handleHide);
    window.addEventListener("pagehide", commitFocusLog);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleHide);
      window.removeEventListener("pagehide", commitFocusLog);
      commitFocusLog();
    };
  }, [isActive, bucket, commitFocusLog]);

  const toggleActive = useCallback(() => {
    setIsActive((prev) => {
      const nextState = !prev;
      localStorage.setItem(keysFor(bucketRef.current).active, nextState.toString());
      return nextState;
    });
  }, []);

  const toggleVisible = useCallback(() => {
    setIsVisible((prev) => {
      const nextState = !prev;
      localStorage.setItem(keysFor(bucketRef.current).visible, nextState.toString());
      return nextState;
    });
  }, []);

  const resetTimer = useCallback(() => {
    setSeconds(0);
    setIsActive(false);
    setCurrentCycle(1);
    setCurrentMode("study");
    const keys = keysFor(bucketRef.current);
    localStorage.setItem(keys.seconds, "0");
    localStorage.setItem(keys.active, "false");
  }, []);

  const setUserId = useCallback((userId: string | null) => {
    bucketRef.current = userId ?? ANONYMOUS_BUCKET;
    setBucket(userId ?? ANONYMOUS_BUCKET);
  }, []);

  const clock = useMemo(
    () => ({
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
    }),
    [seconds, isActive, isVisible, toggleActive, toggleVisible, resetTimer, setUserId, currentCycle, currentMode]
  );

  return (
    <PomodoroContext.Provider value={clock}>
      <FocusLogContext.Provider value={focusLog}>{children}</FocusLogContext.Provider>
    </PomodoroContext.Provider>
  );
}

/** The timer + focus log. Re-renders every second while running — components that only read the log should use useFocusLog(). */
export function usePomodoro(): PomodoroContextType {
  const context = useContext(PomodoroContext);
  const focusLog = useContext(FocusLogContext);
  if (!context || !focusLog) {
    throw new Error("usePomodoro must be used within a PomodoroProvider");
  }
  return { ...context, focusLog };
}

/** Focus log only (per-day seconds) — updates every few seconds, never on each tick. */
export function useFocusLog(): FocusLog {
  const focusLog = useContext(FocusLogContext);
  if (!focusLog) throw new Error("useFocusLog must be used within a PomodoroProvider");
  return focusLog;
}