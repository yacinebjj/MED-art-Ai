"use client";

/**
 * The flattened text of a reading surface and the DOM text nodes it comes
 * from — the coordinate system highlights are saved in (lib/reading/anchor-match.ts).
 *
 * Only the reading content counts: <script>/<style>/<template> and anything
 * marked `data-reading-skip` (a reader's own toolbar, whose "16px" or "42 %"
 * labels change while the student reads) are left out, so the offsets of the
 * lesson itself never move because of chrome rendered next to it.
 */

export const READING_SKIP_ATTRIBUTE = "data-reading-skip";
const SKIP_SELECTOR = `script,style,noscript,template,[${READING_SKIP_ATTRIBUTE}]`;

export interface TextIndex {
  root: Element;
  nodes: Text[];
  /** Offset of each node's first character in `text`. */
  starts: number[];
  text: string;
}

export function buildTextIndex(root: Element): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // REJECT skips the element's whole subtree; SKIP only hides the element itself.
        return (node as Element).matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = (node as Text).data;
    if (!value) continue;
    nodes.push(node as Text);
    starts.push(text.length);
    text += value;
  }
  return { root, nodes, starts, text };
}

/**
 * The text offset of a DOM boundary point (a Range's start or end), or null
 * when it lies outside the indexed text. A point inside an indexed text node
 * maps directly; any other point (an element boundary, a skipped node) maps to
 * the first indexed character at or after it.
 */
export function offsetOfPoint(index: TextIndex, container: Node, offset: number): number | null {
  if (!index.root.contains(container)) return null;
  if (container.nodeType === Node.TEXT_NODE) {
    const position = index.nodes.indexOf(container as Text);
    if (position >= 0) return index.starts[position] + Math.min(offset, (container as Text).data.length);
  }
  const point = document.createRange();
  try {
    point.setStart(container, offset);
  } catch {
    return null;
  }
  point.collapse(true);
  // First indexed node that starts at or after the point (nodes are in document order).
  let lo = 0;
  let hi = index.nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let after = false;
    try {
      after = point.comparePoint(index.nodes[mid], 0) >= 0;
    } catch {
      after = false;
    }
    if (after) hi = mid;
    else lo = mid + 1;
  }
  return lo < index.nodes.length ? index.starts[lo] : index.text.length;
}

/** `[start, end)` of a live Range in the surface's text, or null when it is not inside the surface. */
export function spanOfRange(index: TextIndex, range: Range): { start: number; end: number } | null {
  const start = offsetOfPoint(index, range.startContainer, range.startOffset);
  const end = offsetOfPoint(index, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/** Index of the node holding the character at `offset` (the last node starting at or before it). */
function nodeAt(index: TextIndex, offset: number): number {
  let lo = 0;
  let hi = index.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (index.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** A Range over `[start, end)` of the surface's text, or null when the span no longer fits it. */
export function rangeOfSpan(index: TextIndex, start: number, end: number): Range | null {
  if (index.nodes.length === 0 || start < 0 || end <= start || end > index.text.length) return null;
  const startNode = nodeAt(index, start);
  // The end belongs to the node holding its LAST character (end - 1), so a span never ends at offset 0 of the next node.
  const endNode = nodeAt(index, end - 1);
  const range = document.createRange();
  try {
    range.setStart(index.nodes[startNode], start - index.starts[startNode]);
    range.setEnd(index.nodes[endNode], end - index.starts[endNode]);
  } catch {
    return null;
  }
  return range;
}
