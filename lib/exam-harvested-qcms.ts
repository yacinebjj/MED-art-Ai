/**
 * Per-course supply of QCMs harvested from real exam-shortfall generations —
 * see exam_harvested_qcms' own comment in supabase/schema.sql for the full
 * design (why this is per-course rather than per-course-set like
 * exam_content_variations, and why it's a separate table from
 * studio_courses.qcms). Stores/reads the exact same QcmItem shape
 * lib/exam-pooling.ts's convertIfCompatible already validates, so a harvested
 * row is treated identically to an organic Studio QCM at pool-read time.
 * The shared question bank built on it is described in
 * lib/exam-question-bank.ts.
 *
 * CONTENT-ADDRESSED POOL (supabase/migrations/20261009_exam_harvest_content_hash.sql):
 * rows used to be reachable only through `course_id` — a per-student upload
 * id — so every student holding the SAME polycopié grew a private pool from
 * zero and paid again for questions another student's exam had already
 * produced. Rows now also carry `content_hash` (bankContentHash: sha256 of
 * the course's normalized explication ?? raw_text — the very text its
 * questions are written from, the same basis as the exam cache), and a
 * lookup matches either key, so one shared pool grows per course CONTENT.
 * Keying by the text the model actually read is what keeps the pool safe:
 * an explication is per student (a personalized variant, or text the client
 * sent), so questions written from one are only shared with courses whose
 * text is exactly the same. A text too short to identify a course gets no
 * hash at all (course_id only): an empty upload never shares a pool with
 * every other empty upload.
 * Until the migration runs, the missing column is detected and the old
 * course_id-only behavior is used — never an error.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeText, sha256 } from "@/lib/content-similarity";
import { qcmItemKey } from "@/lib/exam-pooling";
import { CANONICAL_BANK_PROFILE } from "@/lib/exam-bank-profiles";
import type { QcmItem } from "@/lib/types";

export interface HarvestCourse {
  id: number;
  explication: string | null;
  raw_text: string;
}

/** Below this many normalized characters a text does not identify a course. */
const MIN_IDENTITY_CHARS = 200;
/**
 * Newest rows read per course: far more than any exam takes from one course
 * (and than a student's recent history of it), and always under PostgREST's
 * max-rows cap (1000 by default), which would otherwise cut a big read short
 * silently — the bank grows with every exam.
 */
const PER_COURSE_ROW_LIMIT = 150;
/** Bank reads in flight at once (one read per selected course). */
const LOOKUP_CONCURRENCY = 8;

/** The identity of the text a course's questions are written from; null when too short to identify it. */
export function bankContentHash(course: HarvestCourse): string | null {
  const normalized = normalizeText(course.explication ?? course.raw_text ?? "");
  return normalized.length >= MIN_IDENTITY_CHARS ? sha256(normalized) : null;
}

let contentHashColumnMissing = false;

function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204" || /content_hash/i.test(error.message ?? "");
}

type HarvestRow = { id?: string; course_id: number; content_hash?: string | null; qcm: unknown };

/**
 * One course's newest bank rows of `profile` (by its id or its content); []
 * on a read failure — that course is then simply generated. The profile is
 * filtered in the query (qcm.exam.profile), so another profile's rows never
 * crowd this one out of the newest-rows window.
 */
async function fetchCourseRows(course: HarvestCourse, profile: string): Promise<HarvestRow[]> {
  const supabase = getSupabaseAdmin();
  const hash = bankContentHash(course);
  if (!contentHashColumnMissing) {
    const query = supabase.from("exam_harvested_qcms").select("id, course_id, content_hash, qcm").eq("qcm->exam->>profile", profile);
    const { data, error } = await (hash ? query.or(`course_id.eq.${course.id},content_hash.eq.${hash}`) : query.eq("course_id", course.id))
      .order("created_at", { ascending: false })
      .limit(PER_COURSE_ROW_LIMIT);
    if (!error) return (data ?? []) as unknown as HarvestRow[];
    if (!isMissingColumn(error)) {
      console.error("[exam-harvested-qcms:lookup] Échec lecture — pool ignoré pour ce cours:", error.message);
      return [];
    }
    contentHashColumnMissing = true;
  }
  const { data, error } = await supabase
    .from("exam_harvested_qcms")
    .select("id, course_id, qcm")
    .eq("course_id", course.id)
    .eq("qcm->exam->>profile", profile)
    .order("created_at", { ascending: false })
    .limit(PER_COURSE_ROW_LIMIT);
  if (error) {
    console.error("[exam-harvested-qcms:lookup] Échec lecture — pool ignoré pour ce cours:", error.message);
    return [];
  }
  return (data ?? []) as unknown as HarvestRow[];
}

