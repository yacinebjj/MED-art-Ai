"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PAGE_TOURS_ENABLED } from "@/lib/feature-flags";
import { isPageTour, pageTourFor, type TourId } from "@/lib/onboarding/tour-ids";

/**
 * Guided tours (components/onboarding/OnboardingTour.tsx): the dashboard's
 * first-run tour, one tour per page and one per Studio / Lab tool — ids and
 * routes in lib/onboarding/tour-ids.ts, steps in lib/onboarding/tours.ts.
 *
 * Completion is stored twice:
 *  - localStorage — instant, per device;
 *  - Supabase auth user metadata — follows the student to every device. Auth
 *    metadata needs no table or migration, and the client may write its own
 *    metadata.
 * The dashboard tour keeps its original keys (`medart:onboarding-done:<userId>`,
 * `has_completed_onboarding: true`); every other tour uses
 * `medart:tour-done:<tourId>:<userId>` and the `completed_tours` list.
 *
 * Auto-start rule: the first visit of a page (or first opening of a tool) by
 * an account created on/after that tour's release that has completed (or
 * skipped) it on neither side — and only once the page is idle: no dialog,
 * menu or palette open, nothing being typed, no work in progress (pages
 * declare theirs with useTourBlocker). A page still busy after a few seconds
 * keeps its tour for the next visit. Students who signed up before a tour
 * existed are not first-time users — they open any page's tour with its "?"
 * guide button (components/onboarding/TourReplayButton.tsx), and replay the
 * dashboard tour from Settings → Apparence ("Revoir le guide").
 */
const TOUR_RELEASED_AT = Date.parse("2026-10-06T00:00:00Z");
/** Page and tool tours auto-start only for accounts created from their release on. */
const PAGE_TOURS_RELEASED_AT = Date.parse("2026-10-29T00:00:00Z");
const STORAGE_PREFIX = "medart:onboarding-done:";
const TOUR_STORAGE_PREFIX = "medart:tour-done:";
/** The first-run tour lives on the dashboard home: that is where every target is. */
export const ONBOARDING_ROUTE = "/dashboard";
/** Let the page paint (widgets, lists, panels) before the spotlight looks for its targets. */
const AUTO_START_DELAY_MS = 1400;
/** A busy page is re-checked this often, this many times; still busy, its tour waits for the next visit. */
const IDLE_RETRY_MS = 1000;
const IDLE_RETRIES = 8;
/** Open dialogs, sheets, menus, popovers, palettes and the boot splash: a tour would cover them, or sit under them unclickable. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-radix-popper-content-wrapper], [data-command-palette], #medart-splash';
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

interface OnboardingContextValue {
  /** True while any tour is on screen. */
  active: boolean;
  /** The tour on screen, if any. */
  activeTour: TourId | null;
  /** Starts (or restarts) the dashboard tour, navigating to the dashboard first if needed. */
  start: () => void;
  /** Opens `tour` now, done before or not — the "?" guide buttons. */
  startTour: (tour: TourId) => void;
  /** Ends the tour on screen and records it as done (skip and finish are the same for persistence). */
  finish: () => void;
  /** Closes the tour on screen without recording it (none of its features is on screen). */
  dismiss: () => void;
  /** Auto-starts `tour` once, if this account should see it and the page goes idle. Returns a cancel function. */
  requestTour: (tour: TourId) => () => void;
  /** Closes `tour` if it is on screen — its tool view is gone. */
  closeIfActive: (tour: TourId) => void;
  /** Marks the page busy until the returned release function runs: no tour auto-starts meanwhile. */
  block: () => () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function readLocalDone(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeLocalDone(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: the auth metadata write still records it.
  }
}

function localDoneKey(tour: TourId, userId: string): string {
  return tour === "dashboard" ? STORAGE_PREFIX + userId : `${TOUR_STORAGE_PREFIX}${tour}:${userId}`;
}

