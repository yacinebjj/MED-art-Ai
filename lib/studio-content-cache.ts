/**
 * Cross-student, content-addressed cache for Studio's deterministic
 * whole-course generations (explication/résumé/cas clinique/QCM/exemples-
 * analogies — see app/api/studio/generate/route.ts). Checked BEFORE every
 * OpenRouter call; a hit costs 0 tokens regardless of which student
 * originally paid for the generation.
 *
 * Deliberately scoped to ONLY these five Studio sections:
 * - Flashcards (app/api/flashcards/generate) draw a RANDOM excerpt per
 *   call by design (see lib/flashcard-excerpt.ts's own header comment —
 *   "so successive generations naturally surface different material"), so
 *   a whole-course content hash doesn't address what's actually being
 *   generated on any given call. Cross-student reuse there would need a
 *   different design (cloning an entire accumulated flashcard_queue, not
 *   caching one generation) — a real follow-up feature, not implemented
 *   here.
 * - The Weakness Remediation plan (app/api/study/remediation-plan/generate)
 *   is computed FROM one student's own qcm_attempts mistakes. It is not
 *   just out of scope, it would be actively WRONG to share across
 *   students — two students never have the same weaknesses.
 * - "Générer un examen" (app/dashboard/module/[id]/exam) has no real
 *   backend at all yet (fully mocked UI, see that page's own header
 *   comment) — there is no live generation call to cache.
 * - /api/studio/regenerate is intentionally excluded from the LOOKUP path:
 *   a student clicking "Régénérer" is explicitly asking for a fresh, DIFFERENT
 *   version, so serving them the cached original would defeat the button's
 *   entire purpose. Its result is still written back into the cache (see
 *   storeStudioContentCache below), so a later brand-new student can still
 *   benefit from it.
 *
 * Privacy: only the GENERATED JSON output is ever shared — never the
 * original student's raw uploaded text, never their identity, never a
 * link back to whose course produced it. Reuse only ever fires when the
 * underlying SOURCE MATERIAL is the same (by content, not by uploader), so
 * this cannot leak one student's private document to another; it only
 * avoids re-paying for output that is, in substance, identical.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { computeMinHashSignature, estimateSimilarity, normalizeText, sha256 } from "@/lib/content-similarity";
import type { JsonSectionId } from "@/lib/demo-content";

/**
 * Deliberately a bit under the "~90% variance" the fuzzy tier targets:
 * MinHash is an ESTIMATE, not an exact measurement, so erring toward
 * requiring a little more overlap trades a few avoidable real generations
 * (a false negative — costs one more paid call) against ever serving a
 * genuinely different course's content to a student (a false positive —
 * shows them the wrong material entirely). The former is merely
 * suboptimal; the latter is a real correctness bug.
 */
const SIMILARITY_THRESHOLD = 0.85;

interface StudioCacheRow {
  id: string;
  data: unknown;
  minhash_signature: number[];
}

export interface StudioCacheLookupResult {
  hit: boolean;
  data?: unknown;
  matchType?: "exact" | "fuzzy";
  similarity?: number;
  cacheRowId?: string;
}

/**
 * Checked before every OpenRouter call in app/api/studio/generate/route.ts.
 * Returns `{ hit: false }` on any Supabase error or misconfiguration — a
 * lookup failure must never block generation, only skip the optimization.
 *
 * `exactOnly` — skips the fuzzy tier (a second, up-to-500-row query plus an
 * in-process MinHash similarity scan over all of them) entirely. Added for
 * app/api/studio/generate/explication-start/route.ts specifically: that
 * route was rearchitected to NEVER consume a fuzzy match (see its own
 * ARCHITECTURE comment — the fuzzy-cache delta adaptation that used to
 * follow a fuzzy hit was removed after a real production 504 traced to AI
 * calls running inside that latency-critical, tightly-bounded route), so
 * paying for the fuzzy scan there was pure wasted latency on every single
 * cache-miss request — exactly the kind of avoidable delay that matters
 * once a route's whole budget is measured in single-digit seconds. Every
 * OTHER caller (the generic /api/studio/generate route, which still does
 * use fuzzy hits) is unaffected — this defaults to false.
 */
