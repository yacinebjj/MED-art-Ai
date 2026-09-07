/**
 * Deterministic module -> color mapping for note badges. curriculum_modules
 * has no color column of its own, so this maps a REAL module id (never a
 * fabricated value) onto a fixed, pleasant palette via a plain modulo — same
 * module id always renders the same color, no hashing/randomness needed
 * since the id is already a stable integer.
 */
const MODULE_BADGE_PALETTE = [
  { bg: "bg-violet-500/15", text: "text-violet-600 dark:text-violet-300", dot: "bg-violet-500" },
  { bg: "bg-sky-500/15", text: "text-sky-600 dark:text-sky-300", dot: "bg-sky-500" },
  { bg: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-300", dot: "bg-emerald-500" },
  { bg: "bg-rose-500/15", text: "text-rose-600 dark:text-rose-300", dot: "bg-rose-500" },
  { bg: "bg-cyan-500/15", text: "text-cyan-600 dark:text-cyan-300", dot: "bg-cyan-500" },
  { bg: "bg-fuchsia-500/15", text: "text-fuchsia-600 dark:text-fuchsia-300", dot: "bg-fuchsia-500" },
  { bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-300", dot: "bg-orange-500" },
];

export function moduleBadgeColors(moduleId: number) {
  return MODULE_BADGE_PALETTE[moduleId % MODULE_BADGE_PALETTE.length];
}
