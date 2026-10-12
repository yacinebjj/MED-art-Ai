"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { readCachedOverview, useCockpitStore } from "@/store/useCockpitStore";
import { markLaunchWarmed, needsLaunchWarmup, useAppWarmup, WARMUP_MAX_MS } from "@/lib/pwa/app-warmup";
import { warmGet } from "@/lib/pwa/warm-fetch";
import type { DashboardOverview } from "@/types/dashboard-overview";

/** Every page reachable from the Sidebar / mobile dock. The mobile dock's "more" menu and the desktop Sidebar (display:none on phones) never get a viewport-triggered <Link> prefetch, so they are prefetched here instead. */
const NAV_ROUTES = [
  "/dashboard",
  "/dashboard/assistant",
  "/dashboard/study",
  "/dashboard/notes",
  "/dashboard/todo",
  "/dashboard/groups",
  "/dashboard/billing",
  "/dashboard/settings",
];

/** Modules whose workspace code + payload are prefetched, and whose first data requests are warmed. */
const MAX_MODULE_ROUTES = 3;
const MAX_MODULE_DATA = 2;
const OVERVIEW_WAIT_MS = 1_500;

/**
 * Chunks the module workspace opens most (Studio tiles, upload). Same import
 * specifiers as app/dashboard/module/[id]/page.tsx so webpack serves the
 * very same chunks — loading them here makes the first tile open instant.
 */
const CRITICAL_CHUNKS: (() => Promise<unknown>)[] = [
  () => import("@/components/course/workspace/GastriteResumeStudio"),
  () => import("@/components/course/workspace/GastriteCasCliniqueStudio"),
  () => import("@/components/course/workspace/GastriteQcmsStudio"),
  () => import("@/components/course/workspace/ClinicalRelevanceStudio"),
  () => import("@/components/course/workspace/analogies/AnalogyCanvas"),
  () => import("@/components/dashboard/UploadModal"),
];

/** Heavier, less frequent screens: loaded only after the app is shown, in idle time, and never on a data-saver / 2G connection. */
const IDLE_CHUNKS: (() => Promise<unknown>)[] = [
  () => import("@/components/course-viewer").then((m) => m.preloadCourseViewer()),
  () => import("@/components/course/workspace/os/CommandPalette"),
  () => import("@/components/dashboard/CourseStatsModal"),
  () => import("@/components/course/workspace/AudioPodcastViewer"),
  () => import("@/components/course/workspace/lab/ClinicalCaseSimulator"),
  () => import("@/components/course/workspace/lab/MedicalMatrixStudio"),
  () => import("@/components/course/workspace/lab/MindMapLab"),
];

function isConstrainedNetwork(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData) || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once no new resource has finished loading for `quietMs` (prefetches are fire-and-forget, so this is how their completion is observed). */
async function waitForNetworkQuiet(quietMs: number, deadline: number): Promise<void> {
  let lastCount = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const count = performance.getEntriesByType("resource").length;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
    await sleep(150);
  }
}

function recentModuleIds(overview: DashboardOverview | null): number[] {
  if (!overview) return [];
  const ids: number[] = [];
  const courses = [...overview.courses].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const course of courses) {
    if (Number.isFinite(course.moduleId) && !ids.includes(course.moduleId)) ids.push(course.moduleId);
    if (ids.length >= MAX_MODULE_ROUTES) break;
  }
  return ids;
}

async function waitForOverview(userId: string): Promise<DashboardOverview | null> {
  const deadline = Date.now() + OVERVIEW_WAIT_MS;
  while (Date.now() < deadline) {
    const { overview } = useCockpitStore.getState();
    if (overview) return overview;
    const cached = readCachedOverview(userId);
    if (cached) return cached.overview;
    await sleep(100);
  }
  return useCockpitStore.getState().overview;
}

function scheduleIdle(task: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(task, { timeout: 4_000 });
  else setTimeout(task, 1_500);
}

/**
 * Once per app launch, while the splash (components/layout/SplashScreen.tsx)
 * is still up: waits for the session, prefetches every dashboard page and the
 * student's most recent module workspaces, downloads the Studio chunks and
 * warms the first module's data. When the splash leaves, navigating anywhere
 * in the app no longer waits on code. Bounded by WARMUP_MAX_MS — the app is
 * shown at the cap even if the network is slow; warming then continues in
 * the background.
 */
export function AppWarmup() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const authRef = useRef<{ promise: Promise<string | null>; resolve: (id: string | null) => void } | null>(null);
  if (!authRef.current) {
    let resolve: (id: string | null) => void = () => {};
    const promise = new Promise<string | null>((r) => {
      resolve = r;
    });
    authRef.current = { promise, resolve };
  }

  useEffect(() => {
    if (!loading) authRef.current?.resolve(user?.id ?? null);
  }, [loading, user]);

  useEffect(() => {
    const warmup = useAppWarmup.getState();
    const constrained = isConstrainedNetwork();

    if (!needsLaunchWarmup()) {
      warmup.finish();
      return;
    }

    const criticalChunks = constrained ? [] : CRITICAL_CHUNKS;
    // auth + overview + routes + each critical chunk
    warmup.begin(3 + criticalChunks.length);
    const deadline = Date.now() + WARMUP_MAX_MS;
    let cancelled = false;

    const run = async () => {
      const userId = await authRef.current!.promise;
      useAppWarmup.getState().step();
      if (!userId || cancelled) return;

      const overview = await waitForOverview(userId);
      useAppWarmup.getState().step();
      if (cancelled) return;

      const moduleIds = recentModuleIds(overview);
      for (const route of NAV_ROUTES) router.prefetch(route);
      for (const id of moduleIds) router.prefetch(`/dashboard/module/${id}`);
      for (const id of moduleIds.slice(0, MAX_MODULE_DATA)) {
        warmGet(`/api/curriculum/modules/${id}`);
        warmGet(`/api/studio/courses?moduleId=${id}`);
      }
      if (moduleIds.length > 0) warmGet("/api/srs/course-mastery");

      await Promise.all([
        ...criticalChunks.map((load) =>
          load()
            .catch(() => undefined)
            .finally(() => useAppWarmup.getState().step())
        ),
        waitForNetworkQuiet(400, deadline).then(() => useAppWarmup.getState().step()),
      ]);
    };

    void Promise.race([run(), sleep(WARMUP_MAX_MS)]).finally(() => {
      if (cancelled) return;
      markLaunchWarmed();
      useAppWarmup.getState().finish();
      if (!constrained) {
        scheduleIdle(() => {
          for (const load of IDLE_CHUNKS) void load().catch(() => undefined);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
