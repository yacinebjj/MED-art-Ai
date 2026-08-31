"use client";

/**
 * Shared, DOM-based text-highlighting primitives — used by both
 * TextSelectionToolbar (ephemeral highlights over Chat/Studio/demo reading
 * views) and the "Mes notes" contentEditable editor (persisted highlights,
 * saved as part of the note's HTML content). Keeping the color palette and
 * the apply/remove/sanitize logic in one place means a highlight created in
 * one surface always looks and round-trips identically in the other.
 */

export interface HighlightColorOption {
  id: "yellow" | "green" | "red" | "blue";
  label: string;
  /** Tailwind class for the small color-dot button in the toolbar. */
  dotClass: string;
  /** Full class list applied to the generated `<mark>` element. */
  markClass: string;
}

export const HIGHLIGHT_COLORS: HighlightColorOption[] = [
  { id: "yellow", label: "Jaune", dotClass: "bg-yellow-200", markClass: "rounded px-0.5 bg-yellow-200 dark:bg-yellow-200 text-gray-900" },
  { id: "green", label: "Vert", dotClass: "bg-green-200", markClass: "rounded px-0.5 bg-green-200 dark:bg-green-200 text-gray-900" },
  { id: "red", label: "Rouge", dotClass: "bg-red-200", markClass: "rounded px-0.5 bg-red-200 dark:bg-red-200 text-gray-900" },
  { id: "blue", label: "Bleu", dotClass: "bg-blue-200", markClass: "rounded px-0.5 bg-blue-200 dark:bg-blue-200 text-gray-900" },
];

/** Every class string a `<mark>` this app ever generates can legitimately have — the sanitizer's allowlist (see sanitizeNoteHtml below) so a pasted/forged `class` attribute can't smuggle arbitrary utility classes in. */
const KNOWN_MARK_CLASSES = new Set(HIGHLIGHT_COLORS.map((c) => c.markClass));

/** `window.getSelection().anchorNode`'s nearest `<mark>` ancestor, if the current selection lives inside one — drives the toolbar's Highlight-vs-Unhighlight branch. */
export function getSelectionMarkAncestor(): HTMLElement | null {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return (el?.closest("mark") as HTMLElement | null) ?? null;
}

/**
 * Wraps the LIVE `window.getSelection()` Range in a `<mark>` of the given
 * color. `surroundContents` throws when the Range crosses element boundaries
 * (e.g. a selection spanning two `<p>`s) — extract+reinsert is the standard
 * fallback for that case.
 */
export function applyHighlight(color: HighlightColorOption): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

  const range = sel.getRangeAt(0);
  const mark = document.createElement("mark");
  mark.className = color.markClass;
  try {
    range.surroundContents(mark);
  } catch {
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
  sel.removeAllRanges();
}

/**
 * Character offsets of `range` relative to `container`'s own flattened text
 * content (every text node inside it, concatenated in document order).
 * Scoped to `container` (the reading pane), NOT `document.body` — anchoring
 * on the whole page was the actual bug in the old implementation: any
 * dynamic text rendered BEFORE the reading container in the DOM (the
 * Pomodoro widget's ticking clock, a trial-countdown badge, anything whose
 * rendered length can differ between page loads) would silently shift every
 * offset captured against `document.body`, corrupting rehydration for
 * reasons that have nothing to do with the highlighted content itself.
 */
export function computeOffsets(container: Node, range: Range): { startOffset: number; endOffset: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startOffset: number | null = null;
  let endOffset: number | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) startOffset = offset + range.startOffset;
    if (node === range.endContainer) {
      endOffset = offset + range.endOffset;
      break;
    }
    offset += node.nodeValue?.length ?? 0;
  }
  if (startOffset === null || endOffset === null) return null;
  return { startOffset, endOffset };
}

/** The inverse of computeOffsets — reconstructs a Range spanning `[startOffset, endOffset)` of `container`'s flattened text content, or null if the offsets no longer resolve (container has fewer characters than expected). */
export function rangeFromOffsets(container: Node, startOffset: number, endOffset: number): Range | null {
  if (startOffset < 0 || endOffset <= startOffset) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let startSet = false;
  let endSet = false;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const len = node.nodeValue?.length ?? 0;
    if (!startSet && offset + len >= startOffset) {
      range.setStart(node, startOffset - offset);
      startSet = true;
    }
    if (!endSet && offset + len >= endOffset) {
      range.setEnd(node, endOffset - offset);
      endSet = true;
      break;
    }
    offset += len;
  }

  return startSet && endSet ? range : null;
}