export async function lookupStudioContentCache(
  section: JsonSectionId,
  rawText: string,
  exactOnly = false
): Promise<StudioCacheLookupResult> {
  if (!isSupabaseConfigured()) return { hit: false };
  const supabase = getSupabaseAdmin();
  const normalized = normalizeText(rawText);
  const hash = sha256(normalized);

  const { data: exactRow, error: exactError } = await supabase
    .from("studio_content_cache")
    .select("id, data")
    .eq("section", section)
    .eq("content_hash", hash)
    .maybeSingle();

  if (exactError) {
    console.error("[studio-content-cache:lookup] Échec lecture (exact) — génération réelle utilisée à la place:", exactError);
    return { hit: false };
  }
  if (exactRow) {
    return { hit: true, data: exactRow.data, matchType: "exact", similarity: 1, cacheRowId: exactRow.id };
  }
  if (exactOnly) return { hit: false };

  // Fuzzy tier: pull cached signatures for this section and compare
  // in-process — keeps the similarity math in one place
  // (lib/content-similarity.ts) rather than duplicated in SQL. Capped and
  // ordered by hit_count (most-reused first): without a cap this scan grows
  // linearly with EVERY course ever generated for this section, forever;
  // ordering by hit_count means a genuinely popular reference course (the
  // ones actually worth matching against) is always inside the cap even
  // once the table holds far more rows than this fetches.
  const FUZZY_CANDIDATE_LIMIT = 500;
  const { data: candidates, error: candidatesError } = await supabase
    .from("studio_content_cache")
    .select("id, data, minhash_signature")
    .eq("section", section)
    .order("hit_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(FUZZY_CANDIDATE_LIMIT);

  if (candidatesError) {
    console.error("[studio-content-cache:lookup] Échec lecture (fuzzy) — génération réelle utilisée à la place:", candidatesError);
    return { hit: false };
  }
  if (!candidates || candidates.length === 0) return { hit: false };

  const signature = computeMinHashSignature(normalized);
  let best: { id: string; data: unknown; similarity: number } | null = null;
  for (const candidate of candidates as StudioCacheRow[]) {
    const similarity = estimateSimilarity(signature, candidate.minhash_signature);
    if (similarity >= SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { id: candidate.id, data: candidate.data, similarity };
    }
  }

  if (best) {
    return { hit: true, data: best.data, matchType: "fuzzy", similarity: best.similarity, cacheRowId: best.id };
  }
  return { hit: false };
}

/**
 * Stores a freshly-generated (or regenerated) Studio result for future
 * cross-student reuse. `data` is assumed already zod-validated by the
 * caller (STUDIO_SCHEMAS) — this is the only way a row ever enters the
 * table, so a later cache HIT never needs to re-validate what it reads
 * back. Fail-open: a write failure is logged, never thrown — the student's
 * own generation already succeeded and must not be blocked by a caching
 * side-effect failing.
 */
export async function storeStudioContentCache(section: JsonSectionId, rawText: string, data: unknown): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseAdmin();
  const normalized = normalizeText(rawText);
  const hash = sha256(normalized);
  const signature = computeMinHashSignature(normalized);

  const { error } = await supabase.from("studio_content_cache").upsert(
    {
      section,
      content_hash: hash,
      minhash_signature: signature,
      normalized_length: normalized.length,
      data,
    },
    { onConflict: "section,content_hash" }
  );

  if (error) {
    console.error("[studio-content-cache:store] Échec écriture (fail-open — la génération reste utilisable):", error);
  }
}

/** Atomic hit-counter bump on every cache hit, mirroring the retired courses_cache table's own increment_cache_hit_count (see that migration's comment in supabase/schema.sql) — purely for visibility into how much this is actually saving, never load-bearing for correctness. */
export async function recordStudioCacheHit(cacheRowId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("increment_studio_cache_hit_count", { p_cache_id: cacheRowId });
  if (error) console.error("[studio-content-cache:hit] Échec incrément hit_count (non bloquant):", error);
}
