/**
 * Pure data shapes + scoring math for the "Statistiques" modal
 * (components/dashboard/CourseStatsModal.tsx) — kept separate from the
 * component so the weighting formula is easy to find, adjust, and unit-test
 * without touching any React/animation code.
 */

export interface CourseStats {
  /** QCM success rate for this course — real (qcm_attempts via `course_mastery`), demo-seeded only when a course has zero real attempts. */
  qcmSuccessPct: number | undefined;
  /** SRS/memorization index — real (avg Leitner box, normalized 0-100), same fallback rule as above. */
  srsMasteryPct: number | undefined;
  /** Chapter reading/study progress — always a demo seed today (see lib/mock-course-progress.ts); no real per-user reading tracking exists yet. */
  readingPct: number | undefined;
}

/** Relative weight of each sub-metric in the global radial score — QCM success is the heaviest signal, matching the app's established "QCMs are the real test of mastery" philosophy. */
const WEIGHTS = {
  qcmSuccessPct: 0.55,
  srsMasteryPct: 0.25,
  readingPct: 0.2,
} as const;

/**
 * Weighted average of whichever sub-metrics are actually defined, with the
 * remaining weights renormalized so a course missing one signal (most
 * commonly `srsMasteryPct`/`qcmSuccessPct` before any QCM has been
 * attempted) doesn't get unfairly dragged down by a phantom zero. Returns
 * `undefined` only when EVERY metric is missing — an honest "not enough
 * data yet" rather than a fabricated score.
 */
export function computeGlobalScore(stats: CourseStats): number | undefined {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const key of Object.keys(WEIGHTS) as (keyof CourseStats)[]) {
    const value = stats[key];
    if (value === undefined) continue;
    const weight: number = WEIGHTS[key];
    totalWeight += weight;
    weightedSum += value * weight;
  }

  if (totalWeight === 0) return undefined;
  return weightedSum / totalWeight;
}

/** Dynamic color tier for the radial score, per spec: emerald > 80, blue > 50, orange otherwise. */
export function scoreColorTier(pct: number): "emerald" | "blue" | "orange" {
  if (pct > 80) return "emerald";
  if (pct > 50) return "blue";
  return "orange";
}
