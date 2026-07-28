import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ContentType } from "@/lib/types";

/**
 * A single cached artifact for one (course, content type, sub-unit) triple.
 * `subUnitId` defaults to "" for the single-unit content types (cours_oral,
 * explication, mode_visuel, resume); "cas_clinique" and "qcm" pass a real
 * sub-unit id (e.g. "case-3", "qcm-batch-2") — see lib/sub-units.ts. Null on
 * miss. A hit costs 0 tokens.
 */
export async function getCachedContent(
  courseId: string,
  contentType: ContentType,
  subUnitId = ""
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("course_content_cache")
      .select("content")
      .eq("course_id", courseId)
      .eq("content_type", contentType)
      .eq("sub_unit_id", subUnitId)
      .maybeSingle();

    if (error) {
      console.error("Supabase course_content_cache lookup failed", error);
      return null;
    }
    return (data?.content as string | undefined) ?? null;
  } catch (error) {
    console.error("Supabase course_content_cache lookup threw", error);
    return null;
  }
}

/**
 * All cached single-unit artifacts for a course, keyed by content type.
 * Deliberately excludes "cas_clinique"/"qcm" sub-unit rows (sub_unit_id !=
 * "") — those are fetched and hydrated separately by the Live components
 * via the streaming route, not through this generic map.
 */
export async function getAllCachedContent(
  courseId: string
): Promise<Partial<Record<ContentType, string>>> {
  if (!isSupabaseConfigured()) return {};

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("course_content_cache")
      .select("content_type, content")
      .eq("course_id", courseId)
      .eq("sub_unit_id", "");

    if (error) {
      console.error("Supabase course_content_cache list failed", error);
      return {};
    }

    const result: Partial<Record<ContentType, string>> = {};
    for (const row of data ?? []) {
      result[row.content_type as ContentType] = row.content as string;
    }
    return result;
  } catch (error) {
    console.error("Supabase course_content_cache list threw", error);
    return {};
  }
}

/**
 * All cached sub-unit rows for one chunked content type (e.g. every already-
 * generated case for "cas_clinique"), keyed by sub-unit id. Used to hydrate
 * the Live components instantly for units that were generated on a previous
 * visit, without re-calling the AI for them.
 */
export async function getCachedSubUnits(
  courseId: string,
  contentType: ContentType
): Promise<Record<string, string>> {
  if (!isSupabaseConfigured()) return {};

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("course_content_cache")
      .select("sub_unit_id, content")
      .eq("course_id", courseId)
      .eq("content_type", contentType)
      .neq("sub_unit_id", "");

    if (error) {
      console.error("Supabase course_content_cache sub-unit list failed", error);
      return {};
    }

    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      result[row.sub_unit_id as string] = row.content as string;
    }
    return result;
  } catch (error) {
    console.error("Supabase course_content_cache sub-unit list threw", error);
    return {};
  }
}

export async function setCachedContent(
  courseId: string,
  contentType: ContentType,
  content: string,
  subUnitId = ""
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("course_content_cache").upsert(
      {
        course_id: courseId,
        content_type: contentType,
        sub_unit_id: subUnitId,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "course_id,content_type,sub_unit_id" }
    );
    if (error) console.error("Supabase course_content_cache upsert failed", error);
  } catch (error) {
    console.error("Supabase course_content_cache upsert threw", error);
  }
}
