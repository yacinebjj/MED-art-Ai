import { useSyncExternalStore } from "react";

/**
 * INSTALLING MEDART AS AN APP (PWA) — the browser side, product order
 * 2026-11-10: an "Installer l'application" guide any student can follow in a
 * few seconds (components/pwa/InstallAppModal.tsx).
 *  - Which device and browser this is, to open the right guide.
 *  - Chromium's `beforeinstallprompt` (Android, desktop Chrome/Edge), caught
 *    as soon as this module runs — it is imported by the service-worker
 *    registration in the root layout, so on every page, before React hydrates
 *    — and kept for the guide's « Installer en 1 clic » button. iOS never
 *    fires it: there, the guide's steps are the way.
 *  - Whether MedArt already runs as the installed app (the entry points hide).
 *  - The guide's open state, shared by every entry point, and a window event
 *    (INSTALL_GUIDE_EVENT) any page can dispatch to open it.
 */

export type InstallPlatform = "ios" | "android" | "desktop";
export type InstallBrowser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "other";

export interface InstallEnvironment {
  platform: InstallPlatform;
  browser: InstallBrowser;
  /** Opened inside another app (Instagram, Facebook, TikTok, the Google app…): no install from there. */
  inAppBrowser: boolean;
  /** Already running as the installed app. */
  standalone: boolean;
}

/** Dispatch on window to open the guide from anywhere: window.dispatchEvent(new Event(INSTALL_GUIDE_EVENT)). */
export const INSTALL_GUIDE_EVENT = "medart:install-guide";
const SEEN_KEY = "medart:install-guide-seen";
const IN_APP_BROWSER = /\b(FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|Twitter|LinkedInApp|Pinterest|GSA\/)|; wv\)/i;

/**
 * The device and browser behind a user agent. iPadOS presents itself as a Mac:
 * a "Macintosh" with a touch screen is an iPad.
 */
export function detectInstallEnvironment(userAgent: string, options: { maxTouchPoints?: number; standalone?: boolean } = {}): InstallEnvironment {
  const ipadOs = /Macintosh/i.test(userAgent) && (options.maxTouchPoints ?? 0) > 1;
  const platform: InstallPlatform = /iPhone|iPad|iPod/i.test(userAgent) || ipadOs ? "ios" : /Android/i.test(userAgent) ? "android" : "desktop";
  let browser: InstallBrowser = "other";
  if (platform === "ios") {
    browser = /CriOS/i.test(userAgent) ? "chrome" : /FxiOS/i.test(userAgent) ? "firefox" : /EdgiOS/i.test(userAgent) ? "edge" : "safari";
  } else if (/SamsungBrowser/i.test(userAgent)) browser = "samsung";
  else if (/Edg(A|e)?\//i.test(userAgent)) browser = "edge";
  else if (/Firefox\//i.test(userAgent)) browser = "firefox";
  else if (/Chrome\/|Chromium\//i.test(userAgent)) browser = "chrome";
  else if (/Safari\//i.test(userAgent)) browser = "safari";
  return { platform, browser, inAppBrowser: IN_APP_BROWSER.test(userAgent), standalone: Boolean(options.standalone) };
}

/** Running as the installed app (home screen, dock, app window). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (typeof window.matchMedia !== "function") return false;
  return ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

/** This browser, now. */
export function currentInstallEnvironment(): InstallEnvironment {
  if (typeof navigator === "undefined") return { platform: "desktop", browser: "other", inAppBrowser: false, standalone: false };
  return detectInstallEnvironment(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints, standalone: isStandaloneDisplay() });
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export interface InstallState {
  /** The browser handed us its install prompt: « Installer en 1 clic » can show it. */
  canPrompt: boolean;
  /** Installed (running as the app, or installed during this visit): the entry points hide. */
  installed: boolean;
  /** The guide is open. */
  guideOpen: boolean;
  /** The guide has been opened on this device before: the entry points stop glowing. */
  guideSeen: boolean;
}

const INITIAL: InstallState = { canPrompt: false, installed: false, guideOpen: false, guideSeen: false };
let state: InstallState = INITIAL;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let capturing = false;
const listeners = new Set<() => void>();

function update(patch: Partial<InstallState>) {
  const next = { ...state, ...patch };
  if ((Object.keys(next) as (keyof InstallState)[]).every((key) => next[key] === state[key])) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/**
 * Starts listening (once). Called at module load by the service-worker
 * registration, so the browser's prompt — sent once, early, per page load —
 * is never missed. Its own mini-infobar is held back: the guide shows the
 * prompt when the student asks for it.
 */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    update({ canPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    update({ canPrompt: false, installed: true });
  });
  window.addEventListener(INSTALL_GUIDE_EVENT, () => openInstallGuide());
  let seen = false;
  try {
    seen = window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    // Storage blocked (private mode): the entry points just keep their glow.
  }
  update({ installed: isStandaloneDisplay(), guideSeen: seen });
}

/**
 * Shows the browser's own install dialog (Chromium). "unavailable": nothing
 * to show — iOS, an already installed app, a prompt already used (Chromium
 * hands out a new one later).
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  update({ canPrompt: false });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === "accepted") update({ installed: true });
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

export function openInstallGuide(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage blocked: the glow comes back on the next visit, nothing more.
  }
  update({ guideOpen: true, guideSeen: true });
}

export function setInstallGuideOpen(open: boolean): void {
  if (open) openInstallGuide();
  else update({ guideOpen: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL
  );
}
