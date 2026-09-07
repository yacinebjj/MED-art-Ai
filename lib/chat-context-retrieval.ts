/**
 * Question-specific chunk retrieval for course-scoped chat
 * (app/api/courses/chat/route.ts) — the ONLY source of course context that
 * route is allowed to use (see its own "no raw_text, ever" rule). Reuses the
 * SAME chunk+embedding infrastructure already built for Cross-University
 * Chunk Caching (studio_course_chunks) and the legacy Smart Clone pipeline
 * (course_source_chunks) — no new indexing pipeline, no new migration.
 *
 * Cosine similarity is computed IN-PROCESS, not via a SQL RPC: a course has
 * at most MAX_CHUNKS=25 chunks (lib/search/source-chunking.ts), so ranking
 * them in JS after one batched fetch is simpler than a new RPC and cheap at
 * that scale.
 *
 * Fails open by construction — returns `null` on any missing index, DB
 * error, or embedding-call failure. `null` means "no course context block at
 * all, model answers from general medical knowledge" — there is no fallback
 * to full raw text anywhere in this codebase; this function's return value
 * is a hard ceiling on how much course text a chat turn can ever send.
 */

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getEmbedding } from "@/lib/ai/embeddings";

/**
 * "Top-3 chirurgical" — 3 chunks × ~2200 chars (lib/search/source-chunking.ts's
 * TARGET_CHUNK_CHARS) is ~6,600 characters (~1,700-2,000 tokens), a hard,
 * deliberate cut from the previous TOP_K=6 (~13,000 chars) specifically to
 * keep this route's input-token floor low regardless of course size —
 * targeting the single most relevant slice of the course precisely, rather
 * than a broader-but-noisier spread. A tighter K also means a more focused,
 * less diluted retrieval signal for the model to actually answer from.
 */
const TOP_K = 3;

/**
 * A genuinely broad question ("résume-moi tout le cours", "fais-moi un plan
 * de révision") is exactly the case where TOP_K=6 by similarity-to-the-
 * question can under-cover the material — a diffuse/generic question embeds
 * diffusely, so ranking against it doesn't reliably surface the right
 * breadth. This used to fall back to the FULL course text — strictly
 * forbidden now (see app/api/courses/chat/route.ts's own "no raw_text,
 * ever" rule, added after ~$0.03-0.04/message reports traced back to
 * exactly that fallback). Widened retrieval (TOP_K_BROAD chunks instead of
 * TOP_K) is the bounded compromise: meaningfully more coverage for a genuine
 * "résumé"-style ask, while staying a small, fixed multiple of one chunk's
 * size — never the unbounded whole document. Keyword-based, not exhaustive.
 */
const BROAD_QUESTION_PATTERN =
  /r[ée]sum[ée]|l'ensemble|tout le cours|vue d'ensemble|plan de r[ée]vision|synth[èe]se compl[èe]te|de a [àa] z|dans sa globalit[ée]/i;
const TOP_K_BROAD = 6; // same halving as TOP_K's 6→3 cut, kept proportionally wider for genuine "résumé" asks.

/** Exported so lib/chat-model-routing.ts can route a broad question to the stronger model without duplicating this regex — it's synthesizing across more chunks (TOP_K_BROAD), which warrants the more capable tier. */
export function isBroadQuestion(question: string): boolean {
  return BROAD_QUESTION_PATTERN.test(question);
}

/**
 * "Micro-chunking" for the CHAT's consumption of a chunk, applied HERE at
 * the retrieval/serving layer — deliberately NOT by shrinking
 * lib/search/source-chunking.ts's TARGET_CHUNK_CHARS (~2200 chars), which is
 * the SAME chunk size Cross-University Chunk Caching's CHUNK_MATCH_THRESHOLD
 * (0.85, lib/studio-explication-delta.ts) was empirically validated against,
 * and which also shapes the Explication-generation "Extrait N" prompts
 * (lib/course-generation-shared.ts). Shrinking that shared constant would
 * silently change chunk granularity for BOTH of those unrelated features —
 * invalidating a threshold that was checked against real matched text, and
 * altering generation behavior nobody asked to touch in this pass. A stored
 * chunk still gets built at ~2200 chars; only what the CHAT model actually
 * reads from it is cut down here, to ~350-400 tokens (~1,300-1,600 chars at
 * French's ~3.5-4 chars/token). 3 chunks × ~1,400 chars ≈ 1,050-1,200 tokens
 * of course context — comfortably inside the session's <1,500-token input
 * target once the (now-tiny) persona and the question itself are added.
 */
const MAX_CHUNK_CHARS_FOR_CHAT = 1400;

/**
 * Hybrid Validation Layer — for a Workspace course whose "Explication
 * Ultra-Détaillée" already exists (studio_course_explication_chapters,
 * populated by lib/studio-explication-delta.ts whenever that section is
 * generated — see that file's own comment on which code paths populate it),
 * a retrieved slot is upgraded from the plain raw chunk to that chunk's
 * polished, clinically-structured Explication chapter (found via
 * source_chunk_indices, the SAME link already stored when the chapter was
 * generated — no new embedding call, no new migration), PLUS a small raw-
 * text "micro-anchor" from the original chunk it was built from.
 *
 * This is NOT the literal "ground every chat answer in the Explication
 * instead of the source" design that was proposed and explicitly declined —
 * that risked the model's own prior elaboration silently becoming the new
 * "ground truth", with no way to catch a drift back against the actual
 * course material. Keeping a real raw-text anchor alongside the polished
 * text, with an explicit "the anchor wins on conflict" instruction (see
 * lib/chat-system-prompt.ts), is what makes this a genuine safety net
 * rather than a compounding-error risk — never the sole source.
 *
 * Falls back to the plain raw chunk (unchanged prior behavior) whenever: no
 * Explication exists yet for this course (a student can still open chat
 * before ever touching Studio), a chunk isn't referenced by any chapter, or
 * this is the legacy course_source_chunks path (no chapter concept there).
 *
 * Budgeted to roughly the SAME per-slot size as a plain chunk (1400 chars)
 * — this upgrades WHAT a slot contains, it does not add a 4th thing to the
 * budget already fixed by TOP_K.
 */
