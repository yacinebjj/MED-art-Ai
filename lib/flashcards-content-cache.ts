/**
 * Cross-student cache for the "definitive set" flashcard architecture —
 * mirrors lib/studio-content-cache.ts's exact-match tier (same table shape,
 * same fail-open philosophy), but simpler: flashcards have no fuzzy tier,
 * only exact. Keyed by sha256(normalizeText(explication text)), computed
 * by the caller (app/api/flashcards/generate/route.ts) — not a fuzzy match
 * because a "close enough" explication could legitimately cover different
 * material in different orders, and flashcards are exhaustive-coverage by
 * design (see buildDefinitiveFlashcardSetPrompt), unlike Studio's fuzzy tier
 * which explicitly tolerates near-duplicates via delta-adaptation.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export interface FlashcardQA {
  question: string;
  answer: string;
}

/** Checked before every OpenRouter call. Returns `null` on any Supabase error or misconfiguration — a lookup failure must never block generation, only skip the optimization. */
export async function lookupFlashcardsCache(contentHash: string): Promise<FlashcardQA[] | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("flashcards_content_cache")
      .select("cards_data")
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (error) {
      console.error("[flashcards-content-cache:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return null;
    }
    if (!data) return null;

    const cards = data.cards_data as unknown;
    if (!Array.isArray(cards)) return null;
    return cards as FlashcardQA[];
  } catch (error) {
    console.error("[flashcards-content-cache:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Batched form of lookupFlashcardsCache — fetches every candidate content
 * hash in ONE query instead of one sequential round trip per hash. Used by
 * app/api/flashcards/generate/route.ts's Pass-1 scan across a student's
 * eligible courses (previously N sequential lookupFlashcardsCache calls, a
 * real N+1 whenever earlier-ordered courses lacked a cross-student cache
 * entry — a common case for newly-uploaded courses). Same fail-open
 * contract: any Supabase error returns an empty map, never throws.
 */
export async function lookupFlashcardsCacheBatch(contentHashes: string[]): Promise<Map<string, FlashcardQA[]>> {
  const result = new Map<string, FlashcardQA[]>();
  if (!isSupabaseConfigured() || contentHashes.length === 0) return result;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("flashcards_content_cache")
      .select("content_hash, cards_data")
      .in("content_hash", contentHashes);

    if (error) {
      console.error("[flashcards-content-cache:lookupBatch] Échec lecture — génération réelle utilisée à la place:", error.message);
      return result;
    }

    for (const row of (data ?? []) as { content_hash: string; cards_data: unknown }[]) {
      if (Array.isArray(row.cards_data)) result.set(row.content_hash, row.cards_data as FlashcardQA[]);
    }
    return result;
  } catch (error) {
    console.error("[flashcards-content-cache:lookupBatch] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return result;
  }
}

/** Stores a freshly-generated definitive set for future cross-student reuse. Fail-open: a write failure is logged, never thrown — the student's own generation already succeeded and must not be blocked by a caching side-effect failing. */
export async function storeFlashcardsCache(contentHash: string, cards: FlashcardQA[]): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("flashcards_content_cache")
      .upsert({ content_hash: contentHash, cards_data: cards }, { onConflict: "content_hash" });

    if (error) {
      console.error("[flashcards-content-cache:store] Échec écriture (fail-open — la génération reste utilisable):", error.message);
    }
  } catch (error) {
    console.error("[flashcards-content-cache:store] Échec écriture — exception (fail-open):", error instanceof Error ? error.message : error);
  }
}

/** Purely for hit-rate visibility, mirroring studio_content_cache's own hit counter — never load-bearing for correctness. */
export async function recordFlashcardsCacheHit(contentHash: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_flashcards_content_cache_hit_count", { p_content_hash: contentHash });
    if (error) console.error("[flashcards-content-cache:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[flashcards-content-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
