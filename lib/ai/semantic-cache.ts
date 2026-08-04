import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getEmbedding } from "@/lib/ai/embeddings";

/**
 * Cosine similarity threshold for a cache hit. Set per product decision:
 * 0.88 balances hit-rate against the correctness risk of a medical platform
 * serving a subtly-wrong stored answer (e.g. "signes de gastrite" vs "signes
 * de gastrite atrophique") — a missed cache opportunity only costs one
 * avoidable OpenRouter call, a false hit costs a student a wrong answer.
 * Tune only after reviewing real near-miss pairs from production logs.
 */
export const SEMANTIC_CACHE_THRESHOLD = 0.88;

interface CacheMatchRow {
  id: string;
  question: string;
  answer: string;
  similarity: number;
}

export interface SemanticCacheHit {
  answer: string;
  similarity: number;
  matchedQuestion: string;
}

/**
 * Embeds `question` and searches `semantic_cache` via the `match_semantic_cache`
 * Postgres RPC (cosine similarity over pgvector), scoped to `courseSlug`.
 *
 * Fail-open by construction: ANY failure here (Supabase not configured,
 * embedding call down, RPC error, malformed response) is caught and resolves
 * to `null` — never throws. The caller treats `null` exactly like a genuine
 * cache miss and falls through to a normal OpenRouter call, so a broken cache
 * layer degrades to "slightly slower/costlier", never to a blocked student.
 *
 * `courseSlug` is passed straight through to the RPC's `match_course_slug`
 * parameter, which the SQL function uses as a strict equality filter when
 * non-null (see supabase/schema.sql) — a lookup scoped to the Pleurésie
 * course can only ever match rows stored under that exact same slug, never
 * a Gastrite row. Only pass `null` for genuinely course-agnostic chat (no
 * course loaded at all); never loosen this to "search nearby courses" — that
 * is exactly the cross-contamination this scoping exists to prevent.
 */
export async function lookupSemanticCache(params: {
  question: string;
  courseSlug: string | null;
}): Promise<SemanticCacheHit | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const embedding = await getEmbedding(params.question);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc("match_semantic_cache", {
      query_embedding: embedding,
      match_course_slug: params.courseSlug,
      match_threshold: SEMANTIC_CACHE_THRESHOLD,
      match_count: 1,
    });

    if (error) {
      console.error("[semantic-cache] Échec recherche vectorielle — fail-open vers OpenRouter:", error.message);
      return null;
    }

    const matches = data as CacheMatchRow[] | null;
    if (!matches || matches.length === 0) return null;

    const best = matches[0];
    console.log(
      `[SEMANTIC CACHE] HIT - 0$ API cost (similarité ${best.similarity.toFixed(4)}, seuil ${SEMANTIC_CACHE_THRESHOLD}, cours="${params.courseSlug ?? "toutes"}")`
    );
    return { answer: best.answer, similarity: best.similarity, matchedQuestion: best.question };
  } catch (error) {
    console.error(
      "[semantic-cache] Échec lookup — fail-open vers OpenRouter:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Best-effort, non-blocking write of a freshly-generated (question, answer)
 * pair into `semantic_cache`, so the next student asking a similar question —
 * on this course, and only this course — gets an instant, free answer.
 * Swallows every possible failure (embedding call, Supabase insert) and only
 * logs — the student already has their answer either way by the time this
 * runs, so nothing here should ever surface as a user-facing error.
 */
export async function storeSemanticCacheEntry(params: {
  question: string;
  answer: string;
  courseSlug: string | null;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const embedding = await getEmbedding(params.question);
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from("semantic_cache").insert({
      course_slug: params.courseSlug,
      question: params.question,
      answer: params.answer,
      embedding,
    });

    if (error) {
      console.error("[semantic-cache] Échec écriture cache (non bloquant, réponse déjà servie à l'étudiant):", error.message);
      return;
    }

    console.log(`[SEMANTIC CACHE] Nouvelle entrée enregistrée (cours="${params.courseSlug ?? "aucun"}") pour les prochains étudiants.`);
  } catch (error) {
    console.error(
      "[semantic-cache] Échec écriture cache — exception (non bloquant, réponse déjà servie à l'étudiant):",
      error instanceof Error ? error.message : error
    );
  }
}
