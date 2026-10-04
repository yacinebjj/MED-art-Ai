import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Public URL of an already-generated file stored at a deterministic name
 * (`<baseName>.<ext>`) at the root of `bucket`, or null. Used for the
 * non-default variants of the infographic (language × model) and the
 * podcast (dialect): their files were always written to a deterministic
 * path, but never looked up before generating — every request for those
 * variants paid again for an identical image/narration. Fail-open.
 */
export async function findStoredVariantUrl(bucket: string, baseName: string): Promise<string | null> {
  try {
    const storage = getSupabaseAdmin().storage.from(bucket);
    const { data, error } = await storage.list("", { search: baseName, limit: 10 });
    if (error || !data) return null;
    const match = data.find((file) => file.name.startsWith(`${baseName}.`));
    return match ? storage.getPublicUrl(match.name).data.publicUrl : null;
  } catch {
    return null;
  }
}
