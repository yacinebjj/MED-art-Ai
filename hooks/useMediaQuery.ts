"use client";

import { useCallback, useSyncExternalStore } from "react";

// One MediaQueryList per query string: getSnapshot runs on every render.
const mediaQueryLists = new Map<string, MediaQueryList>();

function getMediaQueryList(query: string): MediaQueryList {
  let mediaQueryList = mediaQueryLists.get(query);
  if (!mediaQueryList) {
    mediaQueryList = window.matchMedia(query);
    mediaQueryLists.set(query, mediaQueryList);
  }
  return mediaQueryList;
}

/**
 * Picks between two structurally different layouts (e.g. a desktop 3-column
 * workspace vs. a mobile tabbed one) based on actual viewport width, so only
 * ONE of them ever mounts — unlike pure-CSS `hidden md:flex` toggling, which
 * would mount both and just hide one, doubling the cost of any heavy
 * component (chat history, markdown rendering, text-selection listeners)
 * placed inside either branch.
 *
 * `false` on the server and while hydrating (no `window` there), corrected
 * as soon as the page hydrates. Anything mounted later — a page reached by
 * client navigation, a dialog opened on a phone — reads the real answer on
 * its very first render: the old `useState(false)` + effect version rendered
 * every such mount once with the wrong layout first (phone sheets started
 * their opening animation as a centered dialog, then snapped).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mediaQueryList = getMediaQueryList(query);
      mediaQueryList.addEventListener("change", onChange);
      return () => mediaQueryList.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => getMediaQueryList(query).matches,
    () => false
  );
}
