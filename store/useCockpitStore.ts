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
let inFlight: Promise<void> | null = null;

export const useCockpitStore = create<CockpitState>()((set, get) => ({
  overview: null,
  status: "idle",
  lastSyncedAt: null,
  error: null,
  refresh: async (options) => {
    const { lastSyncedAt } = get();
    if (!options?.force && lastSyncedAt && Date.now() - lastSyncedAt < MIN_REFRESH_INTERVAL_MS) return;
    if (inFlight) return inFlight;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      set({ status: "offline" });
      return;
    }
    set({ status: "syncing" });
    inFlight = (async () => {
      try {
        const res = await fetch("/api/dashboard/overview", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.error ?? `HTTP ${res.status}`);
        set({ overview: body.overview as DashboardOverview, status: "synced", lastSyncedAt: Date.now(), error: null });
      } catch (error) {
        set({ status: "error", error: error instanceof Error ? error.message : "Erreur inconnue." });
      } finally {
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
    if (!userId) return;
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
