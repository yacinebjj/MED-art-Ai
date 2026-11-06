"use client";

/**
 * Paints saved highlights WITHOUT touching the page's DOM, through the CSS
 * Custom Highlight API (Chrome/Edge 105+, Safari 17.2+, Firefox 140+): each
 * colour is one named Highlight in `CSS.highlights`, styled by a
 * `::highlight(...)` rule. React keeps full ownership of the reading content:
 * no <mark> is wrapped around text it rendered, so a re-render can never trip
 * over a node that was moved (the classic "removeChild: not a child" crash).
 *
 * Several surfaces can be on screen at once (the Co-pilot and the Studio side
 * by side): each surface sets its own layer of ranges, and every colour's
 * Highlight is rebuilt from all layers.
 *
 * Browsers without the API (older iPhones on iOS ≤ 17.1) get the previous
 * behaviour instead: each text segment of a highlight is wrapped in its own
 * <mark> (never one <mark> spanning several paragraphs), tagged
 * `data-reading-hl` so it can be found and removed again.
 */

export const HIGHLIGHT_COLOR_IDS = ["yellow", "green", "red", "blue"] as const;
export type HighlightColorId = (typeof HIGHLIGHT_COLOR_IDS)[number];

export function isHighlightColorId(value: unknown): value is HighlightColorId {
  return typeof value === "string" && (HIGHLIGHT_COLOR_IDS as readonly string[]).includes(value);
}

/** Same tints as lib/highlight.ts's HIGHLIGHT_COLORS (Tailwind *-200 behind gray-900 text), in light and dark mode alike. */
const BACKGROUNDS: Record<HighlightColorId, string> = {
  yellow: "#fef08a",
  green: "#bbf7d0",
  red: "#fecaca",
  blue: "#bfdbfe",
};

/** Same classes as lib/highlight.ts's HIGHLIGHT_COLORS markClass, for the <mark> fallback. */
export const FALLBACK_MARK_CLASSES: Record<HighlightColorId, string> = {
  yellow: "rounded px-0.5 bg-yellow-200 dark:bg-yellow-200 text-gray-900",
  green: "rounded px-0.5 bg-green-200 dark:bg-green-200 text-gray-900",
  red: "rounded px-0.5 bg-red-200 dark:bg-red-200 text-gray-900",
  blue: "rounded px-0.5 bg-blue-200 dark:bg-blue-200 text-gray-900",
};

export const FALLBACK_MARK_ATTRIBUTE = "data-reading-hl";

const NAME_PREFIX = "medart-hl-";

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): unknown;
  delete(name: string): boolean;
}

function registry(): HighlightRegistryLike | null {
  if (typeof window === "undefined" || typeof CSS === "undefined") return null;
  const highlights = (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: unknown }).Highlight;
  return highlights && typeof HighlightCtor === "function" ? highlights : null;
}

export function supportsCustomHighlights(): boolean {
  return registry() !== null;
}

let stylesInjected = false;
function ensureStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.setAttribute("data-medart-highlights", "");
  style.textContent = HIGHLIGHT_COLOR_IDS.map((color) => `::highlight(${NAME_PREFIX}${color}){background-color:${BACKGROUNDS[color]};color:#111827;}`).join("\n");
  document.head.appendChild(style);
}

const layers = new Map<string, Map<HighlightColorId, Range[]>>();

function flush(): void {
  const reg = registry();
  if (!reg) return;
  const HighlightCtor = (window as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
  for (const color of HIGHLIGHT_COLOR_IDS) {
    const ranges: Range[] = [];
    for (const layer of Array.from(layers.values())) {
      const own = layer.get(color);
      if (own) ranges.push(...own);
    }
    const name = NAME_PREFIX + color;
    if (ranges.length === 0) reg.delete(name);
    else reg.set(name, new HighlightCtor(...ranges));
  }
}

/** Replaces one surface's painted ranges (Custom Highlight API only). */
export function paintLayer(surfaceId: string, rangesByColor: Map<HighlightColorId, Range[]>): void {
  if (!registry()) return;
  ensureStyles();
  if (rangesByColor.size === 0) {
    if (!layers.delete(surfaceId)) return;
  } else {
    layers.set(surfaceId, rangesByColor);
  }
  flush();
}

/** Removes one surface's painted ranges. */
export function clearLayer(surfaceId: string): void {
  if (layers.delete(surfaceId)) flush();
}

// ─── <mark> fallback ─────────────────────────────────────────────────────

/**
 * Wraps every text segment of `range` in its own <mark> (so a highlight
 * spanning two paragraphs never pulls one paragraph's text into the other).
 * Returns the number of marks created.
 */
export function wrapRangeInMarks(range: Range, color: HighlightColorId, highlightId: string): number {
  const root = range.commonAncestorContainer;
  const segments: { node: Text; start: number; end: number }[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    segments.push({ node: root as Text, start: range.startOffset, end: range.endOffset });
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) continue;
      const text = node as Text;
      const start = text === range.startContainer ? range.startOffset : 0;
      const end = text === range.endContainer ? range.endOffset : text.data.length;
      if (end > start) segments.push({ node: text, start, end });
    }
  }
  let created = 0;
  for (const segment of segments) {
    if (segment.node.parentElement?.closest(`mark[${FALLBACK_MARK_ATTRIBUTE}]`)) continue;
    let target = segment.node;
    if (segment.start > 0) target = target.splitText(segment.start);
    if (segment.end - segment.start < target.data.length) target.splitText(segment.end - segment.start);
    const mark = document.createElement("mark");
    mark.className = FALLBACK_MARK_CLASSES[color];
    mark.setAttribute(FALLBACK_MARK_ATTRIBUTE, highlightId);
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
    created++;
  }
  return created;
}

/**
 * Unwraps every fallback <mark> of one highlight inside `root`. The text
 * nodes are put back as they are, never merged (`normalize()` would delete
 * nodes React still holds references to).
 */
export function unwrapMarks(root: Element, highlightId: string): void {
  const marks = Array.from(root.querySelectorAll(`mark[${FALLBACK_MARK_ATTRIBUTE}]`)).filter((mark) => mark.getAttribute(FALLBACK_MARK_ATTRIBUTE) === highlightId);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
}

/** Ids of the fallback marks currently in `root`. */
export function markedHighlightIds(root: Element): Set<string> {
  const ids = new Set<string>();
  root.querySelectorAll(`mark[${FALLBACK_MARK_ATTRIBUTE}]`).forEach((mark) => {
    const id = mark.getAttribute(FALLBACK_MARK_ATTRIBUTE);
    if (id) ids.add(id);
  });
  return ids;
}
