"use client";

import { useRouteIntent } from "@/lib/motion";

/**
 * A thin light sweeping along the top edge while a navigation is loading —
 * the same cyan → violet bar as the launch loader (components/layout/
 * SplashScreen.tsx). It waits 220ms before showing (.route-progress,
 * app/globals.css), so a page that lands quickly never flashes it.
 */
export function RouteProgress() {
  const intent = useRouteIntent();
  return (
    <div aria-hidden className="route-progress" data-active={intent ? "true" : "false"}>
      <div className="route-progress-bar" />
    </div>
  );
}
