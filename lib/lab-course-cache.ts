/**
 * Platform-wide cache for the MedArt Lab's course-level tools (Patient
 * virtuel, Matrice pharmaco / Diagnostic différentiel, Carte mentale).
 *
 * Contract (see each route): the cache is consulted BEFORE the plan-quota
 * reservation and BEFORE any model call. A hit returns the stored content
 * for 0 tokens and 0 credits; a miss generates once, validates, and stores,
 * so a given course is paid for ONCE across the whole platform.
 *
 * Keyed by (content_hash, tool_type), where content_hash is the SAME
 * sha256(normalizeText(raw source text)) the other cross-student caches use
 * (lib/flashcards-content-cache.ts, lib/studio-content-cache.ts). It is
 * deliberately NOT keyed by `studio_courses.id`: that id is per student
 * upload, so two students studying the same polycop have different ids and
 * would never share a row. `course_id` is still stored, but only as an audit
 * pointer to the upload that paid for the generation.
 *
 * Privacy: only the GENERATED output is stored — never the uploaded text,
 * never the uploader's identity. A row is reused only when the source
 * material is identical.
 *
 * Fail-open both ways: a lookup error is a miss (generation proceeds), a
 * store error is logged and ignored (the student still gets their result).
 * The cache can therefore never block a tool — it can only save money.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeText, sha256 } from "@/lib/content-similarity";

/** One id per cached tool variant — the `tool_type` column. */
export type BaseLabToolType =
  | "matrix:pharmaco"
  | "matrix:ddx"
  | "mindmap"
  | "case:externe"
  | "case:interne"
  | "case:concours";

/**
 * Cache/history key of one tool variant IN ONE LANGUAGE. French keeps the
 * historical, unsuffixed key (every row stored before languages existed is
 * French), English gets ":en". Without this split, a student generating in
 * English would be served the French content another student had cached.
 */
export type LabToolType = BaseLabToolType | `${BaseLabToolType}:en`;

export function labToolTypeFor(base: BaseLabToolType, language: "fr" | "en"): LabToolType {
  return language === "en" ? `${base}:en` : base;
}

/** The stable content address for a course's source text. */
export function labContentHash(rawText: string): string {
  return sha256(normalizeText(rawText));
}

/**
 * Returns the cached content for this course + tool, or `null` on a miss or
 * ANY error. The caller must still validate the shape — a row written by an
 * older version of the generator may no longer match what the client expects.
 */
export async function lookupLabCache(contentHash: string, toolType: LabToolType): Promise<unknown | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("lab_course_cache")
      .select("content")
      .eq("content_hash", contentHash)
      .eq("tool_type", toolType)
      .maybeSingle();
    if (error) {
      console.error(`[lab-course-cache:lookup] ${toolType} — lecture impossible, génération réelle utilisée :`, error.message);
      return null;
    }
    if (!data) return null;
    // Fire-and-forget: a hit counter must never add latency or fail a hit.
    void Promise.resolve(getSupabaseAdmin().rpc("increment_lab_course_cache_hit_count", { p_content_hash: contentHash, p_tool_type: toolType })).then(
      () => undefined,
      () => undefined
    );
    return (data as { content: unknown }).content ?? null;
  } catch (error) {
    console.error(`[lab-course-cache:lookup] ${toolType} — exception :`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Stores a freshly generated, already-validated result. First writer wins
 * (`ignoreDuplicates`): two students racing on the same new course both
 * generate, but only one row is kept and later reads are all free.
 */
export async function storeLabCache(params: {
  contentHash: string;
  toolType: LabToolType;
  courseId: number;
  content: unknown;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin()
      .from("lab_course_cache")
      .upsert(
        { content_hash: params.contentHash, tool_type: params.toolType, course_id: params.courseId, content: params.content },
        { onConflict: "content_hash,tool_type", ignoreDuplicates: true }
      );
    if (error) {
      console.error(`[lab-course-cache:store] ${params.toolType} — écriture impossible (le résultat est tout de même renvoyé) :`, error.message);
    }
  } catch (error) {
    console.error(`[lab-course-cache:store] ${params.toolType} — exception :`, error instanceof Error ? error.message : error);
  }
}

/**
 * Links a Lab result to the STUDENT'S OWN history (user_lab_history) — called
 * on every generation AND every cache hit, so what a student has opened
 * survives a refresh, a new device or a re-login. The row is a pointer
 * (user + content hash + tool variant); the content itself stays in
 * lab_course_cache and is joined back by GET /api/studio/lab-history.
 * Fail-open: a history failure is logged and never blocks the result.
 */
export async function recordLabHistory(params: {
  userId: string;
  contentHash: string;
  toolType: LabToolType;
  courseId: number;
  title: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseAdmin()
      .from("user_lab_history")
      .upsert(
        {
          user_id: params.userId,
          content_hash: params.contentHash,
          tool_type: params.toolType,
          course_id: params.courseId,
          title: params.title,
          last_opened_at: new Date().toISOString(),
        },
        { onConflict: "user_id,content_hash,tool_type" }
      );
    if (error) {
      console.error(`[lab-history:record] ${params.toolType} — écriture impossible (le résultat est tout de même renvoyé) :`, error.message);
    }
  } catch (error) {
    console.error(`[lab-history:record] ${params.toolType} — exception :`, error instanceof Error ? error.message : error);
  }
}
