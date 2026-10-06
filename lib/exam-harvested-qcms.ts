/**
 * Per-course supply of QCMs harvested from real exam-shortfall generations —
 * see exam_harvested_qcms' own comment in supabase/schema.sql for the full
 * design (why this is per-course rather than per-course-set like
 * exam_content_variations, and why it's a separate table from
 * studio_courses.qcms). Stores/reads the exact same QcmItem shape
 * lib/exam-pooling.ts's convertIfCompatible already validates, so a harvested
 * row is treated identically to an organic Studio QCM at pool-read time.
 *
 * CONTENT-ADDRESSED POOL (supabase/migrations/20261009_exam_harvest_content_hash.sql):
 * rows used to be reachable only through `course_id` — a per-student upload
 * id — so every student holding the SAME polycopié grew a private pool from
 * zero and paid again for questions another student's exam had already
 * produced. Rows now also carry `content_hash` (sha256 of the course's
 * normalized explication ?? raw_text — the same basis as the exam cache), and
 * a lookup matches either key, so one shared pool grows per course CONTENT.
 * Until that migration runs, the missing column is detected and the old
 * course_id-only behavior is used — never an error.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import type { QcmItem } from "@/lib/types";

export interface HarvestCourse {
  id: number;
  explication: string | null;
  raw_text: string;
}

export function harvestContentHash(course: HarvestCourse): string {
  return sha256(normalizeText(course.explication ?? course.raw_text));
}

let contentHashColumnMissing = false;

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204" || /content_hash/i.test(error.message ?? "");
}

/** Fail-open: any Supabase error resolves to an empty pool — a lookup failure must never block exam generation, only skip the optimization (the course's shortfall is simply generated fresh instead). */
export async function lookupHarvestedQcms(courses: HarvestCourse[]): Promise<Map<number, QcmItem[]>> {
  const byCourseId = new Map<number, QcmItem[]>();
  if (!isSupabaseConfigured() || courses.length === 0) return byCourseId;

  const hashByCourse = new Map(courses.map((course) => [course.id, harvestContentHash(course)]));
  const courseIds = courses.map((course) => course.id);
  const hashes = Array.from(new Set(hashByCourse.values()));

  try {
    const supabase = getSupabaseAdmin();
    type HarvestRow = { course_id: number; content_hash?: string | null; qcm: unknown };
    let rows: HarvestRow[] | null = null;

    if (!contentHashColumnMissing) {
      const { data, error } = await supabase
        .from("exam_harvested_qcms")
        .select("course_id, content_hash, qcm")
        .or(`course_id.in.(${courseIds.join(",")}),content_hash.in.(${hashes.join(",")})`)
        .limit(5000);
      if (error && isMissingColumn(error)) {
        contentHashColumnMissing = true;
      } else if (error) {
        console.error("[exam-harvested-qcms:lookup] Échec lecture — pool ignoré pour ce cours:", error.message);
        return byCourseId;
      } else {
        rows = data as unknown as HarvestRow[];
      }
    }
    if (rows === null) {
      const { data, error } = await supabase.from("exam_harvested_qcms").select("course_id, qcm").in("course_id", courseIds);
      if (error) {
        console.error("[exam-harvested-qcms:lookup] Échec lecture — pool ignoré pour ce cours:", error.message);
        return byCourseId;
      }
      rows = data as unknown as HarvestRow[];
    }

    // A row belongs to every selected course it matches by id OR by content;
    // the same question harvested twice (two students' exams) is kept once.
    const seenByCourse = new Map<number, Set<string>>();
    for (const row of rows ?? []) {
      // Defensive: `qcm` is jsonb, so the JSON literal `null` (distinct from
      // SQL NULL, which the column's `not null` already excludes) or any
      // non-object would otherwise reach convertIfCompatible and throw —
      // failing the ENTIRE exam request instead of just skipping one bad
      // row, the same fail-open guarantee every other read in this app makes.
      if (!row.qcm || typeof row.qcm !== "object") continue;
      const questionKey = normalizeText(String((row.qcm as { question?: unknown }).question ?? JSON.stringify(row.qcm)));
      for (const course of courses) {
        if (row.course_id !== course.id && (!row.content_hash || row.content_hash !== hashByCourse.get(course.id))) continue;
        const seen = seenByCourse.get(course.id) ?? new Set<string>();
        if (seen.has(questionKey)) continue;
        seen.add(questionKey);
        seenByCourse.set(course.id, seen);
        const list = byCourseId.get(course.id) ?? [];
        list.push(row.qcm as QcmItem);
        byCourseId.set(course.id, list);
      }
    }
    return byCourseId;
  } catch (error) {
    console.error("[exam-harvested-qcms:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return byCourseId;
  }
}

/** Fail-open: a write failure is logged, never thrown — the exam that triggered this harvest already succeeded and must not be blocked by a side-effect write failing. */
export async function storeHarvestedQcm(course: HarvestCourse, qcm: QcmItem): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    if (!contentHashColumnMissing) {
      const { error } = await supabase.from("exam_harvested_qcms").insert({ course_id: course.id, content_hash: harvestContentHash(course), qcm });
      if (!error) return;
      if (!isMissingColumn(error)) {
        console.error("[exam-harvested-qcms:store] Échec écriture (non bloquant):", error.message);
        return;
      }
      contentHashColumnMissing = true;
    }
    const { error } = await supabase.from("exam_harvested_qcms").insert({ course_id: course.id, qcm });
    if (error) console.error("[exam-harvested-qcms:store] Échec écriture (non bloquant):", error.message);
  } catch (error) {
    console.error("[exam-harvested-qcms:store] Échec écriture — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
