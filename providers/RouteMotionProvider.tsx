"use client";

import { useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { announceNavigation, settleRouteIntent } from "@/lib/motion";
import { installDetailsMotion } from "@/lib/details-motion";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Motion context for everything under /dashboard.
 *
 * Route intent: next/link and useRouter() both navigate through the
 * AppRouterContext instance, so wrapping its push/replace here sees every
 * navigation the moment it is requested — a tapped link or a programmatic
 * redirect alike — long before the new page has loaded (lib/motion.ts,
 * announceNavigation). Everything else passes through untouched.
 *
 * Every native <details> under it unfolds and folds back
 * (lib/details-motion.ts).
 *
 * framer-motion is deliberately left at its default under reduced motion:
 * calm motion keeps spatial movement (app/globals.css), and the components
 * that animate something decorative check useReducedMotion() themselves.
 */
export function RouteMotionProvider({ children }: { children: ReactNode }) {
  const router = useContext(AppRouterContext);
  const pathname = usePathname();

  const motionRouter = useMemo<AppRouterInstance | null>(() => {
    if (!router) return router;
    return {
      ...router,
      push: (href, options) => {
        announceNavigation(href);
        router.push(href, options);
      },
      replace: (href, options) => {
        announceNavigation(href);
        router.replace(href, options);
      },
    };
  }, [router]);

  // The new route is on screen: its own entrance takes over. Runs after the
  // stages' own layout effects (children first), which read the intent.
  useIsomorphicLayoutEffect(() => {
    settleRouteIntent();
  }, [pathname]);

  useEffect(() => installDetailsMotion(), []);

  // Browser only. Nothing navigates during server rendering, and the server
  // build resolves this context import to a different copy than the one Next
  // renders with: providing it there only trips React's "multiple renderers"
  // warning. The extra provider renders no DOM, so hydration is unaffected.
  if (typeof window === "undefined") return <>{children}</>;
  return <AppRouterContext.Provider value={motionRouter}>{children}</AppRouterContext.Provider>;
}
