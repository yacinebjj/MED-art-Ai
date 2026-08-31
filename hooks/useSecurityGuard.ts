"use client";

import { useEffect, useState } from "react";

/**
 * Best-effort anti-leak deterrents for the whole app — mounted once at the
 * root layout via <SecurityGuard>. None of this is a real security
 * boundary (nothing client-side ever is): a determined user can still view
 * page source, use a browser reader mode, or photograph the screen. This
 * raises real friction against the casual "select, copy, paste into
 * WhatsApp" path, nothing more.
 *
 * "Smart clipboard" (copy/cut): text selection stays fully enabled
 * everywhere — a global `user-select: none` was tried and reverted, see
 * app/globals.css's own comment for why (it broke this app's real
 * highlight/quick-action toolbar, which needs window.getSelection() to
 * keep working). Instead, the boundary is enforced at the clipboard itself:
 * the REAL selected text is stashed in sessionStorage (same-tab only, gone
 * once it closes) for reuse INSIDE the app, while the SYSTEM clipboard —
 * what an external app like WhatsApp or a text editor would actually
 * receive — gets a fixed warning string instead. hooks/useSmartPaste.ts is
 * the other half: it recognizes that exact warning string on paste and
 * substitutes the real stashed text back in, so copy-paste keeps working
 * seamlessly WITHIN the app while a paste into anything else only ever
 * gets the warning.
 *
 * Deliberately NOT implemented here, and why:
 * - PrintScreen / Win+Shift+S detection: the OS captures the screen before
 *   any page JavaScript could react, and most browsers never even dispatch
 *   a usable keydown for PrintScreen in the first place. A "listener" for
 *   this would be pure theater — it would look like protection while
 *   providing none. See components/security/PrintGuard.tsx for the same
 *   reasoning applied to the group chat.
 * - F12 / Ctrl+Shift+I / Ctrl+Shift+C reliably blocking DevTools: current
 *   Chrome/Firefox increasingly ignore `preventDefault()` on these exact
 *   combinations, and DevTools opened via the browser's own menu (or
 *   already open before this page loads) is entirely unaffected either
 *   way. The attempt below is real (it does fire, and does call
 *   preventDefault), but it is a deterrent against a casual attempt, not a
 *   guarantee — never rely on it as an actual access-control boundary.
 *
 * Focus-loss blur has a short grace period (BLUR_GRACE_MS) before it
 * actually shows anything — found and fixed after a real report: reading a
 * course and selecting text to send to the AI could trigger the blur
 * overlay with no app or user error at all. `window.blur` doesn't fire from
 * clicking or selecting text WITHIN the page, but it CAN fire from a brief,
 * entirely legitimate OS-level popup that text selection itself triggers —
 * Windows 11's built-in "Click to Do" selection mini-toolbar is exactly
 * this, and it steals and returns focus in well under a second. A route
 * allowlist (e.g. "never blur on /dashboard/module/*") was considered and
 * rejected: that's exactly where the real course content lives, so
 * disabling the deterrent there specifically would defeat its own purpose.
 * A short grace period instead: a real switch to another app/window (the
 * actual threat model) stays blurred past a human's reaction time to even
 * reach for a screenshot tool; a sub-300ms blur-then-refocus flicker never
 * shows the overlay at all, anywhere, regardless of route.
 */

export const INTERNAL_CLIPBOARD_KEY = "medart_internal_clipboard";
export const EXTERNAL_COPY_WARNING = "⚠️ Copie externe interdite - MedArt AI.";

const BLUR_GRACE_MS = 300;

export function useSecurityGuard() {
  const [isBlurred, setIsBlurred] = useState(false);

  useEffect(() => {
    let blurTimeout: ReturnType<typeof setTimeout> | null = null;

    function scheduleBlur() {
      if (blurTimeout !== null) return; // already pending — a second blur before the first resolves shouldn't reset the clock.
      blurTimeout = setTimeout(() => {
        blurTimeout = null;
        setIsBlurred(true);
      }, BLUR_GRACE_MS);
    }

    function cancelBlur() {
      if (blurTimeout !== null) {
        clearTimeout(blurTimeout);
        blurTimeout = null;
      }
      setIsBlurred(false);
    }

    function swapClipboard(e: ClipboardEvent) {
      const selectedText = window.getSelection()?.toString() ?? "";
      if (!selectedText) return; // nothing selected — a stray copy/cut with no selection, let the browser do whatever it would normally do (nothing).

      sessionStorage.setItem(INTERNAL_CLIPBOARD_KEY, selectedText);
      e.clipboardData?.setData("text/plain", EXTERNAL_COPY_WARNING);
      e.preventDefault();
    }

    // Android dispatches a `contextmenu` event as PART of the long-press
    // gesture itself — the same gesture that starts text selection on a
    // touchscreen. Found during a mobile pass: preventDefault()-ing it
    // unconditionally (as this did before) risks killing long-press
    // selection on Android, which would break the highlight/Ask-AI toolbar
    // exactly where students actually read — on their phone. Desktop's
    // right-click has no such dependency (selection there is a separate
    // click-drag gesture handled entirely by useTextSelection's own mouse
    // listeners), so this only skips the block on touch-capable devices,
    // where the "block right-click save-image" deterrent was never doing
    // much anyway.
    const isTouchDevice = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

    function handleContextMenu(e: MouseEvent) {
      if (isTouchDevice) return;
      const target = e.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    }

    function handleKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const isBlockedCombo =
        key === "f12" ||
        (mod && key === "p") || // print
        (mod && key === "s") || // save page
        (mod && e.shiftKey && (key === "i" || key === "j" || key === "c")); // DevTools (best-effort — see header comment)

      if (isBlockedCombo) e.preventDefault();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") cancelBlur();
      else scheduleBlur();
    }

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("copy", swapClipboard);
    document.addEventListener("cut", swapClipboard);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", scheduleBlur);
    window.addEventListener("focus", cancelBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (blurTimeout !== null) clearTimeout(blurTimeout);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("copy", swapClipboard);
      document.removeEventListener("cut", swapClipboard);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", scheduleBlur);
      window.removeEventListener("focus", cancelBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return { isBlurred };
}
