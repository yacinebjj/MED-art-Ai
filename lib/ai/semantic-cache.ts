import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getEmbedding } from "@/lib/ai/embeddings";
import { isBroadQuestion } from "@/lib/chat-context-retrieval";

/**
 * Cosine similarity threshold for a cache hit. Lowered from 0.88 after
 * production reports of a 100%-MISS rate — 0.88 on text-embedding-3-small is
 * closer to "near-duplicate wording" than "same clinical question, different
 * phrasing": real French medical questions with the same intent routinely
 * land in the 0.80-0.87 band, so 0.88 was quietly rejecting almost every
 * legitimate repeat question, not just the genuinely-different ones. 0.85
 * mirrors the threshold already vetted this session for chunk-level
 * cross-university matching (see lib/studio-explication-delta.ts's
 * CHUNK_MATCH_THRESHOLD) — same underlying model family, same order of
 * magnitude of acceptable false-hit risk.
 *
 * IMPORTANT: this is a reasoned adjustment, not an empirically-verified-safe
 * number the way the chunk threshold was (that one was checked against real
 * matched text side-by-side; this one wasn't, because it needed real
 * near-miss QUESTION pairs from production logs, which didn't exist yet — a
 * missed cache costs one OpenRouter call, a false hit costs a student a
 * wrong answer, so this must keep being watched, not treated as settled.
 * lookupSemanticCache/lookupAssistantCache now log the BEST candidate's real
 * similarity on every call, hit or miss (previously only logged "MISS" with
 * no score at all) — read those logs before adjusting this further.
 */
export const SEMANTIC_CACHE_THRESHOLD = 0.85;

/**
 * The real lever for driving average cost-per-message toward ~$0.0001: not
 * squeezing a single real generation further (already near its realistic
 * floor for the depth this platform requires — verified against real
 * OpenRouter/Anthropic pricing, see this session's own cost breakdowns), but
 * maximizing how often a message costs $0 at all. A blended average of
 * (1 - hit_rate) × real_generation_cost only reaches the target if hit_rate
 * is high — and this platform's whole population studies the SAME national
 * curriculum, so a purely conceptual/definitional question ("physiopathologie
 * de l'appendicite") has the SAME correct answer whether it was triggered by
 * a Blida course PDF or an Alger one. The exact-course scope in
 * lookupSemanticCache below never exploited that: two students at different
 * universities asking the identical general question never shared a hit.
 *
 * match_semantic_cache's SQL (supabase/schema.sql) ALREADY supports a
 * cross-course wildcard lookup (`match_course_slug is null` matches any
 * course_slug) — built for this from the start, never actually called with
 * `null` by any real caller until this tier. No migration needed.
 *
 * Tier 2 (global) is deliberately held to a STRICTER threshold than tier 1
 * (exact course scope): reusing an answer across two DIFFERENT courses'
 * material is a real, if usually small, step up in correctness risk (one
 * course's classification/protocol emphasis could genuinely differ from
 * another's) — mirrors this session's established pattern of a stricter bar
 * for cross-source reuse (see CHUNK_MATCH_THRESHOLD's own tiering logic).
 * Every global-tier hit logs distinctly so this can be audited, same
 * discipline as studio_cross_university_reuse_log.
 */
export const GLOBAL_CACHE_THRESHOLD = 0.9;

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
async function queryCacheTier(
  embedding: number[],
  matchCourseSlug: string | null
): Promise<CacheMatchRow | null> {
  const supabase = getSupabaseAdmin();
  // match_threshold: 0 — fetch the single BEST candidate regardless of the
  // real threshold, applied here in app code instead of inside the SQL. See
  // SEMANTIC_CACHE_THRESHOLD's own comment for why a miss must still carry
  // the real best-candidate score, not just "no match".
  const { data, error } = await supabase.rpc("match_semantic_cache", {
    query_embedding: embedding,
    match_course_slug: matchCourseSlug,
    match_threshold: 0,
    match_count: 1,
  });
  if (error) {
    console.error("[semantic-cache] Échec recherche vectorielle — fail-open vers OpenRouter:", error.message);
    return null;
  }
  return (data as CacheMatchRow[] | null)?.[0] ?? null;
}

