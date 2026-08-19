/**
 * Course-LEVEL cache for the Module Summary Workspace — see
 * app/api/workspace/module-synthesis/route.ts and course_workspace_cache's
 * own comment in supabase/schema.sql for why this replaced an earlier
 * combination-level design (combinatorial explosion — see that comment for
 * the full writeup). One row per (course, generation_type); a request
 * covering N selected courses does ONE batched lookup and ONE batched
 * upsert here, never N round trips.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

// "keyword_row_v2", not "keyword_row" — the stored SHAPE changed (per-course
// {concept,term,trap} triples -> one object of 4 short-keyword category
// arrays for a single global table row). Bumped rather than reused so old
// cached rows are never read back under the new, incompatible shape — see
// course_workspace_cache's own migration comment in supabase/schema.sql.
export type CourseWorkspaceGenerationType = "summary_chunk" | "keyword_row_v2";

/**
 * One course's entire Keywords Table contribution — exactly ONE table row,
 * not one row per concept. Every array holds SHORT keywords only (1-3 words,
 * no sentences, no verbs — enforced in the prompt, not just by this type).
 */
export interface KeywordCategories {
  mots_cles_principaux: string[];
  signes_cliniques: string[];
  examens_diagnostic: string[];
  traitements: string[];
}

/** Looks up every requested (courseContentHash, generationType) pair in ONE query. Returns a Map keyed by course_content_hash — missing keys mean a genuine cache miss for that course. Returns an empty Map on any Supabase error or misconfiguration (fail-open: every course is then treated as a miss, never blocking generation). */
export async function lookupCourseWorkspaceChunks(
  courseContentHashes: string[],
  generationType: CourseWorkspaceGenerationType
): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  if (!isSupabaseConfigured() || courseContentHashes.length === 0) return result;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("course_workspace_cache")
      .select("course_content_hash, content")
      .eq("generation_type", generationType)
      .in("course_content_hash", courseContentHashes);

    if (error) {
      console.error("[course-workspace-cache:lookup] Échec lecture — tout traité comme cache miss:", error.message);
      return result;
    }
    for (const row of (data ?? []) as { course_content_hash: string; content: unknown }[]) {
      result.set(row.course_content_hash, row.content);
    }
    return result;
  } catch (error) {
    console.error("[course-workspace-cache:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return result;
  }
}

/** Batched upsert of every newly-generated chunk in ONE call. Fail-open: a write failure is logged, never thrown — the student's own generation already succeeded and must not be blocked by a caching side-effect failing. */
export async function storeCourseWorkspaceChunks(
  chunks: { courseContentHash: string; content: unknown }[],
  generationType: CourseWorkspaceGenerationType
): Promise<void> {
  if (!isSupabaseConfigured() || chunks.length === 0) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("course_workspace_cache").upsert(
      chunks.map((c) => ({ course_content_hash: c.courseContentHash, generation_type: generationType, content: c.content })),
      { onConflict: "course_content_hash,generation_type" }
    );
    if (error) {
      console.error("[course-workspace-cache:store] Échec écriture (fail-open — la génération reste utilisable):", error.message);
    }
  } catch (error) {
    console.error("[course-workspace-cache:store] Échec écriture — exception (fail-open):", error instanceof Error ? error.message : error);
  }
}

/** Purely for hit-rate visibility — never load-bearing for correctness. Fires one RPC per hit; not a hot path (bounded by how many courses a student selects at once). */
export async function recordCourseWorkspaceCacheHits(courseContentHashes: string[], generationType: CourseWorkspaceGenerationType): Promise<void> {
  if (!isSupabaseConfigured() || courseContentHashes.length === 0) return;
  try {
    const supabase = getSupabaseAdmin();
    await Promise.all(
      courseContentHashes.map((hash) =>
        supabase
          .rpc("increment_course_workspace_cache_hit_count", { p_course_content_hash: hash, p_generation_type: generationType })
          .then(({ error }) => {
            if (error) console.error("[course-workspace-cache:hit] Échec incrément (non bloquant):", error.message);
          })
      )
    );
  } catch (error) {
    console.error("[course-workspace-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
