"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FullscreenViewerModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  contentClassName?: string;
}

/**
 * A TRUE fullscreen modal — rendered via a React portal directly under
 * <body>, deliberately NOT nested anywhere inside the page's own component
 * tree. This isn't belt-and-suspenders, it's the actual fix for a real bug:
 * several ancestor panels in this app (anything `.glass-card`/`.glass-panel`
 * -classed — see app/globals.css) set `backdrop-filter`, and per the CSS
 * spec, `backdrop-filter` (like `filter`/`transform`/`perspective`) makes
 * that ancestor the CONTAINING BLOCK for any `position: fixed` DESCENDANT.
 * A `fixed inset-0` div nested inside one of those panels only fills THAT
 * PANEL's own box, not the true screen — which is exactly what made the
 * previous non-portaled "fullscreen" implementation leave the mobile
 * Sources/Résultats tab bar and the "Mes Examens"/history list still
 * visible underneath it. A portal escapes every ancestor's containing
 * block unconditionally, so this is always truly viewport-fixed no matter
 * what CSS any parent panel applies, now or in the future.
 */
export function FullscreenViewerModal({ open, onClose, title, children, contentClassName }: FullscreenViewerModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    // Locks the page behind it from scrolling while open — otherwise a
    // touch-scroll starting on the modal could bleed through to the
    // (invisible, but still present) page underneath.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // z-[100] — deliberately above every other fixed layer in the app
    // (MobileBottomNav and WorkspaceTopbar/glass-panel chrome sit at z-40,
    // the exam page's own "Afficher la correction" progress bar is bumped
    // to z-[110] specifically to still float above this). bg-background —
    // the app's real, solid, semantic background token (see
    // app/globals.css), not a guessed hex value: pure white in light mode,
    // near-black in dark, always fully opaque (no blur/transparency),
    // exactly like the note editor's own proven fullscreen Card.
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <h2 className="min-w-0 flex-1 truncate text-base font-bold text-foreground">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          title="Fermer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom))]", contentClassName)}>
        {children}
      </div>
    </div>,
    document.body
  );
}