export async function lookupSemanticCache(params: {
  question: string;
  courseSlug: string | null;
}): Promise<SemanticCacheHit | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const embedding = await getEmbedding(params.question);

    // Tier 1 — exact course scope, the precise/lower-risk tier.
    const exact = await queryCacheTier(embedding, params.courseSlug);
    if (exact && exact.similarity >= SEMANTIC_CACHE_THRESHOLD) {
      console.log("[SEMANTIC_CACHE] 🟢 HIT (exact) - Score:", exact.similarity.toFixed(4), "Course:", params.courseSlug ?? "toutes");
      return { answer: exact.answer, similarity: exact.similarity, matchedQuestion: exact.question };
    }

    // Tier 2 — cross-course global fallback (see GLOBAL_CACHE_THRESHOLD's
    // own comment for the full rationale). Only meaningful when tier 1 was
    // itself scoped to a specific course (courseSlug non-null) — a genuinely
    // course-agnostic call already WAS the global lookup. Skipped for broad
    // "résume tout le cours"-style questions, which are inherently tied to
    // THIS course's specific material and unsafe to answer from a different
    // course's cached reply.
    let global: CacheMatchRow | null = null;
    if (params.courseSlug !== null && !isBroadQuestion(params.question)) {
      global = await queryCacheTier(embedding, null);
    }

    if (global && global.similarity >= GLOBAL_CACHE_THRESHOLD) {
      console.log("[SEMANTIC_CACHE] 🟢 HIT (cross-cours) - Score:", global.similarity.toFixed(4), `(seuil ${GLOBAL_CACHE_THRESHOLD})`, "— question d'origine:", params.courseSlug ?? "aucun");
      return { answer: global.answer, similarity: global.similarity, matchedQuestion: global.question };
    }

    // Real hit/miss telemetry, now with both tiers' best-candidate scores —
    // added so the hit-rate AND the near-miss margin can both be read from
    // production logs instead of assumed for a financial projection. Only
    // logged when this function genuinely ran (RPC succeeded) — NOT for the
    // quick-action/bare-greeting cases that skip this function entirely,
    // which aren't cache misses, they're not lookups.
    console.log(
      "[SEMANTIC_CACHE] 🔴 MISS - Meilleur score exact:",
      exact ? exact.similarity.toFixed(4) : "aucun candidat",
      `(seuil ${SEMANTIC_CACHE_THRESHOLD})`,
      "| cross-cours:",
      global ? global.similarity.toFixed(4) : "non tenté/aucun candidat",
      `(seuil ${GLOBAL_CACHE_THRESHOLD})`,
      "Course:", params.courseSlug ?? "aucun"
    );
    return null;
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
 *
 * Also mirrors this entry into the GLOBAL (courseSlug: null) scope — the
 * write-side half of lookupSemanticCache's tier-2 cross-course fallback —
 * whenever `courseSlug` is a real course and the question isn't broad (same
 * gate as the lookup side, for the same reason: a "résume tout le cours"
 * answer is never safe to hand to a different course's student). This is
 * what actually POPULATES tier 2 over time — without this mirrored write,
 * the cross-course lookup would only ever find rows that happen to already
 * be scoped null, which never occurs in real course-chat traffic. The SAME
 * embedding is reused for both inserts — no second embedding call.
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
    } else {
      console.log(`[SEMANTIC CACHE] Nouvelle entrée enregistrée (cours="${params.courseSlug ?? "aucun"}") pour les prochains étudiants.`);
    }

    if (params.courseSlug !== null && !isBroadQuestion(params.question)) {
      const { error: globalError } = await supabase.from("semantic_cache").insert({
        course_slug: null,
        question: params.question,
        answer: params.answer,
        embedding,
      });
      if (globalError) {
        console.error("[semantic-cache] Échec écriture cache global cross-cours (non bloquant):", globalError.message);
      } else {
        console.log("[SEMANTIC CACHE] Entrée cross-cours (global) enregistrée pour réutilisation inter-universités.");
      }
    }
  } catch (error) {
    console.error(
      "[semantic-cache] Échec écriture cache — exception (non bloquant, réponse déjà servie à l'étudiant):",
      error instanceof Error ? error.message : error
    );
  }
}

