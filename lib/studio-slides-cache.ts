/**
 * Cross-student cache for the Studio "Slides" tab — a 6-slide mini-deck,
 * google/gemini-3.1-flash-image-preview via OpenRouter, one image call per
 * slide run in parallel (see app/api/studio/slides/route.ts). Confirmed
 * live (2026-09-02, real 4-slide test): ~$0.086/slide average, so a real
 * 6-slide deck costs roughly $0.45-0.55 — paid ONCE per distinct course
 * across the whole shared catalog, never per student.
 *
 * Same shape/philosophy as lib/studio-infographic-cache.ts: keyed by
 * sha256(normalizeText(explication text)) — the SAME hash function that
 * table uses, just a different table, so no collision risk. `slide_urls` is
 * an ORDERED array of Supabase Storage public URLs, never base64 blobs.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

/** Checked before every OpenRouter deck-generation attempt. Returns `null` on any Supabase error or misconfiguration — a lookup failure must never block generation, only skip the optimization. */
export async function lookupStudioSlidesCache(contentHash: string): Promise<string[] | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("studio_slides_cache")
      .select("slide_urls")
      .eq("content_hash", contentHash)
      .maybeSingle<{ slide_urls: unknown }>();

    if (error) {
      console.error("[studio-slides-cache:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return null;
    }
    if (!data || !Array.isArray(data.slide_urls)) return null;
    return data.slide_urls as string[];
  } catch (error) {
    console.error("[studio-slides-cache:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Stores a freshly-generated deck for future cross-student reuse. Fail-open: a write failure is logged, never thrown — the student's own generation already succeeded and must not be blocked by a caching side-effect failing. */
export async function storeStudioSlidesCache(contentHash: string, slideUrls: string[]): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("studio_slides_cache")
      .upsert({ content_hash: contentHash, slide_urls: slideUrls }, { onConflict: "content_hash" });

    if (error) {
      console.error("[studio-slides-cache:store] Échec écriture (fail-open — la génération reste utilisable):", error.message);
    }
  } catch (error) {
    console.error("[studio-slides-cache:store] Échec écriture — exception (fail-open):", error instanceof Error ? error.message : error);
  }
}

/** Purely for hit-rate visibility, mirroring every other content cache's hit counter — never load-bearing for correctness. */
export async function recordStudioSlidesCacheHit(contentHash: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_studio_slides_cache_hit_count", { p_content_hash: contentHash });
    if (error) console.error("[studio-slides-cache:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[studio-slides-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
