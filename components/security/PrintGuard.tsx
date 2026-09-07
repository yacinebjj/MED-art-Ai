"use client";

import { useEffect, useState } from "react";

/**
 * Best-effort deterrent against printing/exporting a group chat's content —
 * scoped to wherever it's mounted (the chat room), not the whole app, so
 * legitimate printing elsewhere (an invoice, a settings page) is never
 * affected.
 *
 * DELIBERATELY DOES NOT attempt to detect PrintScreen or the Windows
 * Snipping Tool shortcut (Win+Shift+S / Cmd+Shift+S) — this is a real
 * technical limitation, not an oversight. Both take a screenshot at the
 * OPERATING SYSTEM level, entirely outside the browser tab's own process:
 * no web page JavaScript ever sees that key combination fire (there is no
 * reliable, cross-browser `keydown` for PrintScreen at all, and even where
 * one exists, the OS has already captured the pixels before any page script
 * could react). Shipping a "keydown listener + black overlay" for these
 * would be pure security theater — it would look like protection while
 * providing none, which is worse than being honest that it can't be done
 * this way. A real screenshot deterrent needs either watermarking (still
 * copyable, just traceable) or a native app with OS-level capture APIs —
 * out of scope for a web page.
 *
 * What IS interceptable from a web page: the browser's OWN print
 * command (Ctrl/Cmd+P) and the `beforeprint` event it fires. Covered here
 * as a soft deterrent (a toast-style overlay flash), never a hard block —
 * `preventDefault` on Ctrl+P is inconsistently honored across browsers, so
 * this warns rather than promises to stop it.
 */
export function PrintGuard() {
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    function flashWarning() {
      setWarning(true);
      window.setTimeout(() => setWarning(false), 1200);
    }

    function handleKeyDown(e: KeyboardEvent) {
      const isPrintShortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p";
      if (!isPrintShortcut) return;
      e.preventDefault();
      flashWarning();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeprint", flashWarning);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeprint", flashWarning);
    };
  }, []);

  if (!warning) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[999] flex items-center justify-center bg-black/90 text-center text-sm font-semibold text-white"
    >
      Impression désactivée sur ce contenu.
    </div>
  );
}
