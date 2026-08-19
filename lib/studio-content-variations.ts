/**
 * Caches "Régénérer" output cross-student, capped at 10 variations per
 * (course, section) — see app/api/studio/regenerate/route.ts. Keyed by
 * studio_courses.content_hash (the raw-source-text hash, stamped by
 * app/api/studio/generate/route.ts) + section_key.
 *
 * PRODUCT TRADEOFF, not hidden here either: this turns "Régénérer" from
 * unlimited fresh rewrites into "pick one of at most 10 pre-generated
 * alternates, shared across every student on this course/section." See
 * supabase/schema.sql's studio_content_variations comment for the full
 * writeup — flagged in both places on purpose.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { DemoSectionId } from "@/lib/demo-content";

interface VariationRow {
  id: string;
  content: unknown;
  variation_index: number;
}

export interface VariationLookupResult {
  /** Existing variations for this (content_hash, section), 0-2 rows, ordered by variation_index. */
  existing: VariationRow[];
}

/** Fail-open: any Supabase error resolves to `{ existing: [] }`, which the caller treats as "generate a fresh one" — a lookup failure must never block regeneration, only skip the optimization. */
export async function lookupVariations(contentHash: string, section: DemoSectionId): Promise<VariationLookupResult> {
  if (!isSupabaseConfigured()) return { existing: [] };

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("studio_content_variations")
      .select("id, content, variation_index")
      .eq("content_hash", contentHash)
      .eq("section_key", section)
      .order("variation_index", { ascending: true });

    if (error) {
      console.error("[studio-content-variations:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return { existing: [] };
    }
    return { existing: (data ?? []) as VariationRow[] };
  } catch (error) {
    console.error("[studio-content-variations:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return { existing: [] };
  }
}

/**
 * Inserts a freshly-generated variation. Handles the concurrent-insert race
 * explicitly: two students hitting `count < 2` for the same
 * (content_hash, section) at once will both try to insert the same
 * `variation_index` — the UNIQUE constraint lets exactly one succeed. On a
 * 23505 unique-violation, this returns `{ conflict: true }` instead of
 * throwing — the caller re-reads and serves whichever variation the winner
 * created, rather than surfacing an error to the loser's student.
 */
export async function insertVariation(
  contentHash: string,
  section: DemoSectionId,
  variationIndex: number,
  content: unknown
): Promise<{ id: string; conflict: false } | { conflict: true }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_content_variations")
    .insert({ content_hash: contentHash, section_key: section, variation_index: variationIndex, content })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { conflict: true };
    }
    // Any other insert failure: log and treat the same as a conflict from
    // the caller's perspective (re-read and serve what exists, or fall back
    // to returning the freshly-generated content directly without caching
    // it) — a caching write failure must never surface as a user-facing error.
    console.error("[studio-content-variations:insert] Échec écriture (non conflit):", error.message);
    return { conflict: true };
  }
  return { id: (data as { id: string }).id, conflict: false };
}

/** Purely for hit-rate visibility — never load-bearing for correctness. */
export async function recordVariationHit(variationId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_variation_hit_count", { p_variation_id: variationId });
    if (error) console.error("[studio-content-variations:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[studio-content-variations:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
