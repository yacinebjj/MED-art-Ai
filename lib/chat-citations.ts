/**
 * Verifiable citations for the module workspace chat. The model is asked
 * (WORKSPACE_STRUCTURED_FORMAT_INSTRUCTION, lib/chat-system-prompt.ts) to
 * back course-derived claims with `[[source: <course title> | "<verbatim
 * fragment>"]]`. This file turns those markers into numbered chips and —
 * the part that actually matters — checks each quoted fragment against the
 * student's REAL course text on the client, so a chip either opens the exact
 * passage it came from or says plainly that the quote could not be found.
 * A citation is never shown as "verified" on the model's word alone.
 */

export interface ChatCitation {
  /** 1-based, in order of first appearance; identical title+quote pairs share one index. */
  index: number;
  sourceTitle: string;
  quote: string;
}

export interface CitationSourceText {
  id: number;
  title: string;
  /** The extracted course text the student uploaded. */
  rawText?: string | null;
  /** The generated Explication — quotes the model takes from an "Explication déjà validée" slot live here, not in rawText. */
  explication?: string | null;
}

export interface CitationLocation {
  sourceId: number;
  sourceTitle: string;
  origin: "source" | "explication";
  before: string;
  match: string;
  after: string;
  /** True when only part of the quote (its first or last words) matched — shown as "correspondance partielle". */
  partial: boolean;
}

const CITATION_PATTERN = /\[\[\s*(?:source|cite)\s*:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]\]/gi;
// Built from an escaped string (not a regex literal) so the combining-mark
// range stays readable ASCII in source — same idiom as
// lib/course-generation-shared.ts's slugify.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
const QUOTE_EDGE_CHARS =/^[\s"'«»“”‘’`]+|[\s"'«»“”‘’`]+$/g;

/**
 * Replaces every complete citation marker with a `[n](#cite-n)` link (the
 * chat's markdown `a` renderer turns those into chips) and strips a marker
 * still being streamed at the very end of the text, so a half-written
 * `[[source: …` never flashes on screen mid-stream.
 */
export function extractCitations(markdown: string): { markdown: string; citations: ChatCitation[] } {
  const citations: ChatCitation[] = [];
  const indexByKey = new Map<string, number>();

  // Leading whitespace is swallowed so "claim [[source: …]]" doesn't render
  // as "claim  [1]" (the chip brings its own single space).
  const replaced = markdown.replace(new RegExp(`\\s*${CITATION_PATTERN.source}`, "gi"), (_full, rawTitle: string, rawQuote: string) => {
    const sourceTitle = rawTitle.replace(QUOTE_EDGE_CHARS, "").trim();
    const quote = rawQuote.replace(QUOTE_EDGE_CHARS, "").trim();
    if (!sourceTitle || !quote) return "";
    const key = `${normalizeForMatch(sourceTitle).text}|${normalizeForMatch(quote).text}`;
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = citations.length + 1;
      indexByKey.set(key, index);
      citations.push({ index, sourceTitle, quote });
    }
    return ` [${index}](#cite-${index})`;
  });

  return { markdown: replaced.replace(/\[\[[^\]]*\]?$/, ""), citations };
}

/** Plain-text version of a reply for copy / notes / read-aloud — markers become «quote» inline. */
export function stripCitationMarkers(markdown: string): string {
  return markdown.replace(CITATION_PATTERN, (_full, _title: string, rawQuote: string) => {
    const quote = rawQuote.replace(QUOTE_EDGE_CHARS, "").trim();
    return quote ? ` (« ${quote} »)` : "";
  });
}

export function citationIndexFromHref(href: string | undefined): number | null {
  const match = href?.match(/^#cite-(\d+)$/);
  return match ? Number(match[1]) : null;
}

interface NormalizedText {
  text: string;
  /** map[i] = index in the ORIGINAL string of normalized character i. */
  map: number[];
}

/**
 * Lowercase, accents stripped, every run of non-alphanumeric characters
 * collapsed to one space — so a quote still matches across curly vs straight
 * apostrophes, a PDF's hard line breaks, or "é" vs "e". Keeps an index map
 * back to the original string, so the matched passage can be shown with its
 * real formatting.
 */
function normalizeForMatch(input: string): NormalizedText {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < input.length; i++) {
    const base = input[i].normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
    for (const ch of base) {
      if (/[\p{L}\p{N}]/u.test(ch)) {
        if (pendingSpace && text.length > 0) {
          text += " ";
          map.push(i);
        }
        pendingSpace = false;
        text += ch;
        map.push(i);
      } else {
        pendingSpace = true;
      }
    }
  }
  return { text, map };
}

function findNormalized(haystack: NormalizedText, needle: string): { start: number; end: number } | null {
  if (needle.length < 8) return null;
  const at = haystack.text.indexOf(needle);
  if (at === -1) return null;
  return { start: haystack.map[at], end: haystack.map[at + needle.length - 1] + 1 };
}

const CONTEXT_CHARS = 220;

function locateIn(text: string, quote: string): { start: number; end: number; partial: boolean } | null {
  const hay = normalizeForMatch(text);
  const needle = normalizeForMatch(quote).text;
  const exact = findNormalized(hay, needle);
  if (exact) return { ...exact, partial: false };

  // Models sometimes stitch two adjacent sentences or alter one word at the
  // end — fall back to the first, then the last, 6 words of the quote.
  const words = needle.split(" ");
  if (words.length < 8) return null;
  for (const fragment of [words.slice(0, 6).join(" "), words.slice(-6).join(" ")]) {
    const hit = findNormalized(hay, fragment);
    if (hit) return { ...hit, partial: true };
  }
  return null;
}

function titleScore(candidate: string, wanted: string): number {
  const a = normalizeForMatch(candidate).text;
  const b = normalizeForMatch(wanted).text;
  if (!a || !b) return 0;
  if (a === b) return 3;
  if (a.includes(b) || b.includes(a)) return 2;
  return 0;
}

/**
 * Finds the quoted passage in the cited course first (by title), then in
 * every other provided source — a model occasionally mislabels which of
 * several checked courses a fragment came from, and the passage is still
 * genuinely in the student's material. Returns null when it is nowhere.
 */
export function locateCitation(citation: ChatCitation, sources: CitationSourceText[]): CitationLocation | null {
  const ordered = [...sources].sort((x, y) => titleScore(y.title, citation.sourceTitle) - titleScore(x.title, citation.sourceTitle));

  for (const source of ordered) {
    const candidates: [CitationLocation["origin"], string | null | undefined][] = [
      ["source", source.rawText],
      ["explication", source.explication],
    ];
    for (const [origin, text] of candidates) {
      if (!text) continue;
      const hit = locateIn(text, citation.quote);
      if (!hit) continue;
      const beforeStart = Math.max(0, hit.start - CONTEXT_CHARS);
      const afterEnd = Math.min(text.length, hit.end + CONTEXT_CHARS);
      return {
        sourceId: source.id,
        sourceTitle: source.title,
        origin,
        before: `${beforeStart > 0 ? "…" : ""}${text.slice(beforeStart, hit.start)}`,
        match: text.slice(hit.start, hit.end),
        after: `${text.slice(hit.end, afterEnd)}${afterEnd < text.length ? "…" : ""}`,
        partial: hit.partial,
      };
    }
  }
  return null;
}
