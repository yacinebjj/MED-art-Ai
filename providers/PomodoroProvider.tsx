"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PomodoroContextType {
  seconds: number;
  isActive: boolean;
  isVisible: boolean;
  toggleActive: () => void;
  toggleVisible: () => void;
  resetTimer: () => void;
  /** Called once the real signed-in user is known (see PomodoroAuthSync in providers/PomodoroAuthSync.tsx) — this Provider is mounted ABOVE AuthProvider in app/layout.tsx, so it has no way to read the current user itself. */
  setUserId: (userId: string | null) => void;
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
  };
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [bucket, setBucket] = useState(ANONYMOUS_BUCKET);
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

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
    const keys = keysFor(bucket);
    localStorage.setItem(keys.seconds, "0");
    localStorage.setItem(keys.active, "false");
  };

  const setUserId = (userId: string | null) => {
    setBucket(userId ?? ANONYMOUS_BUCKET);
  };

  return (
    <PomodoroContext.Provider
      value={{ seconds, isActive, isVisible, toggleActive, toggleVisible, resetTimer, setUserId }}
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