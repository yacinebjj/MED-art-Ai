/**
 * Per-course supply of QCMs harvested from real exam-shortfall generations —
 * see exam_harvested_qcms' own comment in supabase/schema.sql for the full
 * design (why this is per-course rather than per-course-set like
 * exam_content_variations, and why it's a separate table from
 * studio_courses.qcms). Stores/reads the exact same QcmItem shape
 * lib/exam-pooling.ts's convertIfCompatible already validates, so a harvested
 * row is treated identically to an organic Studio QCM at pool-read time.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { QcmItem } from "@/lib/types";

/** Fail-open: any Supabase error resolves to `[]` — a lookup failure must never block exam generation, only skip the optimization (the course's shortfall is simply generated fresh instead). */
export async function lookupHarvestedQcms(courseIds: number[]): Promise<Map<number, QcmItem[]>> {
  const byCourseId = new Map<number, QcmItem[]>();
  if (!isSupabaseConfigured() || courseIds.length === 0) return byCourseId;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from("exam_harvested_qcms").select("course_id, qcm").in("course_id", courseIds);

    if (error) {
      console.error("[exam-harvested-qcms:lookup] Échec lecture — pool ignoré pour ce cours:", error.message);
      return byCourseId;
    }
    for (const row of (data ?? []) as { course_id: number; qcm: unknown }[]) {
      // Defensive: `qcm` is jsonb, so the JSON literal `null` (distinct from
      // SQL NULL, which the column's `not null` already excludes) or any
      // non-object would otherwise reach convertIfCompatible and throw —
      // failing the ENTIRE exam request instead of just skipping one bad
      // row, the same fail-open guarantee every other read in this app makes.
      if (!row.qcm || typeof row.qcm !== "object") continue;
      const list = byCourseId.get(row.course_id) ?? [];
      list.push(row.qcm as QcmItem);
      byCourseId.set(row.course_id, list);
    }
    return byCourseId;
  } catch (error) {
    console.error("[exam-harvested-qcms:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return byCourseId;
  }
}

/** Fail-open, fire-and-forget from the caller's perspective: a write failure is logged, never thrown — the exam the student is waiting on has already succeeded by the time this runs. */
export async function storeHarvestedQcm(courseId: number, qcm: QcmItem): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("exam_harvested_qcms").insert({ course_id: courseId, qcm });
    if (error) console.error("[exam-harvested-qcms:store] Échec écriture (non bloquant):", error.message);
  } catch (error) {
    console.error("[exam-harvested-qcms:store] Échec écriture — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
