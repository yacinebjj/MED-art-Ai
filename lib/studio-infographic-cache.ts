/**
 * Cross-student cache for the Studio "Infographie / Mindmap" tab —
 * google/gemini-3.1-flash-image-preview (Nano Banana 2) via OpenRouter,
 * confirmed live to cost ~$0.07/generation (1120 image completion tokens at
 * OpenRouter's $0.00006/token image_output rate — NOT a per-image flat
 * price, confirmed via the real `usage` object on a real test call, not
 * assumed from the misleadingly small-looking per-unit price alone).
 *
 * Same shape/philosophy as lib/flashcards-content-cache.ts: keyed by
 * sha256(normalizeText(explication text)), one row per distinct explication,
 * EVER, across the whole shared course catalog — the definitive-set
 * architecture already used for Studio content and flashcards. Paid once
 * per distinct course, regardless of how many of the 4 000 students study
 * it. `image_url` points into Supabase Storage (bucket
 * "studio-infographics") — never a base64 blob in this table.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

/** Checked before every OpenRouter image-generation call. Returns `null` on any Supabase error or misconfiguration — a lookup failure must never block generation, only skip the optimization. */
export async function lookupStudioInfographicCache(contentHash: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("studio_infographic_cache")
      .select("image_url")
      .eq("content_hash", contentHash)
      .maybeSingle<{ image_url: string }>();

    if (error) {
      console.error("[studio-infographic-cache:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return null;
    }
    return data?.image_url ?? null;
  } catch (error) {
    console.error("[studio-infographic-cache:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Stores a freshly-generated infographie for future cross-student reuse. Fail-open: a write failure is logged, never thrown — the student's own generation already succeeded and must not be blocked by a caching side-effect failing. */
export async function storeStudioInfographicCache(contentHash: string, imageUrl: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("studio_infographic_cache")
      .upsert({ content_hash: contentHash, image_url: imageUrl }, { onConflict: "content_hash" });

    if (error) {
      console.error("[studio-infographic-cache:store] Échec écriture (fail-open — la génération reste utilisable):", error.message);
    }
  } catch (error) {
    console.error("[studio-infographic-cache:store] Échec écriture — exception (fail-open):", error instanceof Error ? error.message : error);
  }
}

/** Purely for hit-rate visibility, mirroring every other content cache's hit counter — never load-bearing for correctness. */
export async function recordStudioInfographicCacheHit(contentHash: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_studio_infographic_cache_hit_count", { p_content_hash: contentHash });
    if (error) console.error("[studio-infographic-cache:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[studio-infographic-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
