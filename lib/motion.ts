import { useSyncExternalStore } from "react";

/**
 * The app's motion vocabulary — the JavaScript half of the MOTION SYSTEM in
 * app/globals.css, which declares the same curves as custom properties.
 *
 * Everything that moves runs on the compositor (CSS animations, the Web
 * Animations API) and animates only opacity and the standalone `translate` /
 * `scale` properties. A phone's main thread is busy exactly when something
 * appears — React is mounting the new page or dialog — and an animation
 * driven from it (requestAnimationFrame, framer-motion's x/y/scale) loses
 * those frames and lands already finished: it reads as a pop.
 */

export const EASE_GLIDE = "cubic-bezier(0.22, 1, 0.36, 1)";
export const EASE_EXIT = "cubic-bezier(0.4, 0, 1, 1)";

/**
 * A damped spring (damping ratio 0.82, ~1% overshoot) sampled into a CSS
 * `linear()` curve: the mass accelerates, slightly passes its mark and
 * settles — the physical weight a cubic-bezier can't fake. Same curve as
 * --ease-spring in app/globals.css.
 */
const SPRING_SOFT =
  "linear(0, 0.0251, 0.0882, 0.1737, 0.2705, 0.3703, 0.4674, 0.5581, 0.6402, 0.7127, 0.7751, 0.8279, 0.8717, 0.9073, 0.9357, 0.9579, 0.9749, 0.9876, 0.9967, 1.003, 1.0072, 1.0096, 1.0108, 1.0111, 1.0108, 1.0101, 1.0091, 1.008, 1.0069, 1.0058, 1.0048, 1.0039, 1.0031, 1.0024, 1.0019, 1.0014, 1)";
const SPRING_SOFT_FALLBACK = "cubic-bezier(0.22, 1.08, 0.36, 1)";

let linearEasingSupported: boolean | null = null;

function springSoft(): string {
  if (linearEasingSupported === null) {
    linearEasingSupported = typeof CSS !== "undefined" && CSS.supports("animation-timing-function", "linear(0, 1)");
  }
  return linearEasingSupported ? SPRING_SOFT : SPRING_SOFT_FALLBACK;
}

/**
 * Calm motion (prefers-reduced-motion): things still fade in and out — nothing
 * ever pops — but nothing travels, zooms or bounces. Android's "Remove
 * animations", animations turned off in its developer options, and iOS Reduce
 * Motion all set this.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------------------------------------------------------------------------
   Route choreography
   --------------------------------------------------------------------------- */

/**
 * - peer: a lateral move between top-level destinations (dock, sidebar,
 *   account sheet) — the old page fades back, the new one fades through.
 * - forward: going deeper (a module, its workspace, an exam) — pages slide
 *   along the reading direction, like a native push.
 * - back: the reverse.
 */
export type RouteMotionKind = "peer" | "forward" | "back";

const PEER_ROUTES = new Set([
  "/dashboard",
  "/dashboard/assistant",
  "/dashboard/study",
  "/dashboard/notes",
  "/dashboard/todo",
  "/dashboard/groups",
  "/dashboard/billing",
  "/dashboard/settings",
  "/dashboard/search",
]);

function depth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

export function classifyRoute(from: string, to: string): RouteMotionKind {
  if (PEER_ROUTES.has(from) && PEER_ROUTES.has(to)) return "peer";
  const delta = depth(to) - depth(from);
  if (delta > 0) return "forward";
  if (delta < 0) return "back";
  return "peer";
}

// Routes rendered by app/dashboard/(shell)/layout.tsx: one RouteStage
// (components/layout/PageTransition.tsx) plays their transitions.
const SHELL_SECTIONS = ["/dashboard/assistant", "/dashboard/study", "/dashboard/todo", "/dashboard/groups", "/dashboard/notes", "/dashboard/billing", "/dashboard/settings", "/dashboard/admin"];

export function isShellRoute(pathname: string): boolean {
  return pathname === "/dashboard" || SHELL_SECTIONS.some((section) => pathname === section || pathname.startsWith(`${section}/`));
}

/**
 * A navigation that has started but whose page is not on screen yet. Set the
 * instant the router is asked to go somewhere (providers/RouteMotionProvider.tsx
 * wraps router.push/replace), cleared when the new route renders. It lets the
 * old page step back on the tap itself, the dock move to the tapped tab before
 * the page has loaded, and a progress light appear when loading takes a while.
 */
export interface RouteIntent {
  /** Pathname + search of the destination. */
  href: string;
  pathname: string;
  kind: RouteMotionKind;
}

// A navigation that never lands (offline, aborted) must not leave the page faded out.
const INTENT_TIMEOUT_MS = 8000;

let routeIntent: RouteIntent | null = null;
let intentTimer: ReturnType<typeof setTimeout> | undefined;
const intentListeners = new Set<() => void>();

function emitIntent() {
  intentListeners.forEach((listener) => listener());
}

export function subscribeRouteIntent(listener: () => void): () => void {
  intentListeners.add(listener);
  return () => {
    intentListeners.delete(listener);
  };
}

export function getRouteIntent(): RouteIntent | null {
  return routeIntent;
}

export function settleRouteIntent(): void {
  clearTimeout(intentTimer);
  if (!routeIntent) return;
  routeIntent = null;
  emitIntent();
}

/** Called with every href the router is asked to open. Same-page updates (search params, hash) start nothing. */
export function announceNavigation(href: string): void {
  if (typeof window === "undefined") return;
  let target: URL;
  try {
    target = new URL(href, window.location.href);
  } catch {
    return;
  }
  const from = window.location.pathname;
  if (target.origin !== window.location.origin || target.pathname === from) return;
  routeIntent = { href: target.pathname + target.search, pathname: target.pathname, kind: classifyRoute(from, target.pathname) };
  clearTimeout(intentTimer);
  intentTimer = setTimeout(settleRouteIntent, INTENT_TIMEOUT_MS);
  emitIntent();
}

export function useRouteIntent(): RouteIntent | null {
  return useSyncExternalStore(subscribeRouteIntent, getRouteIntent, () => null);
}

/**
 * The new page's entrance, played on its container by the Web Animations API
 * before its first paint. Opacity arrives quickly; the movement settles on the
 * soft spring.
 */
export function playRouteEnter(element: HTMLElement, kind: RouteMotionKind): void {
  if (typeof element.animate !== "function") return;
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 340, easing: EASE_GLIDE });
  if (prefersReducedMotion()) return;
  const from: Keyframe =
    kind === "peer"
      ? { translate: "0 10px", scale: "0.98" }
      : { translate: `${kind === "forward" ? 36 : -36}px 0`, scale: "1" };
  element.animate([from, { translate: "0 0", scale: "1" }], { duration: 640, easing: springSoft() });
}
