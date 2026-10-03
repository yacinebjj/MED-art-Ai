"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { DashboardOverview } from "@/types/dashboard-overview";

/**
 * One shared copy of GET /api/dashboard/overview for the whole dashboard
 * shell — the Topbar (notifications, plan badge), the Sidebar (quota gauge,
 * sync status) and the dashboard page (analytics, curriculum progress) all
 * read it, so it is fetched once, not three times. Refreshed when the tab
 * regains focus (at most every 60 s) and when the connection comes back.
 */
type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

interface CockpitState {
  overview: DashboardOverview | null;
  status: SyncStatus;
  lastSyncedAt: number | null;
  error: string | null;
  refresh: (options?: { force?: boolean }) => Promise<void>;
  reset: () => void;
}

const MIN_REFRESH_INTERVAL_MS = 60_000;
/**
 * Hard ceiling on one overview request (AbortController). The request never
 * blocks navigation — every widget renders from the cached copy meanwhile —
 * but a hung connection must not leave the store "syncing" forever. Longer
 * than a navigation timeout on purpose: the route aggregates ~12 queries and
 * students are often on slow mobile networks; a too-tight limit would abort
 * responses that were about to arrive and never refresh at all.
 */
const FETCH_TIMEOUT_MS = 10_000;
let inFlight: Promise<void> | null = null;
let inFlightFor: string | null = null;
let currentUserId: string | null = null;

/** Last good overview, per user, on this device — shown instantly on the next launch while a fresh copy loads (stale-while-revalidate). */
const cacheKey = (userId: string) => `medart:cockpit-overview:${userId}`;

function readCachedOverview(userId: string): { overview: DashboardOverview; savedAt: number } | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const { overview, savedAt } = parsed as { overview?: DashboardOverview; savedAt?: number };
    if (!overview || typeof overview !== "object" || !Array.isArray(overview.courses) || typeof savedAt !== "number") return null;
    return { overview, savedAt };
  } catch {
    return null;
  }
}

function writeCachedOverview(userId: string, overview: DashboardOverview): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ overview, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked: the in-memory copy still serves this session.
  }
}

export const useCockpitStore = create<CockpitState>()((set, get) => ({
  overview: null,
  status: "idle",
  lastSyncedAt: null,
  error: null,
  refresh: async (options) => {
    const { lastSyncedAt } = get();
    if (!options?.force && lastSyncedAt && Date.now() - lastSyncedAt < MIN_REFRESH_INTERVAL_MS) return;
    if (inFlight && inFlightFor === currentUserId) return inFlight;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      set({ status: "offline" });
      return;
    }
    set({ status: "syncing" });
    const requestedFor = currentUserId;
    inFlightFor = requestedFor;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    inFlight = (async () => {
      try {
        const res = await fetch("/api/dashboard/overview", { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.error ?? `HTTP ${res.status}`);
        // Account switched while this was in flight: drop the stale answer.
        if (requestedFor !== currentUserId) return;
        const overview = body.overview as DashboardOverview;
        set({ overview, status: "synced", lastSyncedAt: Date.now(), error: null });
        if (requestedFor) writeCachedOverview(requestedFor, overview);
      } catch (error) {
        if (requestedFor !== currentUserId) return;
        const aborted = error instanceof DOMException && error.name === "AbortError";
        // The cached overview (if any) stays on screen; only the sync indicator changes.
        set({ status: "error", error: aborted ? "Délai dépassé." : error instanceof Error ? error.message : "Erreur inconnue." });
      } finally {
        clearTimeout(timeoutId);
        inFlight = null;
      }
    })();
    return inFlight;
  },
  reset: () => set({ overview: null, status: "idle", lastSyncedAt: null, error: null }),
}));

/**
 * Mount ONCE (the dashboard shell layout): first load for a signed-in user,
 * refresh on focus / reconnect, reset on sign-out or account switch.
 */
export function useCockpitSync(userId: string | null): void {
  useEffect(() => {
    const { refresh, reset } = useCockpitStore.getState();
    reset();
    currentUserId = userId;
    if (!userId) return;
    // Instant paint from the last session, then revalidate in the background.
    const cached = readCachedOverview(userId);
    if (cached) useCockpitStore.setState({ overview: cached.overview });
    void refresh({ force: true });

    const onFocus = () => void useCockpitStore.getState().refresh();
    const onOnline = () => void useCockpitStore.getState().refresh({ force: true });
    const onOffline = () => useCockpitStore.setState({ status: "offline" });
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [userId]);
}
