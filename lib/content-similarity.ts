/**
 * Zero-API-cost near-duplicate detection for the cross-student Studio
 * content cache (see studio_content_cache in supabase/schema.sql and
 * lib/studio-content-cache.ts). Two tiers, both pure TypeScript — neither
 * one spends a single OpenRouter token to decide whether two courses are
 * "the same":
 *
 *  1. Exact: sha256 of the NORMALIZED text. Catches byte-different-but-
 *     substantively-identical uploads (a re-export, a re-OCR, different
 *     line endings) that a raw file-hash would miss.
 *  2. Fuzzy: a MinHash signature (Broder, 1997) over 5-word shingles of the
 *     normalized text. Comparing two signatures' fraction of matching
 *     positions is an unbiased estimator of the two texts' Jaccard
 *     (shingle-set) similarity — this is what catches "same course,
 *     different professor's formatting/paragraph order" (~90% overlap)
 *     that an exact hash can never match, again without ever calling an
 *     embeddings API.
 *
 * Deliberately NOT using pgvector/embeddings for the fuzzy tier: this
 * project already has a `content_embedding vector(1536)` column on the
 * legacy `courses` table for semantic search, but generating an embedding
 * is itself a paid API call — spending money to decide whether NOT to spend
 * money would defeat the point of a cost-protection cache. MinHash is
 * free, deterministic, and good enough for "is this the same reference
 * material" at the ~85-90% band this cache cares about.
 */

import { createHash } from "crypto";

const SHINGLE_SIZE = 5; // 5-word shingles — long enough to be meaningful, short enough that reordering one sentence doesn't zero out every shingle in it
const NUM_HASHES = 64; // 64 independent hash functions — enough resolution to distinguish similarity bands in roughly 1.5% increments

/** Collapses case/punctuation/whitespace so trivial formatting differences (smart quotes, extra blank lines, a stray page-number footer) never affect either matching tier. Unicode-aware so accented French text shingles correctly. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sha256(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function shingles(normalized: string): Set<string> {
  const words = normalized.split(" ").filter(Boolean);
  const result = new Set<string>();
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++) {
    result.add(words.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return result;
}

// Fixed seeds (one odd multiplier + one additive constant per hash
// function) so the SAME shingle always hashes to the SAME value across
// every call — required for MinHash to mean anything at all.
const HASH_SEEDS = Array.from({ length: NUM_HASHES }, (_, i) => ({
  a: 2 * i + 1,
  b: (i * 2654435761) >>> 0,
}));

function hash32(str: string, seed: { a: number; b: number }): number {
  let h = seed.b;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h ^ str.charCodeAt(i), seed.a) + 0x9e3779b9) >>> 0;
  }
  return h;
}

/** A fixed-size (NUM_HASHES-length) fingerprint, comparable across any two texts regardless of their original length. */
export function computeMinHashSignature(normalized: string): number[] {
  const shingleSet = shingles(normalized);
  if (shingleSet.size === 0) {
    // Too short to shingle at all (a handful of words) — every hash would
    // otherwise trivially match every other short text's signature. This
    // sentinel can never equal a real signature, so short texts simply
    // never fuzzy-match anything (they still get an exact-hash shot).
    return new Array(NUM_HASHES).fill(-1);
  }
  const signature = new Array(NUM_HASHES).fill(Infinity);
  for (const shingle of shingleSet) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = hash32(shingle, HASH_SEEDS[i]);
      if (h < signature[i]) signature[i] = h;
    }
  }
  return signature;
}

/** Fraction of matching positions between two MinHash signatures — an unbiased estimate of the two source texts' Jaccard similarity. */
export function estimateSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / a.length;
}
