"use client";

/**
 * Client-side hourly fallback for whoever hasn't wired a real cron to
 * app/api/push/dispatch yet — see that route's own header comment for why
 * this can never fully substitute for it (it only fires while a tab
 * happens to be open, which defeats half of what push notifications are
 * for). Deliberately does NOT show any in-app UI of its own — it only ever
 * triggers a REAL OS-level push (via app/api/push/dispatch-self), which is
 * what makes this a genuine replacement for the old GlobalFlashcardProvider
 * in-app modal rather than a disguised reintroduction of it.
 *
 * Mounted in the ROOT layout (app/layout.tsx), same reasoning as the old
 * provider it replaces: app/study has no layout.tsx of its own, so only the
 * root layout actually covers every page a signed-in student can be on.
 * Session state is inferred the same way too — the dispatch-self endpoint
 * 401s if there's no session, treated as "stay silent".
 */

import { useEffect, useRef } from "react";
import { getPushStatus } from "@/lib/push/subscribe";

/**
 * 60 minutes. (Was a 2-minute TESTING value left in production — the cause
 * of the "one flashcard notification every couple of minutes" reports.) The
 * server is the real authority anyway: lib/push/dispatch.ts sends at most one
 * reminder per student per chosen interval (1 h / 2 h / 4 h) across every
 * device and the cron, so several open devices can no longer multiply it.
 */
const DISPATCH_INTERVAL_MS = 60 * 60 * 1000;

/** How often we check whether DISPATCH_INTERVAL_MS has elapsed — cheap (a localStorage read + Date.now() compare) until it actually has. */
const CHECK_INTERVAL_MS = 30 * 1000;

const STORAGE_KEY = "medart:last-push-dispatch-self-at";

export function PushClientFallbackProvider({ children }: { children: React.ReactNode }) {
  const checkingRef = useRef(false);

  useEffect(() => {
    async function tick() {
      if (checkingRef.current) return;

      const lastDispatch = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
      if (!lastDispatch) {
        // First-ever visit: seed the baseline instead of firing immediately.
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
        return;
      }
      if (Date.now() - lastDispatch < DISPATCH_INTERVAL_MS) return;

      checkingRef.current = true;
      try {
        const status = await getPushStatus();
        if (status !== "subscribed") return; // never opted in — nothing to dispatch, stay silent

        // Claim the slot BEFORE the request so two tabs of this browser can never both fire.
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
        await fetch("/api/push/dispatch-self", { method: "POST" }).catch(() => null);
      } finally {
        checkingRef.current = false;
      }
    }

    tick();
    const interval = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // A reminder clicked while this tab is open but not controlled by the service
  // worker: public/sw.js asks the page to open the notified flashcard itself.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    function handleMessage(event: MessageEvent) {
      const data: unknown = event.data;
      if (!data || typeof data !== "object") return;
      const { type, url } = data as { type?: unknown; url?: unknown };
      if (type !== "medart:navigate" || typeof url !== "string") return;
      try {
        const target = new URL(url, window.location.origin);
        if (target.origin === window.location.origin) window.location.assign(target.href);
      } catch {
        // Malformed URL — ignore.
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  return <>{children}</>;
}
