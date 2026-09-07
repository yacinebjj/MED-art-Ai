/**
 * Cross-student cache for the Studio "Podcast Audio" tab — a single ~10-15
 * min narrated episode, openai/gpt-audio-mini via OpenRouter, streamed
 * pcm16 then encoded to mp3 server-side (see app/api/studio/podcast/route.ts
 * and lib/audio/mp3-encoder.ts). Confirmed live (2026-09-02, real minimal
 * calibration test): ~20 audio tokens/second at gpt-audio-mini's completion
 * rate, so a real episode costs roughly $0.02-0.04 — paid ONCE per distinct
 * course across the whole shared catalog, never per student.
 *
 * Same shape/philosophy as lib/studio-infographic-cache.ts: keyed by
 * sha256(normalizeText(explication text)) — the SAME hash function that
 * table uses, just a different table, so no collision risk. `audio_url` is a
 * Supabase Storage public URL pointing at the final .mp3, never a base64 blob.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

/** Checked before every OpenRouter podcast-generation attempt. Returns `null` on any Supabase error or misconfiguration — a lookup failure must never block generation, only skip the optimization. */
export async function lookupStudioPodcastCache(contentHash: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("studio_podcast_cache")
      .select("audio_url")
      .eq("content_hash", contentHash)
      .maybeSingle<{ audio_url: string }>();

    if (error) {
      console.error("[studio-podcast-cache:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return null;
    }
    return data?.audio_url ?? null;
  } catch (error) {
    console.error("[studio-podcast-cache:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Stores a freshly-generated episode for future cross-student reuse. Fail-open: a write failure is logged, never thrown — the student's own generation already succeeded and must not be blocked by a caching side-effect failing. */
export async function storeStudioPodcastCache(contentHash: string, audioUrl: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("studio_podcast_cache")
      .upsert({ content_hash: contentHash, audio_url: audioUrl }, { onConflict: "content_hash" });

    if (error) {
      console.error("[studio-podcast-cache:store] Échec écriture (fail-open — la génération reste utilisable):", error.message);
    }
  } catch (error) {
    console.error("[studio-podcast-cache:store] Échec écriture — exception (fail-open):", error instanceof Error ? error.message : error);
  }
}

/** Purely for hit-rate visibility, mirroring every other content cache's hit counter — never load-bearing for correctness. */
export async function recordStudioPodcastCacheHit(contentHash: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_studio_podcast_cache_hit_count", { p_content_hash: contentHash });
    if (error) console.error("[studio-podcast-cache:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[studio-podcast-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
