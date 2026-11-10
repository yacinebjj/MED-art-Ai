"use client";

import { useEffect } from "react";
import { captureInstallPrompt } from "@/lib/pwa-install";
import { InstallAppHost } from "@/components/pwa/InstallAppHost";

// As soon as this module runs — when the page's script loads, before React
// hydrates — so the browser's install prompt, sent once and early per page
// load, is never missed (lib/pwa-install.ts).
captureInstallPrompt();

/**
 * Registers public/sw.js for EVERY visitor on load — separate from Web
 * Push's own subscribeToPush() flow (lib/push/subscribe.ts), which still
 * only ever registers/subscribes from an explicit user click and never
 * auto-prompts for notification permission. navigator.serviceWorker.register()
 * does not request any permission or show any UI by itself — this purely
 * gets a controlling service worker installed early so PWA installability
 * (Android "Add to Home Screen" / desktop install) applies to every
 * visitor, not only students who already opted into push reminders.
 * Also hosts the « Installer l'application » guide, which any page can open
 * (components/pwa/InstallAppHost.tsx).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    captureInstallPrompt();
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — the app is fully usable without a service worker; this
      // is purely a PWA-installability enhancement, not a dependency.
    });
  }, []);

  return <InstallAppHost />;
}
