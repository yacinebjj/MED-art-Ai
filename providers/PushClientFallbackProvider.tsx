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
 * TESTING VALUE — 2 minutes, so this is actually observable while
 * building/QAing. For production, change this one constant to
 * 60 * 60 * 1000 (60 minutes) and nothing else needs to change.
 */
const DISPATCH_INTERVAL_MS = 2 * 60 * 1000;

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

        await fetch("/api/push/dispatch-self", { method: "POST" }).catch(() => null);
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } finally {
        checkingRef.current = false;
      }
    }

    tick();
    const interval = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return <>{children}</>;
}
