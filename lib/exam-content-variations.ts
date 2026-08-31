/**
 * Caches the exam's own "Régénérer" (variation:true) output cross-student,
 * capped at MAX_EXAM_VARIATIONS per content_hash — see
 * app/api/exam/generate/route.ts. Mirrors lib/studio-content-variations.ts's
 * exact design (same table shape, same fail-open philosophy, same
 * concurrent-insert-conflict handling), minus a section_key column — one
 * exam has no sections to key by, only content_hash.
 *
 * PRODUCT TRADEOFF, not hidden here either: this turns "Régénérer" from
 * unlimited fresh exams into "pick one of at most MAX_EXAM_VARIATIONS
 * pre-generated alternates, shared across every student on this course set."
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

interface VariationRow {
  id: string;
  content: unknown;
  variation_index: number;
}

export interface ExamVariationLookupResult {
  /** Existing variations for this content_hash, ordered by variation_index. */
  existing: VariationRow[];
}

/** Fail-open: any Supabase error resolves to `{ existing: [] }`, which the caller treats as "generate a fresh one" — a lookup failure must never block regeneration, only skip the optimization. */
export async function lookupExamVariations(contentHash: string): Promise<ExamVariationLookupResult> {
  if (!isSupabaseConfigured()) return { existing: [] };

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("exam_content_variations")
      .select("id, content, variation_index")
      .eq("content_hash", contentHash)
      .order("variation_index", { ascending: true });

    if (error) {
      console.error("[exam-content-variations:lookup] Échec lecture — génération réelle utilisée à la place:", error.message);
      return { existing: [] };
    }
    return { existing: (data ?? []) as VariationRow[] };
  } catch (error) {
    console.error("[exam-content-variations:lookup] Échec lookup — exception:", error instanceof Error ? error.message : error);
    return { existing: [] };
  }
}

/**
 * Inserts a freshly-generated variation. Handles the concurrent-insert race
 * explicitly: two students hitting the same content_hash below the cap at
 * once will both try to insert the same `variation_index` — the UNIQUE
 * constraint lets exactly one succeed. On a 23505 unique-violation, this
 * returns `{ conflict: true }` instead of throwing — the caller serves its
 * own freshly-generated content anyway rather than discarding it.
 */
export async function insertExamVariation(
  contentHash: string,
  variationIndex: number,
  content: unknown
): Promise<{ id: string; conflict: false } | { conflict: true }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("exam_content_variations")
    .insert({ content_hash: contentHash, variation_index: variationIndex, content })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { conflict: true };
    }
    console.error("[exam-content-variations:insert] Échec écriture (non conflit):", error.message);
    return { conflict: true };
  }
  return { id: (data as { id: string }).id, conflict: false };
}

/** Purely for hit-rate visibility — never load-bearing for correctness. */
export async function recordExamVariationHit(variationId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_exam_variation_hit_count", { p_variation_id: variationId });
    if (error) console.error("[exam-content-variations:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[exam-content-variations:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
