/**
 * Flashcard reminder cadence — shared by the push dispatcher (server), the
 * profile API and the Paramètres page. Stored in
 * profiles.flashcard_push_interval_minutes (migration
 * 20261004_flashcard_push_cadence.sql).
 */
export const FLASHCARD_PUSH_INTERVALS = [60, 120, 240] as const;
export type FlashcardPushInterval = (typeof FLASHCARD_PUSH_INTERVALS)[number];
export const DEFAULT_FLASHCARD_PUSH_INTERVAL: FlashcardPushInterval = 60;

export function isFlashcardPushInterval(value: unknown): value is FlashcardPushInterval {
  return typeof value === "number" && (FLASHCARD_PUSH_INTERVALS as readonly number[]).includes(value);
}

export function normalizeFlashcardPushInterval(value: unknown): FlashcardPushInterval {
  return isFlashcardPushInterval(value) ? value : DEFAULT_FLASHCARD_PUSH_INTERVAL;
}
