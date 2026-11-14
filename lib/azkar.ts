/**
 * Hourly spiritual reminder — the rhythm and the memory behind the quiet
 * card (components/spiritual/AzkarReminder.tsx): at most one verse or dhikr
 * an hour, in turn (lib/azkar-content.ts), per device.
 *
 * Everything lives in this browser's localStorage, shared by its tabs: the
 * last time a reminder appeared (so two open tabs never both show one, and a
 * reload doesn't show it again), the next entry of the rotation, and the
 * student's choice to turn the reminders off. Any storage failure (private
 * mode, blocked storage) simply means no reminder — never an error.
 */

import { AZKAR_ENTRIES, type AzkarEntry } from "@/lib/azkar-content";

export type { AzkarEntry };

/** One reminder an hour, at most. */
export const AZKAR_INTERVAL_MS = 60 * 60 * 1000;
/** The first reminder of a visit waits this long: the student has just arrived and is finding their way. */
export const AZKAR_SETTLE_MS = 40 * 1000;
/** A moment that isn't right (typing, a dialog, an exam…): look again this much later. */
export const AZKAR_RETRY_MS = 20 * 1000;
/** How long the card stays — long enough to read a verse slowly. Paused while pointed at or touched. */
export const AZKAR_VISIBLE_MS = 14 * 1000;

/** `window.dispatchEvent(new Event(AZKAR_SHOW_EVENT))` shows the next reminder now (Paramètres › Rappels, "Afficher un rappel"). */
export const AZKAR_SHOW_EVENT = "medart:azkar-show";
/** Fired on this tab when the student turns the reminders on or off (other tabs hear the storage event). */
export const AZKAR_PREF_EVENT = "medart:azkar-pref";

/** The reminder's own card in Paramètres › Rappels — where the card's settings button leads. */
export const AZKAR_SETTINGS_ANCHOR = "rappels-spirituels";
export const AZKAR_SETTINGS_HREF = `/dashboard/settings?section=reminders#${AZKAR_SETTINGS_ANCHOR}`;

const KEY_OFF = "medart:azkar:off";
const KEY_LAST = "medart:azkar:last";
const KEY_NEXT = "medart:azkar:next";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Whether the student wants the reminders on this device (on unless turned off). */
export function isAzkarEnabled(): boolean {
  return read(KEY_OFF) !== "1";
}

export function setAzkarEnabled(enabled: boolean): void {
  write(KEY_OFF, enabled ? null : "1");
  window.dispatchEvent(new Event(AZKAR_PREF_EVENT));
}

/**
 * When the last reminder appeared on this device (any tab), or null if never.
 * A time still in the future means the device clock was set back since: it
 * is ignored, or the reminders would wait for the clock to catch up.
 */
export function readLastShown(now: number = Date.now()): number | null {
  const value = Number(read(KEY_LAST));
  return Number.isFinite(value) && value > 0 && value <= now ? value : null;
}

/**
 * When the next reminder is due: an hour after the last one, and never
 * sooner than AZKAR_SETTLE_MS into this visit.
 */
export function nextDueAt(lastShown: number | null, visitStartedAt: number): number {
  const settled = visitStartedAt + AZKAR_SETTLE_MS;
  return lastShown === null ? settled : Math.max(lastShown + AZKAR_INTERVAL_MS, settled);
}

/**
 * Takes this hour's slot for the calling tab: re-reads the shared clock (a
 * tab next to it may just have shown one) and, if the hour has passed, marks
 * it as used now. False = not this time.
 */
export function claimAzkarSlot(now: number): boolean {
  const last = readLastShown(now);
  if (last !== null && now - last < AZKAR_INTERVAL_MS) return false;
  return write(KEY_LAST, String(now));
}

/**
 * The next entry of the rotation, and the rotation moves on. A device's first
 * reminder starts at a random point, so students don't all begin with the
 * same verse.
 */
export function takeNextAzkar(random: () => number = Math.random): AzkarEntry {
  const count = AZKAR_ENTRIES.length;
  const stored = Number.parseInt(read(KEY_NEXT) ?? "", 10);
  const index = Number.isInteger(stored) && stored >= 0 ? stored % count : Math.floor(random() * count) % count;
  write(KEY_NEXT, String((index + 1) % count));
  return AZKAR_ENTRIES[index];
}

/** Asks the mounted reminder to show the next entry now (a preview: the hourly clock is left as it is). */
export function requestAzkarNow(): void {
  window.dispatchEvent(new Event(AZKAR_SHOW_EVENT));
}

/** Pages where nothing may appear on top: a timed exam, a presentation. */
const QUIET_ROUTES = [/^\/dashboard\/module\/[^/]+\/exam(?:\/|$)/, /^\/dashboard\/demo\/presentation(?:\/|$)/];

export function isQuietRoute(pathname: string): boolean {
  return QUIET_ROUTES.some((route) => route.test(pathname));
}

/** A field the student is typing in: no reminder in the middle of a sentence. */
const TYPING_TARGET =
  'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="file"]):not([type="color"])';

/**
 * Something modal is open: a Radix dialog, sheet or confirmation (a Radix
 * popover too, also role="dialog"), or one of the app's own full-screen
 * layers — voice mode, Zen reading, the command palette, the course viewer,
 * the device-limit screen — which are mounted only while open.
 */
const MODAL_OPEN = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]';

/**
 * Whether the page is busy with something a reminder must not interrupt, as
 * seen from the document itself: hidden tab, typing, an open dialog. The
 * card adds what only React knows (the route, a focus session, a guided tour).
 */
export function documentIsBusy(doc: Document = document): boolean {
  if (doc.visibilityState !== "visible") return true;
  const active = doc.activeElement;
  if (active instanceof Element && active.matches(TYPING_TARGET)) return true;
  return doc.querySelector(MODAL_OPEN) !== null;
}
