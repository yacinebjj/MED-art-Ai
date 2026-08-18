"use client";

import { useEffect, useState } from "react";

/**
 * Picks between two structurally different layouts (e.g. a desktop 3-column
 * workspace vs. a mobile tabbed one) based on actual viewport width, so only
 * ONE of them ever mounts — unlike pure-CSS `hidden md:flex` toggling, which
 * would mount both and just hide one, doubling the cost of any heavy
 * component (chat history, markdown rendering, text-selection listeners)
 * placed inside either branch.
 *
 * Defaults to `false` before the first client effect runs (SSR/first paint
 * has no `window`), which means a fresh desktop load briefly evaluates as
 * "not matching" until this effect settles — an accepted, self-correcting
 * one-paint flash, the standard tradeoff for a `matchMedia`-based check with
 * no SSR-side viewport information.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    setMatches(mediaQueryList.matches);

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }

    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
