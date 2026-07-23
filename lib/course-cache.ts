import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { CourseContent } from "@/lib/types";

interface CachedCourseRow {
  file_hash: string;
  file_name: string;
  course_text: string;
  explication: string;
  resume: string;
  pieges: string;
  astuces: string;
  cas_clinique: string;
  qcm: string;
}

function rowToContent(row: CachedCourseRow): CourseContent {
  return {
    explication: row.explication,
    resume: row.resume,
    pieges: row.pieges,
    astuces: row.astuces,
    casClinique: row.cas_clinique,
    qcm: row.qcm,
  };
}

let warnedNotConfigured = false;
function warnCacheDisabled() {
  if (!warnedNotConfigured) {
    console.warn(
      "Supabase n'est pas configuré (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants) — le cache de cours est désactivé, chaque génération appellera l'IA."
    );
    warnedNotConfigured = true;
  }
}

/** Cache lookup by file hash. Returns null on miss (never throws — caching is best-effort). */
export async function getCachedCourse(
  fileHash: string
): Promise<{ content: CourseContent; courseText: string; fileName: string } | null> {
  if (!isSupabaseConfigured()) {
    warnCacheDisabled();
    return null;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("courses_cache")
      .select(
        "file_hash, file_name, course_text, explication, resume, pieges, astuces, cas_clinique, qcm"
      )
      .eq("file_hash", fileHash)
      .maybeSingle();

    if (error) {
      console.error("Supabase courses_cache lookup failed", error);
      return null;
    }
    if (!data) return null;

    const row = data as CachedCourseRow;
    return { content: rowToContent(row), courseText: row.course_text, fileName: row.file_name };
  } catch (error) {
    console.error("Supabase courses_cache lookup threw", error);
    return null;
  }
}

/** Look up just the stored raw course text (used by /api/regenerate). */
export async function getCachedCourseText(
  fileHash: string
): Promise<{ courseText: string; fileName: string } | null> {
  if (!isSupabaseConfigured()) {
    warnCacheDisabled();
    return null;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("courses_cache")
      .select("course_text, file_name")
      .eq("file_hash", fileHash)
      .maybeSingle();

    if (error) {
      console.error("Supabase courses_cache lookup failed", error);
      return null;
    }
    if (!data) return null;

    return { courseText: data.course_text as string, fileName: data.file_name as string };
  } catch (error) {
    console.error("Supabase courses_cache lookup threw", error);
    return null;
  }
}

/** Insert or overwrite the cached sections for a given file hash. Best-effort. */
export async function upsertCachedCourse(params: {
  fileHash: string;
  fileName: string;
  courseText: string;
  content: CourseContent;
}) {
  if (!isSupabaseConfigured()) {
    warnCacheDisabled();
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("courses_cache").upsert(
      {
        file_hash: params.fileHash,
        file_name: params.fileName,
        course_text: params.courseText,
        explication: params.content.explication,
        resume: params.content.resume,
        pieges: params.content.pieges,
        astuces: params.content.astuces,
        cas_clinique: params.content.casClinique,
        qcm: params.content.qcm,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "file_hash" }
    );

    if (error) {
      console.error("Supabase courses_cache upsert failed", error);
    }
  } catch (error) {
    console.error("Supabase courses_cache upsert threw", error);
  }
}

/** Best-effort hit counter — never blocks the response on failure. */
export async function bumpCacheHitCount(fileHash: string) {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_cache_hit_count", { p_file_hash: fileHash });
    if (error) {
      // Non-fatal: the RPC function is created by schema.sql; if it's missing
      // (e.g. schema not yet migrated) we just skip the counter silently.
      console.warn("increment_cache_hit_count RPC unavailable:", error.message);
    }
  } catch (error) {
    console.warn("increment_cache_hit_count threw:", error);
  }
}
