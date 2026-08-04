/**
 * Classic Leitner spaced-repetition scheduling — pure functions, no I/O, so
 * the scheduling math itself is trivially unit-testable independent of
 * whatever table ends up storing the state (see app/api/srs/attempt/route.ts
 * for the Supabase-backed wrapper).
 */

export const MAX_LEITNER_BOX = 5;

/** Review interval per box, in days. Box 1 = missed/new, box 5 = mastered. */
export const LEITNER_INTERVAL_DAYS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
};

export interface SrsState {
  leitnerBox: number;
  nextReviewAt: Date;
}

/**
 * A correct answer promotes the card to the next box (capped at
 * MAX_LEITNER_BOX) and schedules a longer review interval. Any wrong answer
 * drops it straight back to box 1, regardless of how far it had progressed —
 * the standard Leitner rule: a lapse means the card wasn't actually
 * mastered, so it re-enters the shortest cycle rather than merely stepping
 * back one box.
 */
export function computeNextReview(currentBox: number, isCorrect: boolean, now: Date = new Date()): SrsState {
  const nextBox = isCorrect ? Math.min(currentBox + 1, MAX_LEITNER_BOX) : 1;
  const intervalDays = LEITNER_INTERVAL_DAYS[nextBox];
  const nextReviewAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return { leitnerBox: nextBox, nextReviewAt };
}
