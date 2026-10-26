"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { classifyRoute, getRouteIntent, playRouteEnter, subscribeRouteIntent } from "@/lib/motion";
import { cn } from "@/lib/utils";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The shell's route stage: every page change inside the dashboard shell
 * plays here, on the compositor.
 *
 * - Exit, on the tap itself: as soon as the router is asked to navigate
 *   (lib/motion.ts route intent), the current page steps back — it fades,
 *   and slides or shrinks a touch depending on the direction — while the
 *   next one loads. CSS transitions on [data-route-leave] (app/globals.css).
 * - Entrance, before the new page's first paint: a quick fade plus a spring
 *   (Web Animations API) — sideways for a push or a back, a soft rise for a
 *   move between two top-level destinations, where the page's own sections
 *   then rise in one after another (`page-reveal`).
 *
 * The router is never held back. This used to be `<AnimatePresence
 * mode="wait">`, which kept the new segment waiting for the old page's exit
 * to report completion — and an exit can stall (frames are throttled while
 * an installed PWA isn't in the foreground): the "click → nothing happens
 * until F5" freeze. Here the old page's DOM is never kept for its exit; if
 * the new page lands mid-exit, its entrance simply starts from there.
 */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  const stageRef = useRef<HTMLDivElement>(null);
  const shownPathnameRef = useRef(pathname);

  useEffect(() => {
    return subscribeRouteIntent(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const intent = getRouteIntent();
      if (intent && intent.pathname !== shownPathnameRef.current) {
        stage.dataset.routeLeave = intent.kind;
      } else if (stage.dataset.routeLeave) {
        // The navigation was dropped (it never landed): the page comes back the way a new one arrives.
        delete stage.dataset.routeLeave;
        playRouteEnter(stage, "peer");
      }
    });
  }, []);

  useIsomorphicLayoutEffect(() => {
    const stage = stageRef.current;
    const from = shownPathnameRef.current;
    shownPathnameRef.current = pathname;
    if (!stage || from === pathname) return;
    // Dropping the attribute also drops the exit transition (none at rest), so it can't fight the entrance.
    delete stage.dataset.routeLeave;
    playRouteEnter(stage, classifyRoute(from, pathname));
  }, [pathname]);

  return (
    <div ref={stageRef} className={cn("route-stage page-reveal", className)}>
      {children}
    </div>
  );
}
