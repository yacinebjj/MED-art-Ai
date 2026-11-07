/**
 * Pure text anchoring for the reading surfaces (lib/reading/*): where a saved
 * passage sits in a surface's text NOW, even after the page around it moved.
 *
 * A passage is saved as a "text quote": the exact text, the character offsets
 * it had when it was saved, and a little of the text just before and after
 * it. Re-anchoring tries, in order:
 *  1. the saved offsets, when they still hold exactly the same text (the
 *     common case: same content, same rendering);
 *  2. every occurrence of the text, scored by how much of the saved context
 *     surrounds it (nearest to the old offsets on a tie) — survives text added
 *     or removed elsewhere in the surface;
 *  3. the same search with whitespace runs collapsed — survives line-break
 *     and spacing differences between two renderings.
 * A passage whose text no longer exists anywhere is not placed (null): it is
 * never painted on some other, unrelated words.
 *
 * Pure (no DOM, no imports), so it can be unit-tested on its own.
 */

/** Characters of context kept on each side of a saved passage. */
export const QUOTE_CONTEXT_CHARS = 32;
/** Occurrences examined per passage (a very common short word stops here). */
const MAX_CANDIDATES = 400;
/** A passage this short is only placed by its context, never by its text alone. */
const SHORT_QUOTE_CHARS = 8;
/** Context characters a short passage needs to match to be placed away from its saved offsets. */
const SHORT_QUOTE_MIN_CONTEXT = 4;

export interface TextQuote {
  text: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

export interface TextSpan {
  start: number;
  end: number;
}

/** The quote for `[start, end)` of `full` — what a highlight saves. */
export function captureQuote(full: string, start: number, end: number): TextQuote {
  const s = Math.max(0, Math.min(start, full.length));
  const e = Math.max(s, Math.min(end, full.length));
  return {
    text: full.slice(s, e),
    start: s,
    end: e,
    prefix: full.slice(Math.max(0, s - QUOTE_CONTEXT_CHARS), s),
    suffix: full.slice(e, e + QUOTE_CONTEXT_CHARS),
  };
}

/** Length of the longest common suffix of `a` and `b`. */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the longest common prefix of `a` and `b`. */
function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Best occurrence of `quote.text` in `full` by surrounding context, or null. */
function bestOccurrence(full: string, quote: Pick<TextQuote, "text" | "start" | "prefix" | "suffix">): TextSpan | null {
  const { text } = quote;
  let best: { start: number; score: number; distance: number } | null = null;
  let from = 0;
  for (let count = 0; count < MAX_CANDIDATES; count++) {
    const at = full.indexOf(text, from);
    if (at < 0) break;
    const before = full.slice(Math.max(0, at - quote.prefix.length), at);
    const after = full.slice(at + text.length, at + text.length + quote.suffix.length);
    const score = commonSuffixLength(quote.prefix, before) + commonPrefixLength(quote.suffix, after);
    const distance = Math.abs(at - quote.start);
    if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { start: at, score, distance };
    from = at + 1;
  }
  if (!best) return null;
  if (text.trim().length < SHORT_QUOTE_CHARS && best.score < SHORT_QUOTE_MIN_CONTEXT) return null;
  return { start: best.start, end: best.start + text.length };
}

/** Whether the UTF-16 unit `code` is whitespace for JavaScript's `\s`. */
function isWhitespaceCode(code: number): boolean {
  if (code <= 0x20) return code === 0x20 || (code >= 0x09 && code <= 0x0d);
  if (code < 0xa0) return false;
  return (
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

interface CollapsedText {
  text: string;
  /** Where each kept character came from in the uncollapsed text. */
  origin: Int32Array;
}

// One repaint locates every saved highlight of a surface in the same text, and
// each one not found as is (a lesson still mounting, an edited one) used to
// collapse the whole lesson again, character by character, with a regex test
// per character — seconds on a phone for a long course with a few highlights.
// The last collapsed text is kept for the next passage of the same text.
let lastCollapsedSource: string | null = null;
let lastCollapsed: CollapsedText | null = null;

/** `value` with every whitespace run collapsed to one space, plus where each kept character came from. */
function collapseWhitespace(value: string): CollapsedText {
  if (lastCollapsed && value === lastCollapsedSource) return lastCollapsed;
  const parts: string[] = [];
  const origin = new Int32Array(value.length);
  let kept = 0;
  let runStart = 0;
  let inSpace = false;
  for (let i = 0; i < value.length; i++) {
    if (isWhitespaceCode(value.charCodeAt(i))) {
      if (inSpace) continue;
      // The plain run before it as is, then one space for the whole whitespace run.
      if (i > runStart) parts.push(value.slice(runStart, i));
      parts.push(" ");
      inSpace = true;
      origin[kept++] = i;
    } else {
      if (inSpace) {
        inSpace = false;
        runStart = i;
      }
      origin[kept++] = i;
    }
  }
  if (!inSpace && value.length > runStart) parts.push(value.slice(runStart));
  const collapsed: CollapsedText = { text: parts.join(""), origin: origin.subarray(0, kept) };
  lastCollapsedSource = value;
  lastCollapsed = collapsed;
  return collapsed;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ");
}

/**
 * Where `quote` sits in `full` now (see the file comment for the order of
 * attempts), or null when its text is no longer there.
 */
export function locateQuote(full: string, quote: Pick<TextQuote, "text" | "start" | "prefix" | "suffix">): TextSpan | null {
  const { text } = quote;
  if (!text || !full) return null;

  if (quote.start >= 0 && full.slice(quote.start, quote.start + text.length) === text) {
    return { start: quote.start, end: quote.start + text.length };
  }

  const exact = bestOccurrence(full, quote);
  if (exact) return exact;

  // Whitespace-insensitive: the same words laid out with different spacing.
  const collapsedQuote = collapse(text);
  if (!collapsedQuote.trim()) return null;
  const haystack = collapseWhitespace(full);
  const hit = bestOccurrence(haystack.text, {
    text: collapsedQuote,
    // The saved offset is in the uncollapsed text: approximate it by its share of the text.
    start: full.length > 0 ? Math.round((quote.start / full.length) * haystack.text.length) : 0,
    prefix: collapse(quote.prefix),
    suffix: collapse(quote.suffix),
  });
  if (!hit) return null;
  const start = haystack.origin[hit.start];
  const lastKept = haystack.origin[hit.end - 1];
  if (start === undefined || lastKept === undefined) return null;
  return { start, end: lastKept + 1 };
}

/** Whether `[a.start, a.end)` and `[b.start, b.end)` share at least one character. */
export function spansOverlap(a: TextSpan, b: TextSpan): boolean {
  return a.start < b.end && b.start < a.end;
}