/** Page and tool tours recorded on the account (every device). */
function remoteDoneTours(user: User): string[] {
  const list: unknown = user.user_metadata?.completed_tours;
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

function isTourDone(tour: TourId, user: User): boolean {
  if (readLocalDone(localDoneKey(tour, user.id))) return true;
  if (tour === "dashboard") return user.user_metadata?.has_completed_onboarding === true;
  return remoteDoneTours(user).includes(tour);
}

function isEligible(tour: TourId, user: User): boolean {
  const createdAt = user.created_at ? Date.parse(user.created_at) : 0;
  if (tour === "dashboard") return createdAt >= TOUR_RELEASED_AT;
  return PAGE_TOURS_ENABLED && createdAt >= PAGE_TOURS_RELEASED_AT;
}

/** True when nothing on screen would be covered, interrupted or locked by a tour. */
function pageIsIdle(): boolean {
  if (document.hidden || document.fullscreenElement) return false;
  if (document.querySelector(OVERLAY_SELECTOR)) return false;
  // An open Radix modal locks the rest of the page this way.
  if (document.body.style.pointerEvents === "none") return false;
  // Something is being typed (a merely focused, empty field doesn't count).
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.isContentEditable) return false;
  if (focused instanceof HTMLTextAreaElement && focused.value.trim() !== "") return false;
  if (focused instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(focused.type) && focused.value.trim() !== "") return false;
  return true;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [activeTour, setActiveTour] = useState<TourId | null>(null);
  // Mirrors of the state above for timers and callbacks, which must see the latest value.
  const activeRef = useRef<TourId | null>(null);
  /** The tour on screen was opened by the student ("?" / Settings), not auto-started. */
  const manualRef = useRef(false);
  const blockersRef = useRef(0);
  /** `${userId}:${tour}` auto-opened during this page load — never twice, even before its completion write lands. */
  const shownRef = useRef(new Set<string>());
  /** Tours finished during this page load, merged into every metadata write so two quick finishes can't overwrite each other. */
  const finishedRef = useRef(new Set<string>());

  const open = useCallback((tour: TourId | null, manual: boolean) => {
    activeRef.current = tour;
    manualRef.current = manual;
    setActiveTour(tour);
  }, []);

  const requestTour = useCallback(
    (tour: TourId) => {
      if (!user || !isEligible(tour, user) || isTourDone(tour, user)) return () => undefined;
      const shownKey = `${user.id}:${tour}`;
      let attempts = 0;
      let timer = 0;
      const attempt = () => {
        if (shownRef.current.has(shownKey)) return;
        // Marked only when it actually opens: a refreshed auth object re-running
        // the caller's effect mid-delay must reschedule, not silently drop the tour.
        if (activeRef.current === null && blockersRef.current === 0 && pageIsIdle()) {
          shownRef.current.add(shownKey);
          open(tour, false);
          return;
        }
        if (attempts < IDLE_RETRIES) {
          attempts += 1;
          timer = window.setTimeout(attempt, IDLE_RETRY_MS);
        }
      };
      timer = window.setTimeout(attempt, AUTO_START_DELAY_MS);
      return () => window.clearTimeout(timer);
    },
    [user, open]
  );

  // Each page's tour, on its first visit.
  useEffect(() => {
    const tour = pageTourFor(pathname);
    return tour ? requestTour(tour) : undefined;
  }, [pathname, requestTour]);

  // Leaving a page closes its tour (its targets are gone), without marking it done.
  useEffect(() => {
    const tour = activeRef.current;
    if (tour && isPageTour(tour) && pageTourFor(pathname) !== tour) open(null, false);
  }, [pathname, open]);

  const start = useCallback(() => {
    if (pathname !== ONBOARDING_ROUTE) {
      router.push(ONBOARDING_ROUTE);
      // Opened once the dashboard is the current route (requestTour applies the same delay to auto-starts).
      window.setTimeout(() => open("dashboard", true), AUTO_START_DELAY_MS);
      return;
    }
    open("dashboard", true);
  }, [pathname, router, open]);

  const startTour = useCallback(
    (tour: TourId) => {
      if (tour !== "dashboard" && !PAGE_TOURS_ENABLED) return;
      open(tour, true);
    },
    [open]
  );

  const finish = useCallback(() => {
    const tour = activeRef.current;
    open(null, false);
    if (!tour || !user) return;
    writeLocalDone(localDoneKey(tour, user.id));
    const warn = ({ error }: { error: { message: string } | null }) => {
      if (error) console.warn("[onboarding] Synchronisation du guide impossible (gardé sur cet appareil) :", error.message);
    };
    if (tour === "dashboard") {
      if (user.user_metadata?.has_completed_onboarding === true) return;
      void createClient().auth.updateUser({ data: { has_completed_onboarding: true } }).then(warn);
      return;
    }
    finishedRef.current.add(tour);
    const remote = remoteDoneTours(user);
    if (remote.includes(tour)) return;
    void createClient()
      .auth.updateUser({ data: { completed_tours: Array.from(new Set([...remote, ...finishedRef.current])) } })
      .then(warn);
  }, [user, open]);

  const dismiss = useCallback(() => open(null, false), [open]);

  const closeIfActive = useCallback(
    (tour: TourId) => {
      if (activeRef.current === tour) open(null, false);
    },
    [open]
  );

  const block = useCallback(() => {
    blockersRef.current += 1;
    // Work that starts by itself under an auto-started tour (an exam resuming,
    // cards being generated…) wins: the tour steps aside until the next visit.
    if (activeRef.current !== null && !manualRef.current) open(null, false);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      blockersRef.current -= 1;
    };
  }, [open]);

  const value = useMemo(
    () => ({ active: activeTour !== null, activeTour, start, startTour, finish, dismiss, requestTour, closeIfActive, block }),
    [activeTour, start, startTour, finish, dismiss, requestTour, closeIfActive, block]
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error("useOnboarding must be used within an OnboardingProvider");
  return context;
}

/** Same as useOnboarding, but null outside /dashboard (for components also rendered elsewhere). */
export function useOptionalOnboarding(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}

/**
 * Declares work in progress (a reply streaming, a generation, a timed exam,
 * unsaved typing…): no tour auto-starts while `busy`, and an auto-started
 * one steps aside. A no-op outside /dashboard.
 */
export function useTourBlocker(busy: boolean): void {
  const block = useContext(OnboardingContext)?.block;
  useEffect(() => (busy && block ? block() : undefined), [busy, block]);
}

/**
 * A Studio / Lab tool's tour (or a page's second interface, e.g. the exam
 * correction): auto-starts the first time the view is shown, once `ready`
 * (its controls on screen, nothing running), and closes with the view.
 */
export function useToolTour(tour: TourId, ready = true): void {
  const context = useContext(OnboardingContext);
  const requestTour = context?.requestTour;
  const closeIfActive = context?.closeIfActive;
  useEffect(() => (ready && requestTour ? requestTour(tour) : undefined), [ready, requestTour, tour]);
  useEffect(() => () => closeIfActive?.(tour), [closeIfActive, tour]);
}
