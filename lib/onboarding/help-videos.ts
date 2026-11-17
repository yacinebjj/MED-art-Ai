import type { TourId } from "@/lib/onboarding/tour-ids";

/**
 * The pages and tools that have a micro-tutorial video: a « ▶ » button next
 * to their « ? » guide button (components/onboarding/HelpVideoButton.tsx).
 * Only the ids live here, so a page pays a few bytes for them. The clips'
 * texts (lib/onboarding/help-video-content.ts), the player and the video
 * files (public/help/) load on the first tap, never with the page.
 */
export const HELP_VIDEO_TOURS = ["dashboard", "module", "tool-qcm", "exam", "assistant", "study", "billing"] as const satisfies readonly TourId[];

const WITH_VIDEO: ReadonlySet<TourId> = new Set(HELP_VIDEO_TOURS);

/** Whether `tour` (a page or a Studio tool) has a micro-tutorial. */
export function hasHelpVideo(tour: TourId | null | undefined): tour is TourId {
  return tour != null && WITH_VIDEO.has(tour);
}
