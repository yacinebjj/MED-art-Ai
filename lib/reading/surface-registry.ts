"use client";

import type { HighlightColorId } from "@/lib/reading/highlight-paint";

/**
 * The reading surfaces mounted on the page right now (hooks/useReadingSurface.ts),
 * found from any node inside them — how the selection card
 * (TextSelectionToolbar) saves a highlight into whichever surface the
 * selection belongs to, without being told about it.
 */

export type HighlightAddOutcome = "added" | "too-long" | "outside";

export interface ReadingSurfaceController {
  key: string;
  element: HTMLElement;
  /** Saves `range` as a highlight of `color` (merging any it overlaps). */
  addHighlight(range: Range, color: HighlightColorId): HighlightAddOutcome;
  /** Ids of the saved highlights `range` touches. */
  highlightsIn(range: Range): string[];
  removeHighlights(ids: string[]): void;
}

const surfaces = new Map<HTMLElement, ReadingSurfaceController>();

export function registerReadingSurface(controller: ReadingSurfaceController): () => void {
  surfaces.set(controller.element, controller);
  return () => {
    if (surfaces.get(controller.element) === controller) surfaces.delete(controller.element);
  };
}

/** The innermost reading surface containing `node`, if any. */
export function readingSurfaceFor(node: Node | null | undefined): ReadingSurfaceController | null {
  let el: Element | null = node ? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement) : null;
  while (el) {
    const controller = surfaces.get(el as HTMLElement);
    if (controller) return controller;
    el = el.parentElement;
  }
  return null;
}