/** Wraps `range` in a `<mark>` of the given color, tagged with `data-highlight-id` when known (lets the toolbar find and delete/restyle the exact persisted row later, not just "a mark containing this text"). Same surroundContents-with-extract-fallback as applyHighlight below. */
export function wrapRangeInMark(range: Range, markClass: string, highlightId?: string | number): HTMLElement | null {
  const mark = document.createElement("mark");
  mark.className = markClass;
  if (highlightId !== undefined) mark.dataset.highlightId = String(highlightId);

  try {
    range.surroundContents(mark);
    return mark;
  } catch {
    try {
      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      return mark;
    } catch {
      return null; // range crosses a boundary surroundContents/extractContents can't handle — caller's fallback (substring search) takes over.
    }
  }
}

/**
 * Last-resort rehydration for highlight rows saved before start_offset/
 * end_offset existed (or whose offsets no longer resolve to the expected
 * text): finds the first occurrence of `text` inside `container` and wraps
 * it — the same whole-page substring search this app used everywhere
 * before, just scoped to `container` instead of `document.body` so it
 * can't match text belonging to some other part of the page.
 */
export function restoreHighlightBySubstring(container: Node, text: string, markClass: string, highlightId?: string | number): boolean {
  if (!text) return false;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.tagName === "MARK") continue;
    const pos = node.nodeValue?.indexOf(text) ?? -1;
    if (pos < 0) continue;

    const range = document.createRange();
    range.setStart(node, pos);
    range.setEnd(node, pos + text.length);
    return Boolean(wrapRangeInMark(range, markClass, highlightId));
  }
  return false;
}

/** Unwraps a `<mark>` — its children move up to take its place in the parent, so the text merges back in seamlessly with no background color left behind. */
export function removeHighlight(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize(); // merges the now-adjacent text nodes back into one
  window.getSelection()?.removeAllRanges();
}

/** HTML-escapes plain text before it's stored in a field that gets rendered back via `dangerouslySetInnerHTML` — without this, a selection containing e.g. "pO2 < 60mmHg" would corrupt the note's HTML structure on render. */
export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** Plain-text preview of an HTML note body (e.g. the notes list's truncated snippet) — strips tags rather than showing raw markup. */
export function stripHtmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

const ALLOWED_TAGS = new Set(["MARK", "B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN"]);

/**
 * Client-side allowlist sanitizer for note content before it's saved (and,
 * defensively, again right before it's rendered) — the notes editor is a
 * `contentEditable` div, which can receive arbitrary pasted HTML (rich
 * clipboard content can carry script/style/event-handler attributes). Walks
 * bottom-up (a disallowed element's children are cleaned BEFORE it gets
 * unwrapped) so relocating already-sanitized children into the parent is
 * always safe. `<mark>`'s `class` attribute is kept only if it EXACTLY
 * matches one of this app's own known highlight classes — every other
 * attribute, on every tag, is stripped outright (no `href`/`src`/`on*`
 * survives, so no `javascript:` URI or inline handler can persist).
 *
 * This is a real security boundary for a `contentEditable` surface, not
 * decorative — see app/api/notes/route.ts's `stripDangerousHtml` for the
 * server-side backstop (this function requires DOM APIs, so it can't run
 * there).
 */
export function sanitizeNoteHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  sanitizeNode(template.content);
  return template.innerHTML;
}

function sanitizeNode(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) {
      node.removeChild(child); // comments, processing instructions, etc.
      continue;
    }

    const el = child as HTMLElement;
    sanitizeNode(el); // clean children FIRST — if `el` gets unwrapped below, its children are already safe to relocate

    if (!ALLOWED_TAGS.has(el.tagName)) {
      while (el.firstChild) node.insertBefore(el.firstChild, el);
      node.removeChild(el);
      continue;
    }

    // Captured before stripping: the only attribute ever allowed to survive
    // is <mark>'s class, and only when it's byte-for-byte one of this app's
    // own known highlight classes (never an arbitrary/forged value).
    const originalMarkClass = el.tagName === "MARK" ? el.getAttribute("class") : null;
    for (const attr of Array.from(el.attributes)) {
      el.removeAttribute(attr.name);
    }
    if (originalMarkClass && KNOWN_MARK_CLASSES.has(originalMarkClass)) {
      el.setAttribute("class", originalMarkClass);
    }
  }
}
