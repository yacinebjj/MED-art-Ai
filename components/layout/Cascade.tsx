"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE CASCADE — a page's blocks rising in one after another, top to bottom,
 * the way the eye reads it (`.animate-cascade`, app/globals.css): each one
 * fades in and rises on the soft spring on its own beat, `at` ms after the
 * page appeared, plus `index` × `step` ms after its first sibling. All of it
 * runs on the compositor (CSS: opacity, translate, scale), so the beats hold
 * while React is still busy mounting the page. framer-motion entrances run
 * on the main thread: during a mount they lost their frames and landed
 * already finished — the blocks popped in.
 *
 * A block that arrives late (its data was loading; a skeleton held its
 * place) rises at once: the part of its beat already gone is skipped, so no
 * pause ever follows a skeleton — siblings still come one after another.
 * Beats count from the page's first commit and are fixed when a block mounts,
 * so the server's HTML and the hydrating client agree on every delay.
 *
 * A cascade's elements escape the page-wide entrances (`.page-reveal`
 * sections, `.glass-card` surfaces) through their `animate-` class, and the
 * glass surfaces inside them arrive with them. Their children inherit
 * `--cascade-delay`: a bar fills (`.bar-grow`) as its card arrives.
 */

interface CascadeClock {
  startedAt: number;
  committed: { current: boolean };
}

const ClockContext = createContext<CascadeClock | null>(null);
const ItemDelayContext = createContext(0);

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

/** Siblings staggered at most; any further ones arrive with the last of these. */
const MAX_STAGGER = 9;

/** A page whose blocks cascade in: their beats count from its first commit. */
export function CascadeRoot({ children }: { children: ReactNode }) {
  const committed = useRef(false);
  const [clock] = useState<CascadeClock>(() => ({ startedAt: now(), committed }));
  useEffect(() => {
    committed.current = true;
  }, []);
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

/**
 * The delay of a block planned `at` ms into the cascade, `index` × `step` ms
 * after its first sibling — shortened by however late it mounts. Fixed at
 * mount: a later re-render (a filter moving a card) never re-times it.
 */
export function useCascadeDelay(at: number, index = 0, step = 0): number {
  const clock = useContext(ClockContext);
  const [delay] = useState(() => {
    const elapsed = clock?.committed.current ? now() - clock.startedAt : 0;
    return Math.round(Math.max(0, at - elapsed) + Math.min(Math.max(index, 0), MAX_STAGGER) * step);
  });
  return delay;
}

/** What an element of the cascade carries: its class, its delay (as `--cascade-delay`), and the delay itself. */
export function useCascade(at: number, index = 0, step = 0): { className: string; style: CSSProperties; delay: number } {
  const delay = useCascadeDelay(at, index, step);
  return { className: "animate-cascade", style: { "--cascade-delay": `${delay}ms` } as CSSProperties, delay };
}

/** A `div` of the cascade. */
export function Cascade({ at, index, step, className, style, ...props }: HTMLAttributes<HTMLDivElement> & { at: number; index?: number; step?: number }) {
  const cascade = useCascade(at, index, step);
  return <div {...props} className={cn(cascade.className, className)} style={{ ...style, ...cascade.style }} />;
}

/** Hands an element's cascade delay to what animates in JavaScript inside it (a gauge's arc), so it starts as the element arrives. */
export const CascadeDelayProvider = ItemDelayContext.Provider;

/** The cascade delay of the element around, in ms (0 outside one). */
export function useEnclosingCascadeDelay(): number {
  return useContext(ItemDelayContext);
}