const EXPLICATION_SLOT_CHARS = 1000;
const ANCHOR_SLOT_CHARS = 350;

/**
 * Hard-cuts `text` at `maxChars`, but backs off to the last sentence-ending
 * punctuation within that budget when one exists reasonably close to the
 * cut point (within the last 30%) — a plain hard cut mid-sentence still
 * reads as a broken thought to the model; this keeps the truncated chunk
 * self-contained without meaningfully changing the token budget.
 */
function truncateToBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastBoundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "), slice.lastIndexOf("\n"));
  if (lastBoundary >= maxChars * 0.7) return slice.slice(0, lastBoundary + 1).trim();
  return slice.trim();
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface ChunkRow {
  content: string;
  embedding: number[] | string;
  chunk_index?: number;
}

interface ExplicationChapterRow {
  heading: string;
  content: string;
  source_chunk_indices: number[] | null;
}

/** pgvector columns sometimes come back as a string ("[0.1,0.2,...]") depending on the client/driver path — normalizes either shape to a real number[]. */
function toEmbeddingArray(value: number[] | string): number[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export type ChunkSource = { studioCourseId: number } | { legacyCourseSlug: string };

/**
 * Returns the top-K most relevant chunks' text (joined), or `null` if this
 * course has no indexed chunks yet or anything failed along the way — every
 * `null` case means "caller answers from general medical knowledge, with NO
 * course context block at all". It is NOT a license to fall back to the full
 * course text anywhere upstream — that fallback no longer exists in this
 * codebase, by strict product rule (see this route's own callers).
 */
export async function retrieveRelevantContext(question: string, source: ChunkSource): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const topK = BROAD_QUESTION_PATTERN.test(question) ? TOP_K_BROAD : TOP_K;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } =
      "studioCourseId" in source
        ? await supabase.from("studio_course_chunks").select("content, embedding, chunk_index").eq("course_id", source.studioCourseId)
        : await supabase.from("course_source_chunks").select("content, embedding").eq("course_slug", source.legacyCourseSlug);

    if (error) {
      console.error("[chat-context-retrieval] Échec lecture des chunks (fail-open, aucun contexte de cours):", error.message);
      return null;
    }
    if (!data || data.length === 0) return null; // not indexed yet — no context, don't fail.

    // The embedding call (getEmbedding, a REAL paid OpenRouter call) only
    // fires past this point — deliberately AFTER confirming chunks actually
    // exist, never before, so an unindexed course never pays for a wasted
    // embedding. But once we know chunks exist, the Explication-chapters
    // lookup below doesn't depend on the embedding result (or vice versa) —
    // only on `source`, already known — so the two run concurrently instead
    // of strictly one after the other, shaving a full DB round trip off this
    // route's pre-stream latency for every Workspace-course chat message.
    const [questionEmbedding, chapterFetch] = await Promise.all([
      getEmbedding(question),
      "studioCourseId" in source
        ? supabase.from("studio_course_explication_chapters").select("heading, content, source_chunk_indices").eq("course_id", source.studioCourseId)
        : Promise.resolve(null),
    ]);

    const ranked = (data as ChunkRow[])
      .map((row) => ({ content: row.content, chunkIndex: row.chunk_index, similarity: cosineSimilarity(questionEmbedding, toEmbeddingArray(row.embedding)) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    if (ranked.length === 0) return null;

    // Hybrid Validation Layer (see EXPLICATION_SLOT_CHARS's own comment) —
    // only attempted for Workspace courses, and only actually used per-slot
    // when that specific chunk is referenced by an already-generated
    // Explication chapter. Already fetched above, concurrently with the
    // embedding call.
    let chapterByChunkIndex: Map<number, ExplicationChapterRow> | null = null;
    if ("studioCourseId" in source && chapterFetch) {
      const { data: chapterData, error: chapterError } = chapterFetch;
      if (chapterError) {
        console.error("[chat-context-retrieval] Échec lecture chapitres d'Explication (fail-open, chunks bruts utilisés):", chapterError.message);
      } else if (chapterData && chapterData.length > 0) {
        chapterByChunkIndex = new Map();
        for (const chapter of chapterData as ExplicationChapterRow[]) {
          for (const idx of chapter.source_chunk_indices ?? []) {
            if (!chapterByChunkIndex.has(idx)) chapterByChunkIndex.set(idx, chapter);
          }
        }
      }
    }

    const slots = ranked.map((r) => {
      const chapter = chapterByChunkIndex && r.chunkIndex !== undefined ? chapterByChunkIndex.get(r.chunkIndex) : undefined;
      if (!chapter) return truncateToBudget(r.content, MAX_CHUNK_CHARS_FOR_CHAT);

      const polished = truncateToBudget(chapter.content, EXPLICATION_SLOT_CHARS);
      const anchor = truncateToBudget(r.content, ANCHOR_SLOT_CHARS);
      return `[Explication déjà validée — "${chapter.heading}"]\n${polished}\n\n[Extrait source original — référence de contrôle]\n${anchor}`;
    });

    return slots.join("\n\n---\n\n");
  } catch (error) {
    console.error("[chat-context-retrieval] Échec récupération (fail-open, aucun contexte de cours):", error instanceof Error ? error.message : error);
    return null;
  }
}
