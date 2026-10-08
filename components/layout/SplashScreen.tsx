"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/** Never keep a student waiting longer than this, ready or not. */
const MAX_WAIT_MS = 3500;
const FADE_MS = 320;

/**
 * Its CSS is inlined with the markup (not in globals.css), so the server HTML
 * paints the white splash on the very first frame — before the stylesheet,
 * the fonts or any JavaScript. That first frame used to be blank white, then
 * the page's own dark background, then text appearing as fonts and data
 * arrived. The last rule is the no-JavaScript safety net: the splash fades
 * away on its own after 8 s even if React never hydrates.
 */
const SPLASH_CSS = `
#medart-splash{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;opacity:1;transition:opacity ${FADE_MS}ms ease;animation:medart-splash-timeout .4s ease 8s forwards}
#medart-splash[data-leaving="true"]{opacity:0;pointer-events:none}
#medart-splash .medart-splash-logo{animation:medart-splash-breathe 1.8s ease-in-out infinite}
#medart-splash .medart-splash-track{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 56px);width:min(160px,40vw);height:3px;transform:translateX(-50%);overflow:hidden;border-radius:999px;background:#e0f2fe}
#medart-splash .medart-splash-bar{position:absolute;inset:0 auto 0 0;width:40%;border-radius:999px;background:linear-gradient(90deg,#0ea5e9,#14b8a6);animation:medart-splash-slide 1.1s cubic-bezier(.65,0,.35,1) infinite}
@keyframes medart-splash-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@keyframes medart-splash-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}
@keyframes medart-splash-timeout{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){#medart-splash .medart-splash-logo{animation:none}#medart-splash .medart-splash-bar{animation-duration:2.4s}}
`;

/**
 * Launch splash: pure white, the MedArt AI logo centered, a slim loading bar
 * at the bottom. Rendered once by the root layout, so it covers the first
 * load of any page and never reappears on client-side navigation. It leaves
 * once the app is ready — hydrated (this effect), web fonts loaded, and the
 * window's load event — capped at MAX_WAIT_MS.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "leaving" | "gone">("visible");

  useEffect(() => {
    let finished = false;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      setPhase("leaving");
      fadeTimer = setTimeout(() => setPhase("gone"), FADE_MS);
    };

    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    const windowLoaded =
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
    void Promise.all([fontsReady, windowLoaded]).then(() => requestAnimationFrame(finish));
    const capTimer = setTimeout(finish, MAX_WAIT_MS);

    return () => {
      finished = true;
      clearTimeout(capTimer);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div id="medart-splash" data-leaving={phase === "leaving"} role="status" aria-live="polite" aria-label="Chargement de MedArt AI">
      <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS }} />
      <Image src="/logo.png" alt="MedArt AI" width={120} height={156} sizes="120px" priority className="medart-splash-logo" />
      <div className="medart-splash-track" aria-hidden="true">
        <div className="medart-splash-bar" />
      </div>
    </div>
  );
}