export interface AssistantCacheHit {
  cacheId: string;
  answer: string;
  similarity: number;
  matchedQuestion: string;
}

/**
 * Standalone MedArt Assistant equivalent of lookupSemanticCache() above —
 * DELIBERATELY backed by its own table (`assistant_semantic_cache`) and RPC
 * (`match_assistant_cache`), not a call into `semantic_cache` with
 * `courseSlug: null`. See that table's own comment in supabase/schema.sql
 * for why: `match_course_slug: null` is a documented cross-course WILDCARD
 * there (matches any course_slug), which would let a course-chat answer
 * (different persona/system-prompt entirely) leak into an Assistant reply.
 * `match_academic_year_id` here instead uses null-safe strict equality
 * (`is not distinct from`) — a yearless student's questions only ever match
 * other yearless students', never a specific year's cached answer, since a
 * medical answer's appropriate depth genuinely varies by curriculum level.
 * Fail-open by construction, exactly like lookupSemanticCache().
 */
export async function lookupAssistantCache(params: {
  question: string;
  academicYearId: number | null;
}): Promise<AssistantCacheHit | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const embedding = await getEmbedding(params.question);
    const supabase = getSupabaseAdmin();

    // Same fix as lookupSemanticCache above — fetch the best candidate
    // regardless of threshold, apply SEMANTIC_CACHE_THRESHOLD here, and log
    // its real score on every call so a 100%-MISS pattern is diagnosable
    // instead of a black box.
    const { data, error } = await supabase.rpc("match_assistant_cache", {
      query_embedding: embedding,
      match_academic_year_id: params.academicYearId,
      match_threshold: 0,
      match_count: 1,
    });

    if (error) {
      console.error("[assistant-cache] Échec recherche vectorielle — fail-open vers OpenRouter:", error.message);
      return null;
    }

    const matches = data as { id: string; question: string; answer: string; similarity: number }[] | null;
    const best = matches?.[0] ?? null;

    if (!best || best.similarity < SEMANTIC_CACHE_THRESHOLD) {
      console.log(
        "[ASSISTANT_CACHE] 🔴 MISS - Meilleur score:",
        best ? best.similarity.toFixed(4) : "aucun candidat",
        `(seuil ${SEMANTIC_CACHE_THRESHOLD})`,
        "Année académique:", params.academicYearId ?? "aucune"
      );
      return null;
    }

    console.log("[ASSISTANT_CACHE] 🟢 HIT - Score:", best.similarity.toFixed(4), "Année académique:", params.academicYearId ?? "aucune");
    return { cacheId: best.id, answer: best.answer, similarity: best.similarity, matchedQuestion: best.question };
  } catch (error) {
    console.error(
      "[assistant-cache] Échec lookup — fail-open vers OpenRouter:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/** Best-effort, non-blocking write of a freshly-generated (question, answer) pair into `assistant_semantic_cache`. Swallows every possible failure and only logs — the student already has their answer either way by the time this runs. */
export async function storeAssistantCacheEntry(params: {
  question: string;
  answer: string;
  academicYearId: number | null;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const embedding = await getEmbedding(params.question);
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from("assistant_semantic_cache").insert({
      academic_year_id: params.academicYearId,
      question: params.question,
      answer: params.answer,
      embedding,
    });

    if (error) {
      console.error("[assistant-cache] Échec écriture cache (non bloquant, réponse déjà servie à l'étudiant):", error.message);
      return;
    }

    console.log(`[ASSISTANT_CACHE] Nouvelle entrée enregistrée (année=${params.academicYearId ?? "aucune"}) pour les prochains étudiants.`);
  } catch (error) {
    console.error(
      "[assistant-cache] Échec écriture cache — exception (non bloquant, réponse déjà servie à l'étudiant):",
      error instanceof Error ? error.message : error
    );
  }
}

/** Purely for hit-rate visibility — never load-bearing for correctness. */
export async function recordAssistantCacheHit(cacheId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.rpc("increment_assistant_cache_hit_count", { p_id: cacheId });
    if (error) console.error("[assistant-cache:hit] Échec incrément hit_count (non bloquant):", error.message);
  } catch (error) {
    console.error("[assistant-cache:hit] Échec incrément — exception (non bloquant):", error instanceof Error ? error.message : error);
  }
}
