"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { UsageSnapshot } from "@/lib/subscription";

/** Window event any page dispatches after a quota-consuming action (generation, upload…). */
export const USAGE_CHANGED_EVENT = "medart:usage-changed";

/** Tells every mounted useUsage() to re-read /api/subscription. */
export function notifyUsageChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(USAGE_CHANGED_EVENT));
}

interface UsageState {
  usage: UsageSnapshot | null;
  loading: boolean;
  /** True once at least one fetch has completed (success or failure). */
  loaded: boolean;
}

/*
 * One module-level store shared by every useUsage() caller: the paywall
 * provider and the pages' pre-generation warnings all read the same
 * snapshot, and concurrent refreshes are coalesced into a single request.
 */
let state: UsageState = { usage: null, loading: false, loaded: false };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let windowListenerInstalled = false;

const SERVER_STATE: UsageState = { usage: null, loading: false, loaded: false };

function setState(next: UsageState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<UsageSnapshot>;
  return typeof v.planId === "string" && typeof v.isTrial === "boolean" && typeof v.courses === "object" && v.courses !== null;
}

function refreshUsage(): Promise<void> {
  if (inFlight) return inFlight;
  setState({ ...state, loading: true });
  inFlight = (async () => {
    try {
      const res = await fetch("/api/subscription", { cache: "no-store" });
      if (!res.ok) {
        // 401 (signed out) → no usage; any other failure keeps the last known snapshot.
        setState({ usage: res.status === 401 ? null : state.usage, loading: false, loaded: true });
        return;
      }
      const body: unknown = await res.json();
      const usage = body && typeof body === "object" && "usage" in body ? (body as { usage: unknown }).usage : null;
      setState({ usage: isUsageSnapshot(usage) ? usage : null, loading: false, loaded: true });
    } catch {
      setState({ ...state, loading: false, loaded: true });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function ensureWindowListener() {
  if (windowListenerInstalled || typeof window === "undefined") return;
  windowListenerInstalled = true;
  window.addEventListener(USAGE_CHANGED_EVENT, () => {
    void refreshUsage();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Current plan usage (GET /api/subscription → usage). Refreshes on mount
 * (once per page load, shared) and whenever "medart:usage-changed" fires.
 */
export function useUsage(): UsageState & { refresh: () => Promise<void> } {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE
  );

  useEffect(() => {
    ensureWindowListener();
    if (!state.loaded && !inFlight) void refreshUsage();
  }, []);

  const refresh = useCallback(() => refreshUsage(), []);

  return { ...snapshot, refresh };
}

/** Units left in a counter, never negative. */
export function remaining(counter: { used: number; cap: number }): number {
  return Math.max(0, counter.cap - counter.used);
}
