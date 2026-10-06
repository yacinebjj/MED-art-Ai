import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Content-addressed reuse for generated media VARIANTS (podcast dialects,
 * infographic language/model pairs).
 *
 * Those routes already upload every non-default variant to a deterministic
 * path — `${contentHash}-${variant}.ext` — but only the default variant had a
 * cache table, so an English podcast or infographic was generated, billed and
 * uploaded again for every student, overwriting an identical file each time.
 * The file itself IS the cache: if it exists, the same content was already
 * generated for the same variant, and its public URL is returned for 0 tokens.
 *
 * Fail-open: any storage error is a miss (the route generates as before).
 */
export async function findStoredObjectUrl(
  supabase: SupabaseClient,
  bucket: string,
  /** The full file name, or a prefix when the extension isn't known before generating (e.g. "abc-en-pro."). */
  nameOrPrefix: string,
  match: "exact" | "prefix" = "exact"
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).list("", { limit: 5, search: nameOrPrefix });
    if (error || !data) return null;
    const file = data.find((entry) => (match === "exact" ? entry.name === nameOrPrefix : entry.name.startsWith(nameOrPrefix)) && (entry.metadata?.size ?? 1) > 0);
    if (!file) return null;
    return supabase.storage.from(bucket).getPublicUrl(file.name).data.publicUrl;
  } catch (error) {
    console.error(`[storage-variant-lookup] ${bucket}/${nameOrPrefix} — fail-open:`, error instanceof Error ? error.message : error);
    return null;
  }
}
