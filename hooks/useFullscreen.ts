"use client";

import { useState } from "react";

/** Pure CSS/layout fullscreen toggle (not the browser Fullscreen API) — used by reader panels to expand over the whole viewport, Notion-style. */
export function useFullscreen(initial = false) {
  const [isFullscreen, setIsFullscreen] = useState(initial);

  return {
    isFullscreen,
    enter: () => setIsFullscreen(true),
    exit: () => setIsFullscreen(false),
    toggle: () => setIsFullscreen((prev) => !prev),
  };
}
