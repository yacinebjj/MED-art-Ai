"use client";

import { useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { announceNavigation, settleRouteIntent } from "@/lib/motion";

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
 * MotionConfig reducedMotion="user": under prefers-reduced-motion,
 * framer-motion keeps opacity and color animations and drops the
 * transforms — the same calm motion app/globals.css applies to CSS.
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

  const content = <MotionConfig reducedMotion="user">{children}</MotionConfig>;
  // Browser only. Nothing navigates during server rendering, and the server
  // build resolves this context import to a different copy than the one Next
  // renders with: providing it there only trips React's "multiple renderers"
  // warning. The extra provider renders no DOM, so hydration is unaffected.
  if (typeof window === "undefined") return content;
  return <AppRouterContext.Provider value={motionRouter}>{content}</AppRouterContext.Provider>;
}
