"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

/**
 * First-run guided tour of the dashboard (components/onboarding/OnboardingTour.tsx).
 *
 * Completion is stored twice:
 *  - localStorage (`medart:onboarding-done:<userId>`) — instant, per device;
 *  - Supabase auth user metadata (`has_completed_onboarding: true`) — follows
 *    the student to every device. Auth metadata needs no table or migration,
 *    and the client may write its own metadata.
 *
 * Auto-start rule: only accounts created on/after TOUR_RELEASED_AT that have
 * completed (or skipped) the tour on neither side. Students who signed up
 * before the tour existed are not first-time users — they can still replay it
 * from Settings → Apparence ("Revoir le guide").
 */
const TOUR_RELEASED_AT = Date.parse("2026-10-06T00:00:00Z");
const STORAGE_PREFIX = "medart:onboarding-done:";
/** The tour lives on the dashboard home: that is where every target is. */
export const ONBOARDING_ROUTE = "/dashboard";
/** Let the dashboard paint (widgets, curriculum) before the spotlight looks for its targets. */
const AUTO_START_DELAY_MS = 1400;

interface OnboardingContextValue {
  active: boolean;
  /** Starts (or restarts) the tour, navigating to the dashboard first if needed. */
  start: () => void;
  /** Ends the tour and records it as done (skip and finish are the same for persistence). */
  finish: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function readLocalDone(userId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function writeLocalDone(userId: string): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, "1");
  } catch {
    // Storage blocked: the auth metadata write below still records it.
  }
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const autoChecked = useRef<string | null>(null);

  // Auto-start, once per signed-in account per page load.
  useEffect(() => {
    if (!user || pathname !== ONBOARDING_ROUTE || autoChecked.current === user.id) return;
    const doneRemotely = user.user_metadata?.has_completed_onboarding === true;
    const createdAt = user.created_at ? Date.parse(user.created_at) : 0;
    if (doneRemotely || readLocalDone(user.id) || !(createdAt >= TOUR_RELEASED_AT)) return;
    const userId = user.id;
    // Marked only when it actually opens: a refreshed auth object re-running
    // this effect mid-delay must reschedule, not silently drop the tour.
    const id = window.setTimeout(() => {
      autoChecked.current = userId;
      setActive(true);
    }, AUTO_START_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [user, pathname]);

  // Leaving the dashboard closes the tour (its targets are gone), without marking it done.
  useEffect(() => {
    if (pathname !== ONBOARDING_ROUTE) setActive(false);
  }, [pathname]);

  const start = useCallback(() => {
    if (pathname !== ONBOARDING_ROUTE) {
      router.push(ONBOARDING_ROUTE);
      // Opened once the dashboard is the current route (see the effect above for auto-start's own delay).
      window.setTimeout(() => setActive(true), AUTO_START_DELAY_MS);
      return;
    }
    setActive(true);
  }, [pathname, router]);

  const finish = useCallback(() => {
    setActive(false);
    if (!user) return;
    writeLocalDone(user.id);
    if (user.user_metadata?.has_completed_onboarding === true) return;
    void createClient()
      .auth.updateUser({ data: { has_completed_onboarding: true } })
      .then(({ error }) => {
        if (error) console.warn("[onboarding] Synchronisation du guide impossible (gardé sur cet appareil) :", error.message);
      });
  }, [user]);

  const value = useMemo(() => ({ active, start, finish }), [active, start, finish]);
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error("useOnboarding must be used within an OnboardingProvider");
  return context;
}

/** Same as useOnboarding, but null outside the dashboard shell (for components also rendered elsewhere). */
export function useOptionalOnboarding(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}
