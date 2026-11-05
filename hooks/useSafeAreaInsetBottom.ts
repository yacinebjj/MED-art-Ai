"use client";

import { useEffect, useState } from "react";

/**
 * The bottom safe-area inset in pixels: the strip the iPhone's home
 * indicator needs (0 where there is none, and on the server). CSS knows it
 * as env(safe-area-inset-bottom) but JavaScript has no API for it, so a
 * hidden fixed probe of exactly that height is measured, again after every
 * resize or rotation.
 */
export function useSafeAreaInsetBottom(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const read = () => setInset(Math.round(probe.getBoundingClientRect().height));
    read();
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
      probe.remove();
    };
  }, []);

  return inset;
}
