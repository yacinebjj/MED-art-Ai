"use client";

/**
 * What the student had open in a module's workspace — the course, the Studio
 * section or Lab tool, the phone tab — so coming back to the module puts them
 * back in front of the same thing (and useReadingSurface then scrolls it to
 * where they were). Per account and module, in this browser only.
 */

export interface WorkspaceReadingState {
  courseId: number;
  section: string | null;
  lab: string | null;
  tab: string | null;
  savedAt: number;
}

function storageKey(userId: string, moduleId: number): string {
  return `medart:ws-reading:${userId}:${moduleId}`;
}

export function readWorkspaceState(userId: string, moduleId: number): WorkspaceReadingState | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, moduleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceReadingState> | null;
    if (!parsed || typeof parsed.courseId !== "number" || !Number.isInteger(parsed.courseId)) return null;
    return {
      courseId: parsed.courseId,
      section: typeof parsed.section === "string" ? parsed.section : null,
      lab: typeof parsed.lab === "string" ? parsed.lab : null,
      tab: typeof parsed.tab === "string" ? parsed.tab : null,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeWorkspaceState(userId: string, moduleId: number, state: Omit<WorkspaceReadingState, "savedAt">): void {
  try {
    window.localStorage.setItem(storageKey(userId, moduleId), JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked: the workspace simply opens as usual next time.
  }
}
