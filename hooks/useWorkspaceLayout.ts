"use client";

import { useCallback, useEffect, useState } from "react";

export type WorkspaceDensity = "comfortable" | "compact";

export interface WorkspaceLayoutState {
  sourcesWidth: number;
  studioWidth: number;
  density: WorkspaceDensity;
}

export const SOURCES_WIDTH = { min: 240, max: 480, default: 304 } as const;
export const STUDIO_WIDTH = { min: 320, max: 760, default: 400 } as const;

const STORAGE_KEY = "medart:workspace-layout:v1";
const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  sourcesWidth: SOURCES_WIDTH.default,
  studioWidth: STUDIO_WIDTH.default,
  density: "comfortable",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStoredLayout(): WorkspaceLayoutState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<WorkspaceLayoutState>;
    return {
      sourcesWidth: typeof parsed.sourcesWidth === "number" ? clamp(parsed.sourcesWidth, SOURCES_WIDTH.min, SOURCES_WIDTH.max) : DEFAULT_LAYOUT.sourcesWidth,
      studioWidth: typeof parsed.studioWidth === "number" ? clamp(parsed.studioWidth, STUDIO_WIDTH.min, STUDIO_WIDTH.max) : DEFAULT_LAYOUT.studioWidth,
      density: parsed.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/**
 * The workspace's resizable 3-pane layout + density preference, remembered
 * per browser (a per-viewer convenience — nothing here needs to sync).
 * Starts from the defaults on the server render and swaps in the stored
 * values after mount, so SSR and the first client render always agree.
 */
export function useWorkspaceLayout() {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(DEFAULT_LAYOUT);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLayout(readStoredLayout());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Private mode / blocked storage — the layout still works for this visit.
    }
  }, [layout, hydrated]);

  const resizeSources = useCallback((deltaPx: number) => {
    setLayout((prev) => ({ ...prev, sourcesWidth: clamp(prev.sourcesWidth + deltaPx, SOURCES_WIDTH.min, SOURCES_WIDTH.max) }));
  }, []);

  const resizeStudio = useCallback((deltaPx: number) => {
    setLayout((prev) => ({ ...prev, studioWidth: clamp(prev.studioWidth + deltaPx, STUDIO_WIDTH.min, STUDIO_WIDTH.max) }));
  }, []);

  const resetSources = useCallback(() => setLayout((prev) => ({ ...prev, sourcesWidth: SOURCES_WIDTH.default })), []);
  const resetStudio = useCallback(() => setLayout((prev) => ({ ...prev, studioWidth: STUDIO_WIDTH.default })), []);
  const setDensity = useCallback((density: WorkspaceDensity) => setLayout((prev) => ({ ...prev, density })), []);

  return { layout, resizeSources, resizeStudio, resetSources, resetStudio, setDensity };
}
