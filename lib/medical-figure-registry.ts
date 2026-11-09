import { createContext } from "react";

/**
 * One reply's pictures, kept distinct (product order 2026-11-09: several
 * images for a broad question, never the same one twice). Each figure of the
 * reply registers its place in the reply and its candidates (the verified
 * picture, then its alternatives — lib/medical-images.ts); in reply order,
 * each figure gets its first candidate no earlier figure has taken. A figure
 * whose candidates are all taken shows nothing. The answer depends only on
 * the places and the candidates, never on which check came back first.
 */
export interface FigureRegistry {
  register(id: string, order: number, candidates: readonly string[]): void;
  unregister(id: string): void;
  /** The picture (its src) this figure shows; null when every candidate is taken; undefined while it isn't registered. */
  chosen(id: string): string | null | undefined;
  subscribe(listener: () => void): () => void;
}

export function createFigureRegistry(): FigureRegistry {
  const entries = new Map<string, { order: number; candidates: readonly string[] }>();
  const listeners = new Set<() => void>();
  let assignment = new Map<string, string | null>();

  function assign() {
    const next = new Map<string, string | null>();
    const taken = new Set<string>();
    const ordered = Array.from(entries.entries()).sort(([idA, a], [idB, b]) => a.order - b.order || (idA < idB ? -1 : idA > idB ? 1 : 0));
    for (const [id, entry] of ordered) {
      const pick = entry.candidates.find((src) => !taken.has(src)) ?? null;
      if (pick) taken.add(pick);
      next.set(id, pick);
    }
    assignment = next;
    listeners.forEach((listener) => listener());
  }

  return {
    register(id, order, candidates) {
      const current = entries.get(id);
      if (current && current.order === order && current.candidates.join("\n") === candidates.join("\n")) return;
      entries.set(id, { order, candidates });
      assign();
    },
    unregister(id) {
      if (entries.delete(id)) assign();
    },
    chosen(id) {
      return assignment.has(id) ? (assignment.get(id) ?? null) : undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The reply's registry (components/assistant/StreamedMarkdown.tsx gives one to each reply). */
export const FigureRegistryContext = createContext<FigureRegistry | null>(null);

/** Which top-level block of the reply a figure sits in: with its offset in the block, its place in the reply. */
export const FigureBlockContext = createContext(0);
