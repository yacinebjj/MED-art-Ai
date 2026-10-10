"use client";

import { useEffect } from "react";

/**
 * iOS Safari ignores `user-scalable=no` / `maximum-scale` for pinch since
 * iOS 10; WebKit's own gesture events are the only way to stop a pinch
 * there. Other browsers are covered by the viewport lock (app/layout.tsx)
 * and `touch-action: pan-x pan-y` (app/globals.css).
 */
export function ZoomLock() {
  useEffect(() => {
    const block = (event: Event) => event.preventDefault();
    const events = ["gesturestart", "gesturechange", "gestureend"] as const;
    events.forEach((name) => document.addEventListener(name, block, { passive: false }));
    return () => events.forEach((name) => document.removeEventListener(name, block));
  }, []);

  return null;
}
