/**
 * Per-device dashboard state kept in localStorage (always scoped by user id,
 * so a shared computer never mixes two students). Every read is defensive:
 * storage can be blocked, full, or hold a value from an older format.
 */

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
// Last opened course (module workspace → dashboard "Reprendre la révision")

export interface LastOpenedCourse {
  courseId: number;
  moduleId: number;
  title: string;
  openedAt: string;
}

const lastCourseKey = (userId: string) => `medart:last-opened-course:${userId}`;

export function recordLastOpenedCourse(userId: string, course: Omit<LastOpenedCourse, "openedAt">): void {
  write(lastCourseKey(userId), { ...course, openedAt: new Date().toISOString() });
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

const customExamKey = (userId: string) => `medart:custom-exam:${userId}`;

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
    return;
  }
  write(customExamKey(userId), exam);
}

// ---------------------------------------------------------------------------
// Daily focus goal (minutes)

export const DEFAULT_DAILY_GOAL_MINUTES = 90;
const dailyGoalKey = (userId: string) => `medart:daily-goal-minutes:${userId}`;

export function readDailyGoalMinutes(userId: string): number {
  const value = read(dailyGoalKey(userId), (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 10 && v <= 720);
  return value ?? DEFAULT_DAILY_GOAL_MINUTES;
}

export function writeDailyGoalMinutes(userId: string, minutes: number): void {
  write(dailyGoalKey(userId), Math.min(720, Math.max(10, Math.round(minutes))));
}

// ---------------------------------------------------------------------------
// Daily clinical pearl — the answer given today (so a reload keeps the reveal)

const pearlKey = (userId: string) => `medart:pearl-answer:${userId}`;

export function readPearlAnswer(userId: string, day: string, pearlId: string): number | null {
  const value = read(pearlKey(userId), (v): v is { day: string; pearlId: string; choice: number } =>
    isRecord(v) && typeof v.day === "string" && typeof v.pearlId === "string" && typeof v.choice === "number"
  );
  return value && value.day === day && value.pearlId === pearlId ? value.choice : null;
}

export function writePearlAnswer(userId: string, day: string, pearlId: string, choice: number): void {
  write(pearlKey(userId), { day, pearlId, choice });
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
