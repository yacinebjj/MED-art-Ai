"use client";

import { create } from "zustand";
import type { LabToolId } from "@/lib/workspace-lab";

/** What the course/module picker opens for: a Lab tool on a course, or a module's mock exam. */
export type LauncherTarget = { kind: "lab"; tool: LabToolId } | { kind: "exam" };

/**
 * Overlays shared by the whole dashboard shell (Sidebar, Topbar, dashboard
 * cards can all open them; they are rendered once, in the shell layout).
 */
interface CockpitUiState {
  spotlightOpen: boolean;
  setSpotlightOpen: (open: boolean) => void;
  launcher: LauncherTarget | null;
  openLauncher: (target: LauncherTarget) => void;
  closeLauncher: () => void;
}

export const useCockpitUi = create<CockpitUiState>()((set) => ({
  spotlightOpen: false,
  setSpotlightOpen: (open) => set({ spotlightOpen: open }),
  launcher: null,
  openLauncher: (target) => set({ launcher: target, spotlightOpen: false }),
  closeLauncher: () => set({ launcher: null }),
}));
