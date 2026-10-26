"use client";

import { useEffect, useRef } from "react";
import { getRouteIntent, isShellRoute, playRouteEnter, subscribeRouteIntent } from "@/lib/motion";

/**
 * Re-created by Next.js each time the student moves between the dashboard's
 * big areas — the shell (home, Copilot, Réviser, Notes…), a module's
 * workspace, an exam, search. Each area opens like an app: a short fade and
 * a soft zoom (.route-area, app/globals.css). Moves INSIDE the shell don't
 * re-create it; the shell's own stage (components/layout/PageTransition.tsx)
 * plays those.
 *
 * Leaving an area outside the shell, the whole area steps back on the tap
 * (the shell's pages step back inside their own stage instead).
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeRouteIntent(() => {
      const area = areaRef.current;
      if (!area) return;
      const intent = getRouteIntent();
      if (intent && !isShellRoute(window.location.pathname)) {
        area.dataset.routeLeave = intent.kind;
      } else if (area.dataset.routeLeave) {
        // Still here: either the navigation stayed inside this area or it never landed.
        delete area.dataset.routeLeave;
        playRouteEnter(area, "peer");
      }
    });
  }, []);

  return (
    <div ref={areaRef} className="route-area">
      {children}
    </div>
  );
}
