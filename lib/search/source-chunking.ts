/**
 * Splits a course's RAW SOURCE TEXT (the PDF/DOCX/PPTX extraction, before
 * any Studio generation) into embeddable chunks — distinct from
 * lib/search/chunking.ts, which chunks already-generated content (search
 * only). This exists so a brand-new upload, which has no generated sections
 * yet, can still be compared against other courses at the paragraph level —
 * see supabase/schema.sql's course_source_chunks/studio_course_chunks and
 * match_similar_source_chunks/match_similar_studio_chunks, and the
 * chunk-based Smart Clone / Cross-University Chunk Caching pipelines in
 * lib/course-generation-shared.ts and lib/studio-explication-delta.ts.
 *
 * ADAPTIVE splitting — found necessary from a real cross-university test: a
 * PPTX (slide-per-textbox extraction via officeparser) produces almost no
 * double-newline paragraph breaks, so the OLD double-newline-only splitter
 * collapsed an entire 21,000-character deck into just 1-2 giant, multi-topic
 * blocks, while a same-length PDF split cleanly into ~11 focused ones. A
 * near-verbatim identical passage (confirmed by hand: "Le caractère
 * superficiel de l'olécrane rend compte de la relative fréquences des
 * fractures ouvertes...") measured only 0.86 cosine similarity instead of
 * the expected ≥0.90+ — not because the content differed, but because it
 * was diluted inside an oversized, unrelated-topic-mixed block on one side
 * and cleanly isolated on the other. Splitting granularity was silently
 * punishing PPTX/DOCX uploads relative to PDF ones, for a reason that has
 * nothing to do with the actual medical content's similarity.
 *
 * The fix progressively tries FINER split strategies only when a coarser
 * one hasn't actually produced chunk-sized units — never the reverse, so a
 * well-structured document (real paragraph breaks) is never needlessly
 * split finer than it needs to be.
 */

// ~2,200 characters keeps a chunk small enough for a precise per-paragraph
// comparison while staying well under any embedding-model input limit.
const TARGET_CHUNK_CHARS = 2200;
// Bounds embedding calls per upload — 25 chunks × text-embedding-3-small's
// $0.02/M tokens is a rounding error (well under $0.001/course) even at the
// 60,000-character source cap, so this is a safety bound, not a cost one.
const MAX_CHUNKS = 25;

/**
 * A split "worked" if it produced more than one unit AND those units are,
 * on average, not dramatically larger than a single target chunk — the
 * exact symptom a PPTX's near-absent double-newlines produces is 1-2 units
 * covering the WHOLE document, each many times TARGET_CHUNK_CHARS. 1.5x is
 * the same tolerance the final fixed-slice fallback below already used
 * (kept identical rather than inventing a second magic number).
 */
function isFineGrainedEnough(units: string[], totalLength: number): boolean {
  if (units.length < 2) return false;
  const avgUnitLength = totalLength / units.length;
  return avgUnitLength <= TARGET_CHUNK_CHARS * 1.5;
}

/**
 * Progressively finer splitting strategies, each tried only if the
 * previous one didn't yield chunk-sized units:
 *  1. Double newline — real paragraph breaks (PDFs, DOCX with proper
 *     paragraph spacing). The best signal when it's actually present.
 *  2. Single newline — one bullet/line/slide-textbox per line, which is
 *     what officeparser's PPTX extraction (and some DOCX exports) actually
 *     produces instead of blank-line-separated paragraphs.
 *  3. Sentence boundaries — for genuinely no-newline blobs (a badly-OCR'd
 *     scan, or extraction that flattened everything onto one line). A
 *     naive regex (mis-splits on abbreviations/decimals occasionally) is
 *     still strictly better than treating the whole document as one
 *     indivisible unit for chunk-boundary purposes.
 *  4. Give up — returns the whole text as one unit; the caller's existing
 *     fixed-size character slicing is the final, guaranteed-to-terminate
 *     safety net for this genuinely pathological case.
 */
function splitIntoUnits(rawText: string): string[] {
  const byParagraph = rawText.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (isFineGrainedEnough(byParagraph, rawText.length)) return byParagraph;

  const byLine = rawText.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (isFineGrainedEnough(byLine, rawText.length)) return byLine;

  const bySentence = rawText
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÿ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bySentence.length > 1) return bySentence;

  return [rawText.trim()].filter(Boolean);
}

export function buildSourceChunks(rawText: string): string[] {
  const units = splitIntoUnits(rawText);
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > TARGET_CHUNK_CHARS) {
      chunks.push(current);
      current = unit;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  }
  if (current) chunks.push(current);

  // Absolute last resort: even sentence-splitting failed to produce more
  // than one usable unit (or the single resulting "chunk" is still
  // oversized) — fall back to fixed-size slicing so the document still gets
  // chunked rather than compared as one indivisible block.
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
