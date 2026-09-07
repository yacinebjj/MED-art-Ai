"use client";

import { useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { usePomodoro } from "@/providers/PomodoroProvider";

/**
 * Bridges the signed-in user's id into PomodoroProvider. PomodoroProvider
 * itself is mounted in app/layout.tsx, ABOVE AuthProvider (app/dashboard/
 * layout.tsx) — so it has no way to call useAuth() directly. Mounted here,
 * INSIDE AuthProvider, as a sibling of {children} — renders nothing, only
 * keeps the Pomodoro timer's storage bucket in sync with whichever real
 * student is signed in, so a second account on the same browser never
 * inherits the first account's elapsed time/running state.
 */
export function PomodoroAuthSync() {
  const auth = useAuth() ?? {};
  const { setUserId } = usePomodoro();

  useEffect(() => {
    setUserId(auth.user?.id ?? null);
  }, [auth.user?.id, setUserId]);

  return null;
}
