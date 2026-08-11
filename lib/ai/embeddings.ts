import { USE_MOCK_AI } from "@/lib/ai/openrouter";

const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
// 1536-dimension embeddings — confirmed live against OpenRouter tonight
// (real 200 response, real vector returned). Must match the `vector(1536)`
// column width in the semantic_cache table SQL exactly, or every insert
// will fail with a dimension-mismatch error.
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
// text-embedding-3-small's real context ceiling is 8191 tokens. 24,000
// characters stays safely under that even for dense/accented French text
// (worst case ~3 chars/token), leaving real headroom instead of cutting
// right at the edge. Previously capped at 8,000 CHARACTERS (~2,000 tokens —
// far below the model's actual limit), which meant content_embedding (Smart
// Clone's whole-document fingerprint, see supabase/schema.sql) only ever
// "saw" the first ~13% of a max-length (60,000 char) course — a real source
// of false negatives: two courses identical past their first few paragraphs
// but with a different cover page or OCR noise up front could miss the 0.90
// similarity threshold entirely, never being recognized as the same course.
const EMBEDDING_MAX_INPUT_CHARS = 24_000;

/** FNV-1a — cheap, deterministic string → 32-bit integer, used only to seed the mock vector's PRNG below. Not cryptographic, doesn't need to be. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG — deterministic from a numeric seed, so the exact same input text always produces the exact same mock vector across calls/requests. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zero-cost stand-in for the real embedding call in local development
 * (gated by the same USE_MOCK_AI flag as lib/ai/openrouter.ts). Deterministic
 * per exact input string — asking the *same* question twice in dev still
 * produces a cosine-similarity-1.0 match against its own earlier cache entry,
 * which is enough to exercise the full cache-hit code path end to end without
 * spending a single real OpenRouter credit. It will NOT usefully cluster
 * paraphrases the way a real embedding model does (it has no notion of
 * meaning) — verifying real semantic near-misses requires a staging/prod
 * environment with USE_MOCK_AI unset.
 */
function buildMockEmbedding(text: string): number[] {
  const random = mulberry32(hashSeed(text.trim().toLowerCase()));
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => random() * 2 - 1);
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

/** Generates a single embedding vector via OpenRouter. Used both to index a new cache entry and to query for a semantically similar past question. */
export async function getEmbedding(text: string): Promise<number[]> {
  if (USE_MOCK_AI) {
    console.log("[MOCK AI] getEmbedding interceptée — vecteur déterministe généré localement, aucun appel réel à OpenRouter.");
    return buildMockEmbedding(text);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY n'est pas configurée sur le serveur.");
  }

  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, EMBEDDING_MAX_INPUT_CHARS) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Échec génération d'embedding (${res.status}) : ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Réponse d'embedding inattendue.");
  }
  return embedding;
}