/**
 * The bank questions of `profile` (lib/exam-bank-profiles.ts — the canonical
 * exam's by default) for each course. Fail-open: any Supabase error resolves
 * to an empty pool — a lookup failure must never block exam generation, only
 * skip the optimization (the course's shortfall is simply generated fresh
 * instead).
 */
export async function lookupHarvestedQcms(courses: HarvestCourse[], profile: string = CANONICAL_BANK_PROFILE): Promise<Map<number, QcmItem[]>> {
  const byCourseId = new Map<number, QcmItem[]>();
  if (!isSupabaseConfigured() || courses.length === 0) return byCourseId;

  try {
    const rowsByCourse = new Array<HarvestRow[]>(courses.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(LOOKUP_CONCURRENCY, courses.length) }, async () => {
        for (let index = next++; index < courses.length; index = next++) rowsByCourse[index] = await fetchCourseRows(courses[index], profile);
      })
    );

    courses.forEach((course, index) => {
      // The same question harvested twice (two students' exams) is kept once.
      const seen = new Set<string>();
      const list: QcmItem[] = [];
      for (const row of rowsByCourse[index]) {
        // Defensive: `qcm` is jsonb, so the JSON literal `null` (distinct from
        // SQL NULL, which the column's `not null` already excludes) or any
        // non-object would otherwise reach convertIfCompatible and throw —
        // failing the ENTIRE exam request instead of just skipping one bad
        // row, the same fail-open guarantee every other read in this app makes.
        if (!row.qcm || typeof row.qcm !== "object") continue;
        const qcm = row.qcm as QcmItem;
        const questionKey = typeof qcm.question === "string" ? qcmItemKey(qcm) : normalizeText(JSON.stringify(row.qcm));
        if (seen.has(questionKey)) continue;
        seen.add(questionKey);
        list.push(qcm);
      }
      if (list.length > 0) byCourseId.set(course.id, list);
    });
    return byCourseId;
  } catch (error) {
    console.error("[exam-harvested-qcms:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return byCourseId;
  }
}

/**
 * Files questions in the bank in ONE insert, each under its source course.
 * Returns how many rows were written. Fail-open: a write failure is logged,
 * never thrown — the exam that produced these questions must not be blocked
 * by a side-effect write failing.
 */
export async function storeHarvestedQcms(entries: { course: HarvestCourse; qcm: QcmItem }[]): Promise<number> {
  if (!isSupabaseConfigured() || entries.length === 0) return 0;
  try {
    const supabase = getSupabaseAdmin();
    if (!contentHashColumnMissing) {
      const { error } = await supabase
        .from("exam_harvested_qcms")
        .insert(entries.map(({ course, qcm }) => ({ course_id: course.id, content_hash: bankContentHash(course), qcm })));
      if (!error) return entries.length;
      if (!isMissingColumn(error)) {
        console.error("[exam-harvested-qcms:store] Échec écriture (non bloquant):", error.message);
        return 0;
      }
      contentHashColumnMissing = true;
    }
    const { error } = await supabase.from("exam_harvested_qcms").insert(entries.map(({ course, qcm }) => ({ course_id: course.id, qcm })));
    if (error) {
      console.error("[exam-harvested-qcms:store] Échec écriture (non bloquant):", error.message);
      return 0;
    }
    return entries.length;
  } catch (error) {
    console.error("[exam-harvested-qcms:store] Échec écriture — exception (non bloquant):", error instanceof Error ? error.message : error);
    return 0;
  }
}

/** Fail-open: a write failure is logged, never thrown — the exam that triggered this harvest already succeeded and must not be blocked by a side-effect write failing. */
export async function storeHarvestedQcm(course: HarvestCourse, qcm: QcmItem): Promise<void> {
  await storeHarvestedQcms([{ course, qcm }]);
}
