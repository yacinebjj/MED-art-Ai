"use client";

import { create } from "zustand";

/**
 * Launch warm-up shared between components/pwa/AppWarmup.tsx (does the work,
 * inside the dashboard's AuthProvider) and components/layout/SplashScreen.tsx
 * (root layout, outside it — holds the splash until the work is done).
 */

const WARMED_SESSION_KEY = "medart:app-warmed:v1";
/** Hard ceiling for holding the splash: past this the app shows anyway and warming continues in the background. */
export const WARMUP_MAX_MS = 5_000;

interface AppWarmupState {
  total: number;
  done: number;
  finished: boolean;
  begin: (total: number) => void;
  step: () => void;
  finish: () => void;
}

export const useAppWarmup = create<AppWarmupState>()((set) => ({
  total: 0,
  done: 0,
  finished: false,
  begin: (total) => set({ total, done: 0, finished: false }),
  step: () => set((state) => ({ done: Math.min(state.total, state.done + 1) })),
  finish: () => set((state) => ({ finished: true, done: state.total })),
}));

let launchDecision: boolean | null = null;

/**
 * True once per app launch (a fresh iOS standalone process gets a fresh
 * sessionStorage). Decided on first call and cached, so the splash and the
 * warm-up always agree even after the flag is written mid-launch. Storage
 * blocked = never hold the splash.
 */
export function needsLaunchWarmup(): boolean {
  if (launchDecision !== null) return launchDecision;
  if (typeof window === "undefined") return false;
  try {
    launchDecision = window.sessionStorage.getItem(WARMED_SESSION_KEY) !== "1";
  } catch {
    launchDecision = false;
  }
  return launchDecision;
}

export function markLaunchWarmed(): void {
  try {
    window.sessionStorage.setItem(WARMED_SESSION_KEY, "1");
  } catch {
    // Blocked storage: the next reload simply skips holding the splash.
  }
}
