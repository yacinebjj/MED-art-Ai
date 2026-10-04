/**
 * Per-device dashboard state kept in localStorage (always scoped by user id,
 * so a shared computer never mixes two students). Every read is defensive:
 * storage can be blocked, full, or hold a value from an older format.
 *
 * The values the student sets themself (custom exam, daily goal, pearl
 * answer, last opened course) are also mirrored to the cross-device sync
 * store (lib/user-sync.ts, namespace "activity") — see
 * hydrateLocalActivityFromServer below. localStorage stays the source every
 * reader uses; when sync is unavailable nothing changes.
 */

import { fetchSyncNamespace, putSyncDoc, type SyncedValue } from "@/lib/user-sync";

function read<T>(key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the feature simply isn't remembered.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Cross-device sync of the student-set values

const SYNC_NS = "activity";

/** Fired on `window` after hydrateLocalActivityFromServer changed localStorage — readers re-read then. */
export const LOCAL_ACTIVITY_SYNCED_EVENT = "medart:local-activity-synced";

type SyncedActivityKey = "custom-exam" | "daily-goal-minutes" | "pearl-answer" | "last-opened-course";

const SYNCED_ACTIVITY_KEYS: SyncedActivityKey[] = ["custom-exam", "daily-goal-minutes", "pearl-answer", "last-opened-course"];

const activityStorageKey = (syncKey: SyncedActivityKey, userId: string) => `medart:${syncKey}:${userId}`;

/** When each synced value last changed on this device (ms) — values written before sync existed have none (treated as 0). */
const savedAtKey = (userId: string) => `medart:activity-saved-at:${userId}`;

function readSavedAtMap(userId: string): Partial<Record<SyncedActivityKey, number>> {
  const map = read(savedAtKey(userId), isRecord);
  if (!map) return {};
  const result: Partial<Record<SyncedActivityKey, number>> = {};
  for (const key of SYNCED_ACTIVITY_KEYS) {
    const value = map[key];
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function writeSavedAt(userId: string, syncKey: SyncedActivityKey, savedAt: number): void {
  write(savedAtKey(userId), { ...readSavedAtMap(userId), [syncKey]: savedAt });
}

/** Mirrors a local write to the server. `null` = cleared (kept as a value, not a tombstone, so "newest wins" also covers clearing). */
function syncWrite(userId: string, syncKey: SyncedActivityKey, value: unknown): void {
  const savedAt = Date.now();
  writeSavedAt(userId, syncKey, savedAt);
  const doc: SyncedValue<unknown> = { value, savedAt };
  putSyncDoc(SYNC_NS, syncKey, doc);
}

/** Subscribes to LOCAL_ACTIVITY_SYNCED_EVENT; returns the unsubscribe (fits a useEffect cleanup). */
export function onLocalActivitySynced(callback: () => void): () => void {
  window.addEventListener(LOCAL_ACTIVITY_SYNCED_EVENT, callback);
  return () => window.removeEventListener(LOCAL_ACTIVITY_SYNCED_EVENT, callback);
}

function readRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Reconciles every synced value with the server, newest `savedAt` wins on
 * each side (a newer local value is uploaded, a newer remote one replaces
 * localStorage). Returns whether localStorage changed — false too when sync
 * is unavailable (then everything stays exactly as it was).
 * When it changed, LOCAL_ACTIVITY_SYNCED_EVENT is dispatched on `window`.
 */
export async function hydrateLocalActivityFromServer(userId: string): Promise<boolean> {
  const docs = await fetchSyncNamespace(SYNC_NS);
  if (!docs) return false;
  const savedAtMap = readSavedAtMap(userId);
  let changed = false;
  let adopted = false;
  for (const syncKey of SYNCED_ACTIVITY_KEYS) {
    const storageKey = activityStorageKey(syncKey, userId);
    const localValue = readRaw(storageKey);
    const localSavedAt = savedAtMap[syncKey] ?? (localValue === null ? null : 0);
    const doc = docs.find((d) => d.key === syncKey && !d.deleted);
    const remote = doc && isRecord(doc.data) && typeof doc.data.savedAt === "number" ? (doc.data as unknown as SyncedValue<unknown>) : null;

    if (localSavedAt !== null && (!remote || localSavedAt > remote.savedAt)) {
      const upload: SyncedValue<unknown> = { value: localValue, savedAt: localSavedAt };
      putSyncDoc(SYNC_NS, syncKey, upload, true);
      continue;
    }
    if (!remote || remote.savedAt === localSavedAt) continue;
    const remoteValue = remote.value ?? null;
    if (remoteValue === null) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
    } else {
      write(storageKey, remoteValue);
    }
    savedAtMap[syncKey] = remote.savedAt;
    adopted = true;
    if (JSON.stringify(remoteValue) !== JSON.stringify(localValue)) changed = true;
  }
  if (adopted) write(savedAtKey(userId), savedAtMap);
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_ACTIVITY_SYNCED_EVENT, { detail: { userId } }));
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Last opened course (module workspace → dashboard "Reprendre la révision")

export interface LastOpenedCourse {
  courseId: number;
  moduleId: number;
  title: string;
  openedAt: string;
}

const lastCourseKey = (userId: string) => activityStorageKey("last-opened-course", userId);

export function recordLastOpenedCourse(userId: string, course: Omit<LastOpenedCourse, "openedAt">): void {
  const value = { ...course, openedAt: new Date().toISOString() };
  write(lastCourseKey(userId), value);
  syncWrite(userId, "last-opened-course", value);
}

export function readLastOpenedCourse(userId: string): LastOpenedCourse | null {
  return read(lastCourseKey(userId), (value): value is LastOpenedCourse =>
    isRecord(value) && typeof value.courseId === "number" && typeof value.moduleId === "number" && typeof value.title === "string" && typeof value.openedAt === "string"
  );
}

// ---------------------------------------------------------------------------
// Flashcard session (written by components/study/ActiveFlashcardsDeck.tsx)

export interface FlashcardSessionSummary {
  /** Cards graded "je savais" in the current session. */
  correct: number;
  /** Cards graded "à revoir" in the current session. */
  incorrect: number;
  /** Cards left in the current batch. */
  remainingInBatch: number;
  reviewedTotal: number;
  round: number;
}

const FLASHCARD_SESSION_PREFIX = "medart:flashcards-session:";

export function readFlashcardSession(userId: string): FlashcardSessionSummary | null {
  try {
    const prefix = `${FLASHCARD_SESSION_PREFIX}${userId}:`;
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith(prefix));
    if (!key) return null;
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!isRecord(parsed) || !Array.isArray(parsed.deck) || typeof parsed.index !== "number" || !isRecord(parsed.score)) return null;
    const correct = Number(parsed.score.correct) || 0;
    const incorrect = Number(parsed.score.incorrect) || 0;
    return {
      correct,
      incorrect,
      remainingInBatch: Math.max(0, parsed.deck.length - parsed.index),
      reviewedTotal: Number(parsed.reviewedTotal) || correct + incorrect,
      round: Number(parsed.round) || 1,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Custom exam date (used when the student has no study plan with an exam date)

export interface CustomExam {
  label: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** When the countdown was set — the start of the "time to revise" bar. */
  setAt: string;
}

const customExamKey = (userId: string) => activityStorageKey("custom-exam", userId);

export function readCustomExam(userId: string): CustomExam | null {
  return read(customExamKey(userId), (value): value is CustomExam =>
    isRecord(value) && typeof value.label === "string" && typeof value.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && typeof value.setAt === "string"
  );
}

export function writeCustomExam(userId: string, exam: CustomExam | null): void {
  if (exam === null) {
    try {
      localStorage.removeItem(customExamKey(userId));
    } catch {
      // ignore
    }
    syncWrite(userId, "custom-exam", null);
    return;
  }
  write(customExamKey(userId), exam);
  syncWrite(userId, "custom-exam", exam);
}

// ---------------------------------------------------------------------------
// Daily focus goal (minutes)

export const DEFAULT_DAILY_GOAL_MINUTES = 90;
const dailyGoalKey = (userId: string) => activityStorageKey("daily-goal-minutes", userId);

export function readDailyGoalMinutes(userId: string): number {
  const value = read(dailyGoalKey(userId), (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 10 && v <= 720);
  return value ?? DEFAULT_DAILY_GOAL_MINUTES;
}

export function writeDailyGoalMinutes(userId: string, minutes: number): void {
  const value = Math.min(720, Math.max(10, Math.round(minutes)));
  write(dailyGoalKey(userId), value);
  syncWrite(userId, "daily-goal-minutes", value);
}

// ---------------------------------------------------------------------------
// Daily clinical pearl — the answer given today (so a reload keeps the reveal)

const pearlKey = (userId: string) => activityStorageKey("pearl-answer", userId);

export function readPearlAnswer(userId: string, day: string, pearlId: string): number | null {
  const value = read(pearlKey(userId), (v): v is { day: string; pearlId: string; choice: number } =>
    isRecord(v) && typeof v.day === "string" && typeof v.pearlId === "string" && typeof v.choice === "number"
  );
  return value && value.day === day && value.pearlId === pearlId ? value.choice : null;
}

export function writePearlAnswer(userId: string, day: string, pearlId: string, choice: number): void {
  const value = { day, pearlId, choice };
  write(pearlKey(userId), value);
  syncWrite(userId, "pearl-answer", value);
}

// ---------------------------------------------------------------------------
// Notifications already read (ids of derived notifications)

const readNotificationsKey = (userId: string) => `medart:notifications-read:${userId}`;

export function readSeenNotificationIds(userId: string): string[] {
  return read(readNotificationsKey(userId), (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string")) ?? [];
}

export function writeSeenNotificationIds(userId: string, ids: string[]): void {
  write(readNotificationsKey(userId), ids.slice(-200));
}
