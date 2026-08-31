/**
 * Cross-student cache for the "Générateur d'Examen" (app/api/exam/generate/
 * route.ts). Keyed by a hash of the ENTIRE selected course SET's content —
 * deliberately combination-level, not course-level like
 * lib/course-workspace-cache.ts (see exam_content_cache's own comment in
 * supabase/schema.sql for why an exam doesn't fit that per-course model).
 */

import { createHash } from "crypto";
import { normalizeText } from "@/lib/content-similarity";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

interface ExamCourseForHash {
  id: number;
  explication: string | null;
  raw_text: string;
}

/**
 * Sorted by course id (defensively — callers already order by id, but the
 * hash must never depend on request/array order) and joined with an
 * unambiguous separator, so this is stable across students who select the
 * exact same set of courses regardless of the order they clicked them in.
 * Uses each course's full explication/raw_text (not the per-call
 * MAX_PER_COURSE_CHARS-capped slice fed to the model) so this hash never
 * shifts if that cap is retuned later.
 */
export function computeExamContentHash(courses: ExamCourseForHash[]): string {
  const normalized = [...courses]
    .sort((a, b) => a.id - b.id)
    .map((course) => `${course.id}::${normalizeText(course.explication ?? course.raw_text)}`)
    .join("\n---\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Checked before generating (skipped entirely for variation:true requests — see the route). Returns `null` on any Supabase error or misconfiguration — a lookup failure must never block generation, only skip the optimization. */
export async function lookupExamCache(contentHash: string): Promise<unknown | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("exam_content_cache")
      .select("content")
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (error) {
      console.error("[exam-content-cache:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return null;
    }
    return data ? (data as { content: unknown }).content : null;
  } catch (error) {
    console.error("[exam-content-cache:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Stores a freshly-generated exam for future cross-student reuse. Fail-open: a write failure is logged, never thrown — the student's own exam already succeeded and must not be blocked by a caching side-effect failing. */
export async function storeExamCache(contentHash: string, content: unknown, selectedCourses: unknown): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("exam_content_cache")
      .upsert({ content_hash: contentHash, content, selected_courses: selectedCourses }, { onConflict: "content_hash" });

    if (error) {
      console.error("[exam-content-cache:store] Échec écriture (fail-open — l'examen reste utilisable):", error.message);
    }
  } catch (error) {
    console.error("[exam-content-cache:store] Échec écriture — exception (fail-open):", error instanceof Error ? error.message : error);
  }
}

/** Purely for hit-rate visibility — never load-bearing for correctness. */
export async function recordExamCacheHit(contentHash: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_exam_content_cache_hit_count", { p_content_hash: contentHash });
    if (error) console.error("[exam-content-cache:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[exam-content-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
