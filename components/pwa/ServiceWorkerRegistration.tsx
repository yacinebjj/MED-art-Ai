"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js for EVERY visitor on load — separate from Web
 * Push's own subscribeToPush() flow (lib/push/subscribe.ts), which still
 * only ever registers/subscribes from an explicit user click and never
 * auto-prompts for notification permission. navigator.serviceWorker.register()
 * does not request any permission or show any UI by itself — this purely
 * gets a controlling service worker installed early so PWA installability
 * (Android "Add to Home Screen" / desktop install) applies to every
 * visitor, not only students who already opted into push reminders.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — the app is fully usable without a service worker; this
      // is purely a PWA-installability enhancement, not a dependency.
    });
  }, []);

  return null;
}
