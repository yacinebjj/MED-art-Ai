import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ContentType } from "@/lib/types";

/** A single cached artifact for one (course, content type) pair. Null on miss. */
export async function getCachedContent(
  courseId: string,
  contentType: ContentType
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("course_content_cache")
      .select("content")
      .eq("course_id", courseId)
      .eq("content_type", contentType)
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

/** All cached artifacts for a course, keyed by content type. */
export async function getAllCachedContent(
  courseId: string
): Promise<Partial<Record<ContentType, string>>> {
  if (!isSupabaseConfigured()) return {};

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("course_content_cache")
      .select("content_type, content")
      .eq("course_id", courseId);

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

export async function setCachedContent(
  courseId: string,
  contentType: ContentType,
  content: string
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("course_content_cache").upsert(
      {
        course_id: courseId,
        content_type: contentType,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "course_id,content_type" }
    );
    if (error) console.error("Supabase course_content_cache upsert failed", error);
  } catch (error) {
    console.error("Supabase course_content_cache upsert threw", error);
  }
}

/** Sets several artifacts at once — used when the 6-section mega-prompt fills the cache in one call. */
export async function setCachedContentBatch(
  courseId: string,
  entries: Partial<Record<ContentType, string>>
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const rows = Object.entries(entries)
    .filter(([, content]) => typeof content === "string")
    .map(([contentType, content]) => ({
      course_id: courseId,
      content_type: contentType,
      content,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("course_content_cache")
      .upsert(rows, { onConflict: "course_id,content_type" });
    if (error) console.error("Supabase course_content_cache batch upsert failed", error);
  } catch (error) {
    console.error("Supabase course_content_cache batch upsert threw", error);
  }
}
