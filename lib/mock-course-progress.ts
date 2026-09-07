/**
 * Demonstration seed for the dual performance indicator on individual course
 * cards ("Mes Cours Récents") — NOT a permanent data source, and never
 * allowed to override real data:
 *
 * - Reading progress has zero real tracking anywhere in the app yet (no
 *   "course viewed" table/instrumentation exists). Every entry here is a
 *   placeholder until that ships.
 * - QCM/exam-readiness and SRS/memorization DO have a real mechanism
 *   (qcm_attempts, aggregated per course by the `course_mastery` SQL
 *   function — see app/api/srs/course-mastery/route.ts). Both entries below
 *   are only ever used as a fallback for a course with zero real attempts
 *   recorded — the moment a student actually answers QCMs in that course,
 *   the real mastery_pct/avg_leitner_box take over and these stop being
 *   read at all.
 *
 * Keyed by the exact course slug (not a module name — this now lives at the
 * course level, not the module level). "3-la-pleuresie-purulente-support-du-
 * dr-firan-1785259421242" is the Pleurésie course used to demo this feature,
 * since its QCMs were the ones actually exercised while building this.
 */
import { PLEURESIE_DEMO_SLUG } from "@/lib/constants";

export const MOCK_READING_PROGRESS_BY_COURSE_SLUG: Record<string, number> = {
  [PLEURESIE_DEMO_SLUG]: 85,
};

export const MOCK_QCM_FALLBACK_BY_COURSE_SLUG: Record<string, number> = {
  [PLEURESIE_DEMO_SLUG]: 78,
};

/** SRS/memorization % fallback — normalized avg_leitner_box, see the Statistiques modal. */
export const MOCK_SRS_MASTERY_FALLBACK_BY_COURSE_SLUG: Record<string, number> = {
  [PLEURESIE_DEMO_SLUG]: 64,
};
