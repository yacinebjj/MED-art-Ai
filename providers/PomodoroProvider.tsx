"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PomodoroContextType {
  seconds: number;
  isActive: boolean;
  isVisible: boolean;
  toggleActive: () => void;
  toggleVisible: () => void;
  resetTimer: () => void;
}

const PomodoroContext = createContext<PomodoroContextType | undefined>(undefined);

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [seconds, setSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // استرجاع الحالة الحقيقية من localStorage عند تحميل التطبيق
  useEffect(() => {
    const savedSeconds = localStorage.getItem("medart_pomo_seconds");
    const savedActive = localStorage.getItem("medart_pomo_active");
    const savedVisible = localStorage.getItem("medart_pomo_visible");

    if (savedSeconds) setSeconds(parseInt(savedSeconds, 10));
    if (savedActive) setIsActive(savedActive === "true");
    if (savedVisible !== null) setIsVisible(savedVisible === "true");
  }, []);

  // تشغيل العداد وتحديث التخزين المحلي في الخلفية بشكل متزامن
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isActive) {
      interval = setInterval(() => {
        setSeconds((prev) => {
          const next = prev + 1;
          localStorage.setItem("medart_pomo_seconds", next.toString());
          return next;
        });
      }, 1000);
    } else {
      if (interval) clearInterval(interval);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive]);

  const toggleActive = () => {
    const nextState = !isActive;
    setIsActive(nextState);
    localStorage.setItem("medart_pomo_active", nextState.toString());
  };

  const toggleVisible = () => {
    const nextState = !isVisible;
    setIsVisible(nextState);
    localStorage.setItem("medart_pomo_visible", nextState.toString());
  };

  const resetTimer = () => {
    setSeconds(0);
    setIsActive(false);
    localStorage.setItem("medart_pomo_seconds", "0");
    localStorage.setItem("medart_pomo_active", "false");
  };

  return (
    <PomodoroContext.Provider
      value={{ seconds, isActive, isVisible, toggleActive, toggleVisible, resetTimer }}
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