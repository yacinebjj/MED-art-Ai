/**
 * Splits a course's RAW SOURCE TEXT (the PDF/DOCX extraction, before any
 * Studio generation) into embeddable chunks — distinct from
 * lib/search/chunking.ts, which chunks already-generated content (search
 * only). This exists so a brand-new upload, which has no generated sections
 * yet, can still be compared against other courses at the paragraph level —
 * see supabase/schema.sql's course_source_chunks and
 * match_similar_source_chunks, and the chunk-based Smart Clone check in
 * lib/course-generation-shared.ts.
 */

// ~2,200 characters keeps a chunk small enough for a precise per-paragraph
// comparison while staying well under any embedding-model input limit.
const TARGET_CHUNK_CHARS = 2200;
// Bounds embedding calls per upload — 25 chunks × text-embedding-3-small's
// $0.02/M tokens is a rounding error (well under $0.001/course) even at the
// 60,000-character source cap, so this is a safety bound, not a cost one.
const MAX_CHUNKS = 25;

export function buildSourceChunks(rawText: string): string[] {
  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > TARGET_CHUNK_CHARS) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  // Some PDF extractions produce one giant blob with no real paragraph
  // breaks — in that case the loop above yields a single oversized chunk
  // instead of many small ones. Fall back to fixed-size slicing so the
  // document still gets chunked rather than compared as one indivisible
  // block (which would defeat the whole point of this function).
  if (chunks.length === 1 && chunks[0].length > TARGET_CHUNK_CHARS * 1.5) {
    const blob = chunks[0];
    const sliced: string[] = [];
    for (let i = 0; i < blob.length; i += TARGET_CHUNK_CHARS) {
      sliced.push(blob.slice(i, i + TARGET_CHUNK_CHARS));
    }
    return sliced.slice(0, MAX_CHUNKS);
  }

  return chunks.slice(0, MAX_CHUNKS);
}
