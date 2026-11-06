"use client";

import { READING_SKIP_ATTRIBUTE } from "@/lib/reading/text-index";

/**
 * Reading positions: where a student was in a piece of content, saved as the
 * paragraph at the top of their screen (and how far into it), so it can be
 * restored on a different screen size or device — plus the raw pixel offset,
 * used as is when the layout is the same (same device, same width).
 *
 * Stored per account in this browser (instant) and in the sync store
 * (namespace "reading-pos", one document per surface) so the place follows
 * the student to another device.
 */

export const READING_POSITION_NS = "reading-pos";

export interface ReadingPosition {
  v: 1;
  /** Index of the anchor paragraph among the surface's blocks (-1: none). */
  block: number;
  /** Start of that paragraph's text, to find it again if blocks moved. */
  head: string;
  /** Share of that paragraph already scrolled past the top (0-1). */
  within: number;
  scrollTop: number;
  scrollHeight: number;
  width: number;
  /** Fallback: how far down the scrollable height (0-1). */
  ratio: number;
  savedAt: number;
}

const BLOCK_SELECTOR = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,tr,dt,dd,figure,img,hr,[data-reading-block]";
const HEAD_CHARS = 48;
/** Fewer blocks than this is a loader or a placeholder, not something being read: never recorded. */
const MIN_BLOCKS_TO_RECORD = 3;
/** Pixel offsets are trusted as is only when the layout differs by no more than this. */
const SAME_LAYOUT_TOLERANCE_PX = 2;

export function isReadingPosition(value: unknown): value is ReadingPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.block === "number" &&
    Number.isInteger(p.block) &&
    typeof p.head === "string" &&
    typeof p.within === "number" &&
    Number.isFinite(p.within) &&
    typeof p.scrollTop === "number" &&
    Number.isFinite(p.scrollTop) &&
    typeof p.scrollHeight === "number" &&
    typeof p.width === "number" &&
    typeof p.ratio === "number" &&
    Number.isFinite(p.ratio) &&
    typeof p.savedAt === "number"
  );
}

function isDocumentScroller(scroller: HTMLElement): boolean {
  return scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
}

/**
 * The element that scrolls `surface`: the surface itself or its nearest
 * ancestor whose overflow-y lets it scroll (whether or not it overflows yet —
 * the content may still be loading), else the page.
 */
export function findScrollContainer(surface: HTMLElement): HTMLElement {
  let node: HTMLElement | null = surface;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function scrollMetrics(scroller: HTMLElement): { top: number; height: number; client: number; width: number; viewportTop: number } {
  if (isDocumentScroller(scroller)) {
    const root = document.documentElement;
    return { top: window.scrollY, height: root.scrollHeight, client: window.innerHeight, width: root.clientWidth, viewportTop: 0 };
  }
  return { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, width: scroller.clientWidth, viewportTop: scroller.getBoundingClientRect().top };
}

export function setScrollTop(scroller: HTMLElement, top: number): void {
  const value = Math.max(0, Math.round(top));
  // "instant": never animated, even under a CSS `scroll-behavior: smooth`.
  if (isDocumentScroller(scroller)) window.scrollTo({ top: value, behavior: "instant" as ScrollBehavior });
  else scroller.scrollTo({ top: value, behavior: "instant" as ScrollBehavior });
}

function headOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, HEAD_CHARS);
}

function anchorBlocks(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter((el) => !el.closest(`[${READING_SKIP_ATTRIBUTE}]`));
}

/** Where the student is now in `surface`, or null when it cannot be measured (detached, not laid out). */
export function capturePosition(surface: HTMLElement, scroller: HTMLElement): ReadingPosition | null {
  if (!surface.isConnected) return null;
  const metrics = scrollMetrics(scroller);
  if (metrics.client <= 0) return null;
  const topLine = metrics.viewportTop + 1;
  let block = -1;
  let head = "";
  let within = 0;
  const blocks = anchorBlocks(surface);
  if (blocks.length < MIN_BLOCKS_TO_RECORD) return null;
  for (let i = 0; i < blocks.length; i++) {
    const rect = blocks[i].getBoundingClientRect();
    if (rect.height <= 0) continue;
    if (rect.bottom > topLine) {
      block = i;
      head = headOf(blocks[i]);
      within = Math.min(1, Math.max(0, (topLine - rect.top) / rect.height));
      break;
    }
  }
  const maxScroll = Math.max(0, metrics.height - metrics.client);
  return {
    v: 1,
    block,
    head,
    within,
    scrollTop: metrics.top,
    scrollHeight: metrics.height,
    width: metrics.width,
    ratio: maxScroll > 0 ? Math.min(1, metrics.top / maxScroll) : 0,
    savedAt: Date.now(),
  };
}

/**
 * Scrolls back to `position`. Returns false when the content is not there yet
 * (nothing to anchor on, nothing to scroll) — the caller retries as it loads.
 */
export function restorePosition(surface: HTMLElement, scroller: HTMLElement, position: ReadingPosition): boolean {
  if (!surface.isConnected) return false;
  const metrics = scrollMetrics(scroller);
  const maxScroll = Math.max(0, metrics.height - metrics.client);
  if (position.scrollTop <= 1) {
    // Saved at the very top: the top it is (a pane shared with another view may still hold that view's offset).
    if (metrics.top > 1) setScrollTop(scroller, 0);
    return true;
  }
  if (Math.abs(metrics.height - position.scrollHeight) <= SAME_LAYOUT_TOLERANCE_PX && Math.abs(metrics.width - position.width) <= SAME_LAYOUT_TOLERANCE_PX) {
    if (maxScroll + 1 < position.scrollTop) return false;
    setScrollTop(scroller, position.scrollTop);
    return true;
  }
  if (position.block >= 0) {
    const blocks = anchorBlocks(surface);
    let target: HTMLElement | null = null;
    const direct = blocks[position.block];
    if (direct && headOf(direct) === position.head) {
      target = direct;
    } else if (position.head) {
      // The paragraph moved (content edited above it): the same text nearest its old place.
      let bestDistance = Infinity;
      for (let i = 0; i < blocks.length; i++) {
        if (headOf(blocks[i]) !== position.head) continue;
        const distance = Math.abs(i - position.block);
        if (distance < bestDistance) {
          bestDistance = distance;
          target = blocks[i];
        }
      }
    }
    if (target) {
      const rect = target.getBoundingClientRect();
      if (rect.height > 0) {
        setScrollTop(scroller, metrics.top + (rect.top - metrics.viewportTop) + position.within * rect.height);
        return true;
      }
    }
    // The paragraph is not rendered yet (still loading) — try again later.
    if (blocks.length <= position.block) return false;
  }
  if (maxScroll <= 0) return false;
  setScrollTop(scroller, position.ratio * maxScroll);
  return true;
}

// ─── storage (this browser) ──────────────────────────────────────────────

function storageKey(userId: string, surfaceKey: string): string {
  return `medart:rp:${userId}:${surfaceKey}`;
}

export function readLocalPosition(userId: string, surfaceKey: string): ReadingPosition | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId, surfaceKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isReadingPosition(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLocalPosition(userId: string, surfaceKey: string, position: ReadingPosition): void {
  try {
    window.localStorage.setItem(storageKey(userId, surfaceKey), JSON.stringify(position));
  } catch {
    // Storage full or blocked: the server copy still has it.
  }
}
