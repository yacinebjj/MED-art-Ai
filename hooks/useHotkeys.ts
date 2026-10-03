"use client";

import { useEffect, useRef, useState } from "react";

export interface HotkeyBinding {
  /** e.g. "mod+k", "shift+n", "mod+/", "mod+shift+l", "?" — `mod` is ⌘ on Apple platforms, Ctrl elsewhere. */
  combo: string;
  handler: (event: KeyboardEvent) => void;
  /** Fire even while focus is in an input/textarea/contentEditable (only sensible for modifier combos). */
  allowInInputs?: boolean;
  enabled?: boolean;
}

/**
 * A modal dialog (Radix Dialog: file viewer, upload, delete confirmation…)
 * owns the keyboard while it's open — workspace shortcuts must not act on
 * the page behind it. The command palette is the one dialog that keeps its
 * own shortcut (Ctrl/⌘+K closes it).
 */
function isInsideForeignDialog(target: EventTarget | null): boolean {
  const insidePalette = target instanceof Element && target.closest("[data-command-palette]") !== null;
  if (insidePalette) return false;
  return document.querySelector('[role="dialog"]:not([data-command-palette]), [role="alertdialog"]') !== null;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const CODE_FOR_SYMBOL: Record<string, string> = { "/": "Slash", "\\": "Backslash", ".": "Period", ",": "Comma" };

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const wantsMod = parts.includes("mod");
  const wantsShift = parts.includes("shift");
  const wantsAlt = parts.includes("alt");
  const hasMod = event.ctrlKey || event.metaKey;
  if (wantsMod !== hasMod || wantsAlt !== event.altKey) return false;

  const eventKey = event.key.toLowerCase();
  const isLetter = /^[a-z]$/.test(key);
  // Letters: Shift must match exactly ("n" vs "shift+n"). Symbols: the
  // physical key or the produced character both count, since "/" or "?"
  // need Shift on many layouts (AZERTY included).
  if (isLetter) return wantsShift === event.shiftKey && (eventKey === key || event.code === `Key${key.toUpperCase()}`);
  if (wantsShift && !event.shiftKey) return false;
  return eventKey === key || (CODE_FOR_SYMBOL[key] !== undefined && event.code === CODE_FOR_SYMBOL[key]);
}

/**
 * Global keyboard shortcuts for one page. Bindings are read through a ref,
 * so passing a fresh array every render never re-attaches the listener.
 * Plain-key shortcuts are ignored while the student is typing.
 */
export function useHotkeys(bindings: HotkeyBinding[]) {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (isInsideForeignDialog(event.target)) return;
      const typing = isTextEntry(event.target);
      for (const binding of bindingsRef.current) {
        if (binding.enabled === false) continue;
        if (typing && !binding.allowInInputs) continue;
        if (!matches(event, binding.combo)) continue;
        event.preventDefault();
        binding.handler(event);
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere — "Ctrl" until mounted, so SSR and hydration agree. */
export function useModKeyLabel(): string {
  const [label, setLabel] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)) setLabel("⌘");
  }, []);
  return label;
}
