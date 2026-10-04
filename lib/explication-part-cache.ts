/**
 * Cross-student cache of Explication PARTS (studio_explication_part_cache).
 *
 * The full-document cache (studio_content_cache, section "explication") is
 * only written once a whole run finalizes. Without this table, a run that
 * failed at part 7/9 lost parts 1-6 for everybody, and two students starting
 * the same new course paid for every part twice. Parts are keyed on the
 * FULL normalized source (slices are cut from the full text, not the 60k
 * prefix the document cache uses), the language variant and the exact
 * slice geometry, so a hit is always the same slice of the same text.
 *
 * Only server-generated markdown ever enters this table (written by
 * app/api/studio/generate/explication-part right after the model call) —
 * which is also what lets explication-finalize verify that a submitted
 * document really comes from this pipeline before sharing it.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeText, sha256 } from "@/lib/content-similarity";

export interface PartGeometry {
  partIndex: number;
  totalParts: number;
  subPartIndex: number;
  subPartCount: number;
}

export function explicationSourceHash(rawText: string): string {
  return sha256(normalizeText(rawText));
}

function partKey(g: PartGeometry): string {
  return `${g.totalParts}:${g.partIndex}:${g.subPartCount}:${g.subPartIndex}`;
}

export async function lookupExplicationPart(sourceHash: string, variant: string, geometry: PartGeometry): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("studio_explication_part_cache")
      .select("markdown")
      .eq("source_hash", sourceHash)
      .eq("variant", variant)
      .eq("part_key", partKey(geometry))
      .maybeSingle<{ markdown: string }>();
    if (error) {
      console.error("[explication-part-cache:lookup] Échec lecture (génération réelle utilisée):", error.message);
      return null;
    }
    return data?.markdown ?? null;
  } catch (error) {
    console.error("[explication-part-cache:lookup] Exception:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** First writer wins (ignoreDuplicates): concurrent identical parts never overwrite each other. Fail-open. */
export async function storeExplicationPart(sourceHash: string, variant: string, geometry: PartGeometry, markdown: string): Promise<void> {
  if (!isSupabaseConfigured() || !markdown.trim()) return;
  try {
    const { error } = await getSupabaseAdmin()
      .from("studio_explication_part_cache")
      .upsert({ source_hash: sourceHash, variant, part_key: partKey(geometry), markdown }, { onConflict: "source_hash,variant,part_key", ignoreDuplicates: true });
    if (error) console.error("[explication-part-cache:store] Échec écriture (non bloquant):", error.message);
  } catch (error) {
    console.error("[explication-part-cache:store] Exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}

/** Word 5-gram set of a normalized text. */
function shingleSet(text: string): Set<string> {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i++) out.add(words.slice(i, i + 5).join(" "));
  return out;
}

/** Share of `a`'s shingles that also appear in `b`. */
function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const s of a) if (b.has(s)) hit++;
  return hit / a.size;
}

/**
 * True when `document` is — up to the client-side seam stitching — made of
 * parts this server generated for this source, with every part present:
 *  - ≥ 85 % of its 5-word shingles come from server-generated parts (so a
 *    client can never push arbitrary text into the shared cache), and
 *  - every one of the `totalParts` parts has a complete server version
 *    whose shingles are ≥ 60 % present in the document (no truncated or
 *    partial document gets shared).
 */
export async function documentMatchesGeneratedParts(sourceHash: string, variant: string, totalParts: number, document: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("studio_explication_part_cache")
      .select("part_key, markdown")
      .eq("source_hash", sourceHash)
      .eq("variant", variant)
      .limit(500);
    if (error || !data || data.length === 0) return false;

    const rows = (data as { part_key: string; markdown: string }[])
      .map((row) => {
        const [total, part, subCount, subIdx] = row.part_key.split(":").map(Number);
        return { total, part, subCount, subIdx, markdown: row.markdown };
      })
      .filter((r) => r.total === totalParts);

    const submitted = shingleSet(document);
    const allGenerated = shingleSet(rows.map((r) => r.markdown).join("\n\n"));
    if (containment(submitted, allGenerated) < 0.85) return false;

    for (let part = 0; part < totalParts; part++) {
      const forPart = rows.filter((r) => r.part === part);
      // A complete version: the whole part, or every sub-part of one split level.
      const whole = forPart.find((r) => r.subCount === 1);
      let text: string | null = whole?.markdown ?? null;
      if (!text) {
        const byCount = new Map<number, (typeof forPart)[number][]>();
        for (const r of forPart) byCount.set(r.subCount, [...(byCount.get(r.subCount) ?? []), r]);
        for (const [count, list] of byCount) {
          if (new Set(list.map((r) => r.subIdx)).size >= count) {
            text = [...list].sort((a, b) => a.subIdx - b.subIdx).map((r) => r.markdown).join("\n\n");
            break;
          }
        }
      }
      if (!text || containment(shingleSet(text), submitted) < 0.6) return false;
    }
    return true;
  } catch {
    return false;
  }
}
