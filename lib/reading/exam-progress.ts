"use client";

import { deleteSyncDoc, putSyncDoc, reconcileValue, type SyncedValue } from "@/lib/user-sync";

/**
 * An Examen de module sitting in progress — the answers ticked so far and the
 * question on screen — so leaving the page, closing the app or switching
 * device never throws the student's work away. Kept per account in this
 * browser and in the sync store (namespace "exam-progress", one document per
 * exam); the newest copy wins. Cleared once the attempt is saved.
 */

export const EXAM_PROGRESS_NS = "exam-progress";

export interface ExamProgress {
  answers: Record<string, string | null>;
  index: number;
}

function storageKey(userId: string, examId: string): string {
  return `medart:exam-progress:${userId}:${examId}`;
}

function isExamProgress(value: unknown): value is ExamProgress {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  if (typeof p.index !== "number" || !Number.isInteger(p.index) || p.index < 0) return false;
  if (!p.answers || typeof p.answers !== "object" || Array.isArray(p.answers)) return false;
  return Object.values(p.answers as Record<string, unknown>).every((answer) => answer === null || (typeof answer === "string" && answer.length <= 64));
}

function isSyncedProgress(value: unknown): value is SyncedValue<ExamProgress> {
  return Boolean(value && typeof value === "object" && typeof (value as SyncedValue<unknown>).savedAt === "number" && isExamProgress((value as SyncedValue<unknown>).value));
}

export function readExamProgress(userId: string, examId: string): SyncedValue<ExamProgress> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, examId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSyncedProgress(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveExamProgress(userId: string, examId: string, progress: ExamProgress): void {
  const synced: SyncedValue<ExamProgress> = { value: progress, savedAt: Date.now() };
  try {
    window.localStorage.setItem(storageKey(userId, examId), JSON.stringify(synced));
  } catch {
    // Storage full or blocked: the server copy still has it.
  }
  putSyncDoc(EXAM_PROGRESS_NS, examId, synced);
}

export function clearExamProgress(userId: string, examId: string): void {
  try {
    window.localStorage.removeItem(storageKey(userId, examId));
  } catch {
    // Nothing to clear.
  }
  deleteSyncDoc(EXAM_PROGRESS_NS, examId);
}

/** The newest of this browser's copy and the account's (uploading this one when it is newer); null offline or when neither exists. */
export async function resolveExamProgress(examId: string, local: SyncedValue<ExamProgress> | null): Promise<SyncedValue<ExamProgress> | null> {
  const winner = await reconcileValue<ExamProgress>(EXAM_PROGRESS_NS, examId, local);
  return winner && isExamProgress(winner.value) ? winner : null;
}
