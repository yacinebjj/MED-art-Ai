"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { needsLaunchWarmup, useAppWarmup, WARMUP_MAX_MS } from "@/lib/pwa/app-warmup";

const FADE_MS = 320;

/** Routes that get the full white splash (the client-rendered app). Every other page is server-rendered and readable at once, so it only gets the slim top bar. */
const SPLASH_ROUTES = ["/dashboard", "/study"];

/**
 * Its CSS is inlined with the markup (not in globals.css), so the server HTML
 * paints it on the very first frame — before the stylesheet, the fonts or
 * any JavaScript. The timeout rule is the no-JavaScript safety net: both
 * loaders fade away on their own after 8 s even if React never hydrates.
 */
const SHARED_KEYFRAMES = `
@keyframes medart-splash-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@keyframes medart-splash-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@keyframes medart-splash-timeout{to{opacity:0;visibility:hidden}}
`;

const SPLASH_CSS = `
#medart-splash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;opacity:1;transition:opacity ${FADE_MS}ms ease;animation:medart-splash-timeout .4s ease 8s forwards}
#medart-splash[data-leaving="true"]{opacity:0;pointer-events:none}
#medart-splash .medart-splash-logo{animation:medart-splash-breathe 1.8s ease-in-out infinite}
#medart-splash .medart-splash-track{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 56px);width:min(160px,40vw);height:3px;transform:translateX(-50%);overflow:hidden;border-radius:999px;background:#e0f2fe}
#medart-splash .medart-splash-bar{position:absolute;inset:0 auto 0 0;width:40%;border-radius:999px;background:linear-gradient(90deg,#0ea5e9,#14b8a6);animation:medart-splash-slide 1.1s cubic-bezier(.65,0,.35,1) infinite}
#medart-splash .medart-splash-bar[data-progress="true"]{animation:none;transform:none;transition:width .35s ease}
${SHARED_KEYFRAMES}
@media (prefers-reduced-motion:reduce){#medart-splash .medart-splash-logo{animation:none}#medart-splash .medart-splash-bar{animation-duration:2.4s}}
`;

const TOPBAR_CSS = `
#medart-topbar{position:fixed;top:0;left:0;right:0;z-index:2147483000;height:3px;overflow:hidden;pointer-events:none;opacity:1;transition:opacity ${FADE_MS}ms ease;animation:medart-splash-timeout .4s ease 8s forwards}
#medart-topbar[data-leaving="true"]{opacity:0}
#medart-topbar .medart-topbar-bar{position:absolute;inset:0 auto 0 0;width:40%;background:linear-gradient(90deg,#22d3ee,#0ea5e9,#8b5cf6);box-shadow:0 0 12px rgba(34,211,238,.7);animation:medart-splash-slide 1.1s cubic-bezier(.65,0,.35,1) infinite}
${SHARED_KEYFRAMES}
@media (prefers-reduced-motion:reduce){#medart-topbar .medart-topbar-bar{animation-duration:2.4s}}
`;

/**
 * Launch loader, rendered once by the root layout (never reappears on
 * client-side navigation):
 *  - app routes: pure white splash, logo centered, loading bar at the bottom;
 *  - public pages (landing, pricing, auth): content shows immediately, with
 *    only a slim progress bar at the top — the white splash used to hide the
 *    already-rendered hero and read as a "white flash" over the dark landing.
 * Both leave as soon as React has hydrated (this effect) and painted once
 * more — no longer waiting for web fonts or the window load event (images,
 * 3D background), which held it up to 3.5 s. Exception: the first dashboard
 * launch of an app session, held (with a real progress bar) for the launch
 * warm-up — see the effect below.
 */
export function SplashScreen() {
  const pathname = usePathname() ?? "/";
  const fullSplash = SPLASH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const [phase, setPhase] = useState<"visible" | "leaving" | "gone">("visible");
  const [tracking, setTracking] = useState(false);
  const warmDone = useAppWarmup((state) => state.done);
  const warmTotal = useAppWarmup((state) => state.total);

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    let unsubscribe: (() => void) | undefined;
    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      frame = requestAnimationFrame(() => {
        setPhase("leaving");
        fadeTimer = setTimeout(() => setPhase("gone"), FADE_MS);
      });
    };

    // First dashboard launch of this app session: stay up while
    // components/pwa/AppWarmup.tsx prefetches pages and loads the Studio
    // code, so the app is fully usable the moment it appears. Capped —
    // never longer than WARMUP_MAX_MS (+ fade margin), and the CSS timeout
    // above still hides it at 8 s if JavaScript stalls entirely.
    const holdForWarmup = window.location.pathname.startsWith("/dashboard") && needsLaunchWarmup();
    if (!holdForWarmup) {
      leave();
    } else {
      setTracking(true);
      if (useAppWarmup.getState().finished) leave();
      unsubscribe = useAppWarmup.subscribe((state) => {
        if (state.finished) leave();
      });
      capTimer = setTimeout(leave, WARMUP_MAX_MS + 500);
    }

    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (fadeTimer) clearTimeout(fadeTimer);
      if (capTimer) clearTimeout(capTimer);
      unsubscribe?.();
    };
  }, []);

  const progressPct = warmTotal > 0 ? Math.max(8, Math.round((warmDone / warmTotal) * 100)) : 8;

  if (phase === "gone") return null;

  if (!fullSplash) {
    return (
      <div id="medart-topbar" data-leaving={phase === "leaving"} aria-hidden="true">
        <style dangerouslySetInnerHTML={{ __html: TOPBAR_CSS }} />
        <div className="medart-topbar-bar" />
      </div>
    );
  }

  return (
    <div id="medart-splash" data-leaving={phase === "leaving"} role="status" aria-live="polite" aria-label="Chargement de MedArt AI">
      <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />
      <Image src="/logo.png" alt="MedArt AI" width={120} height={156} sizes="120px" priority className="medart-splash-logo" />
      <div className="medart-splash-track" aria-hidden="true">
        <div
          className="medart-splash-bar"
          data-progress={tracking ? "true" : undefined}
          style={tracking ? { width: `${progressPct}%` } : undefined}
        />
      </div>
    </div>
  );
}
