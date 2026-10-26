"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { fetchSyncNamespace, putSyncDoc, type SyncedValue } from "@/lib/user-sync";
import { hydrateLocalActivityFromServer } from "@/lib/dashboard/local-activity";
import { haptic } from "@/lib/haptics";
import { isPomodoroAudioUnlocked, playPomodoroChime, unlockPomodoroAudio } from "@/lib/pomodoro/chime";
import {
  POMODORO_PHASE_EVENT,
  POMODORO_SETTINGS_EVENT,
  POMODORO_SETTINGS_KEY,
  derivePomodoroPhase,
  parsePomodoroTiming,
  readStoredPomodoroSettings,
  type PomodoroCue,
  type PomodoroMode,
  type PomodoroPhaseEventDetail,
  type PomodoroTiming,
} from "@/lib/pomodoro/schedule";

export type { PomodoroMode };

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
   * Where the schedule stands (lib/pomodoro/schedule.ts), derived HERE from
   * `seconds` and the saved durations — this Provider is the Pomodoro
   * engine for the whole app. Phase changes chime and announce themselves,
   * and the session stops itself after the last cycle, whatever page is
   * open: that used to live in StudyDashboard.tsx, so away from the Study
   * page a break started silently and the clock never stopped. Every reset
   * button resets `seconds`, which resets these with it.
   */
  currentCycle: number;
  currentMode: PomodoroMode;
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
  // The student's durations (saved by the Study page); null until read on the client.
  const [timing, setTiming] = useState<PomodoroTiming | null>(null);
  const [focusLog, setFocusLog] = useState<FocusLog>({});
  // Authoritative in-memory focus log (see FOCUS_LOG_COMMIT_EVERY_S); `focusLog` state is its last published snapshot.
  const focusLogRef = useRef<FocusLog>({});
  // Updated synchronously in setUserId (before any effect cleanup runs), so a
  // sync started for one account never writes into another one.
  const bucketRef = useRef(ANONYMOUS_BUCKET);
  // Last phase seen ("cycle:mode"); null = the next one is only recorded, never announced.
  const lastPhaseKeyRef = useRef<string | null>(null);
  const completionHandledRef = useRef(false);

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
    // Restored state is a position, not a transition: never chime for it.
    lastPhaseKeyRef.current = null;
  }, [bucket]);

  // Durations: read once, then again whenever the Study page saves them
  // (POMODORO_SETTINGS_EVENT) or another tab does (storage event).
  useEffect(() => {
    const read = () => setTiming(parsePomodoroTiming(readStoredPomodoroSettings()));
    const handleStorage = (event: StorageEvent) => {
      if (event.key === POMODORO_SETTINGS_KEY) read();
    };
    read();
    window.addEventListener(POMODORO_SETTINGS_EVENT, read);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(POMODORO_SETTINGS_EVENT, read);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

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
  // The clock follows real time, not timer ticks. A hidden tab's timers are
  // throttled (down to one run a minute in Chrome after 5 minutes) and a
  // suspended phone page runs none: counting +1 per tick made the session
  // crawl there, and the break — with its chime — came hours late, if ever.
  // Each tick, and the page coming back on screen, adds every whole second
  // that really elapsed (monotonic clock: a changed system time can't jump it).
  useEffect(() => {
    if (!isActive) return;
    let uncommitted = 0;
    let lastTick = performance.now();
    let carryMs = 0;
    function advance() {
      const now = performance.now();
      // Never backwards, whatever the clock does: a negative step would stall the session.
      carryMs += Math.max(0, now - lastTick);
      lastTick = now;
      const elapsed = Math.floor(carryMs / 1000);
      if (elapsed < 1) return;
      carryMs -= elapsed * 1000;
      setSeconds((prev) => {
        const next = prev + elapsed;
        try {
          localStorage.setItem(keysFor(bucket).seconds, next.toString());
        } catch {
          // Storage blocked: the running session still counts in memory.
        }
        return next;
      });
      const day = localDayKey(new Date());
      const log = focusLogRef.current;
      focusLogRef.current = pruneFocusLog({ ...log, [day]: (log[day] ?? 0) + elapsed });
      uncommitted += elapsed;
      if (uncommitted >= FOCUS_LOG_COMMIT_EVERY_S) {
        uncommitted = 0;
        commitFocusLog();
      }
    }
    const interval = setInterval(advance, 1000);
    // A backgrounded / closed tab never loses the last few seconds; back on
    // screen, the clock catches up at once instead of on the next tick.
    function handleVisibility() {
      if (document.visibilityState === "hidden") commitFocusLog();
      else advance();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", commitFocusLog);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", commitFocusLog);
      commitFocusLog();
    };
  }, [isActive, bucket, commitFocusLog]);

  const toggleActive = useCallback(() => {
    // Almost always a tap on Start/Pause: the moment the browser lets the
    // page unlock audio for the chimes to come (see lib/pomodoro/chime.ts).
    void unlockPomodoroAudio();
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
    const keys = keysFor(bucketRef.current);
    localStorage.setItem(keys.seconds, "0");
    localStorage.setItem(keys.active, "false");
  }, []);

  const setUserId = useCallback((userId: string | null) => {
    bucketRef.current = userId ?? ANONYMOUS_BUCKET;
    setBucket(userId ?? ANONYMOUS_BUCKET);
  }, []);

  // ── The engine: the schedule, derived from the real elapsed seconds ────
  const phase = timing ? derivePomodoroPhase(seconds, timing) : null;
  const currentCycle = phase ? phase.cycleIndex + 1 : 1;
  const currentMode: PomodoroMode = phase?.mode ?? "study";
  const phaseKey = phase ? `${phase.cycleIndex}:${phase.mode}` : null;
  const isComplete = phase?.isComplete ?? false;

  /** Chime now (any page) with a buzz on phones that vibrate, and tell the toasts (POMODORO_PHASE_EVENT — app/dashboard/layout.tsx shows them). */
  const announce = useCallback((cue: PomodoroCue, cycle: number, at: PomodoroTiming) => {
    playPomodoroChime(cue);
    haptic(cue === "focus" ? [120, 70, 120] : [180, 90, 180, 90, 260]);
    const detail: PomodoroPhaseEventDetail = { cue, cycle, timing: at };
    window.dispatchEvent(new CustomEvent(POMODORO_PHASE_EVENT, { detail }));
  }, []);

  // A real phase change while the clock runs: study → break, break → study.
  // Not the restart of a finished session (back to cycle 1's study).
  useEffect(() => {
    if (phaseKey === null || !timing) return;
    const previous = lastPhaseKeyRef.current;
    lastPhaseKeyRef.current = phaseKey;
    if (previous === null || previous === phaseKey || !isActive || phaseKey === "0:study") return;
    announce(currentMode === "break" ? "break" : "focus", currentCycle, timing);
    // Only phase changes matter here — not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKey]);

  // The whole session is done: stop the clock once, whatever page is open.
  useEffect(() => {
    if (!isComplete) {
      completionHandledRef.current = false;
      return;
    }
    if (!isActive || !timing || completionHandledRef.current) return;
    completionHandledRef.current = true;
    setIsActive(false);
    try {
      localStorage.setItem(keysFor(bucketRef.current).active, "false");
    } catch {
      // Storage blocked: the clock is stopped in memory all the same.
    }
    announce("complete", timing.cycles, timing);
  }, [isComplete, isActive, timing, announce]);

  // A reload restored a running clock: no Start tap happened on this page
  // yet, so the next tap or key press anywhere unlocks the chimes to come.
  useEffect(() => {
    if (!isActive || isPomodoroAudioUnlocked()) return;
    const gestures = ["pointerdown", "pointerup", "touchend", "keydown", "click"] as const;
    let done = false;
    function stopListening() {
      done = true;
      for (const type of gestures) window.removeEventListener(type, handleGesture, true);
    }
    function handleGesture() {
      void unlockPomodoroAudio().then((unlocked) => {
        if (unlocked && !done) stopListening();
      });
    }
    for (const type of gestures) window.addEventListener(type, handleGesture, true);
    return stopListening;
  }, [isActive]);

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