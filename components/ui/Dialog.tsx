"use client";

import { ComponentPropsWithoutRef, ElementRef, forwardRef, useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/40 backdrop-blur-md", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Swipe-down-to-dismiss thresholds for the mobile sheet.
const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The spring entrance lives on a NESTED motion.div, not on
 * DialogPrimitive.Content itself: Framer Motion's animated x/y/scale compile
 * to a single inline `transform`, which would silently clobber the
 * `-translate-x-1/2 -translate-y-1/2` Tailwind classes Content uses for
 * centering (inline style always wins over a class targeting the same
 * property) — nesting keeps Content's centering transform and the motion
 * div's spring transform on two separate elements so neither overwrites the
 * other. Entrance-only (no `exit`/AnimatePresence): Radix mounts Content
 * fresh on every open, which is all `initial` -> `animate` needs to replay
 * the spring each time; the close transition is an instant unmount, same as
 * before this change.
 *
 * Below `sm` (unless `sheetOnMobile={false}`) Content is a bottom sheet
 * instead. Its layout comes from `max-sm:` classes, not JS, so it never
 * flashes centered first; the swipe gesture writes Content's inline
 * transform directly, which is safe because the sheet has no centering
 * transform to clobber.
 */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    overlayClassName?: string;
    onOverlayClick?: () => void;
    /** Off for callers that are already full-screen (FileViewerModal). */
    sheetOnMobile?: boolean;
  }
>(({ className, overlayClassName, onOverlayClick, sheetOnMobile = true, children, ...props }, forwardedRef) => {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isSheet = sheetOnMobile && isMobile;

  const contentRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ startY: number; lastY: number; lastTime: number; velocity: number } | null>(null);

  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef]
  );

  function handleSheetPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Throws if the pointer was already released (very quick taps) — the drag still works uncaptured.
    }
    dragRef.current = { startY: event.clientY, lastY: event.clientY, lastTime: performance.now(), velocity: 0 };
    if (contentRef.current) contentRef.current.style.transition = "none";
    if (overlayRef.current) overlayRef.current.style.transition = "none";
  }

  function handleSheetPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !contentRef.current) return;
    const now = performance.now();
    drag.velocity = (event.clientY - drag.lastY) / Math.max(1, now - drag.lastTime);
    drag.lastY = event.clientY;
    drag.lastTime = now;
    const offset = Math.max(0, event.clientY - drag.startY);
    contentRef.current.style.transform = `translate3d(0, ${offset}px, 0)`;
    if (overlayRef.current) overlayRef.current.style.opacity = String(1 - Math.min(0.9, offset / 400));
  }

  function handleSheetPointerEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    const content = contentRef.current;
    if (!drag || !content) return;

    const offset = Math.max(0, drag.lastY - drag.startY);
    // A finger that paused before lifting isn't a flick.
    const releaseVelocity = performance.now() - drag.lastTime > 100 ? 0 : drag.velocity;
    content.style.transition = `transform 240ms ${SHEET_EASE}`;
    if (overlayRef.current) overlayRef.current.style.transition = "opacity 240ms ease-out";

    if (offset > DISMISS_DISTANCE_PX || releaseVelocity > DISMISS_VELOCITY_PX_PER_MS) {
      content.style.transform = "translate3d(0, 100%, 0)";
      if (overlayRef.current) overlayRef.current.style.opacity = "0";
      window.setTimeout(() => closeRef.current?.click(), 200);
      return;
    }
    content.style.transform = "";
    if (overlayRef.current) overlayRef.current.style.opacity = "";
  }

  return (
    <DialogPrimitive.Portal>
      {/* Radix's own DismissableLayer already closes on outside pointerdown by
          default (every other caller of this component relies on that, purely
          via `open`/`onOpenChange` on <Dialog>) — `onOverlayClick` is an
          additional, explicit, opt-in handler for callers (e.g.
          FileViewerModal) that want the "click the blurred background to
          close" behavior spelled out literally rather than implicit. Purely
          additive: omitted by every other Dialog user, so their behavior is
          byte-for-byte unchanged. */}
      <DialogOverlay ref={overlayRef} className={overlayClassName} onClick={onOverlayClick} />
      <DialogPrimitive.Content
        ref={setContentRef}
        className={cn(
          // w-[calc(100%-2rem)] instead of w-full: on a narrow phone, `w-full`
          // resolves against the viewport (this is `fixed`), so the dialog
          // touched both screen edges with zero breathing room before
          // max-w-lg ever kicked in. This guarantees a 1rem gutter on each
          // side no matter how narrow the screen gets.
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg max-h-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain",
          "rounded-2xl border border-border bg-card p-6 shadow-card focus:outline-none",
          sheetOnMobile &&
            "sheet-enter max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:max-h-[92dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[1.75rem] max-sm:border-x-0 max-sm:border-b-0",
          className
        )}
        {...props}
      >
        {/* Mostly unstyled (no width/border/padding here) so it never fights
            the sizing/chrome classes callers pass via `className` above,
            which stay on Content itself exactly as before this animation was
            added. `flex h-full min-h-0 flex-col` is the one addition: it lets
            a caller's own flex-height content (e.g. FileViewerModal's
            full-screen layout) actually stretch to fill Content — without it,
            this div's height falls back to fitting its children instead of
            Content's explicit height. It's a no-op for every other caller,
            since Content only has an explicit height when the caller sets
            one; otherwise Content sizes to content and percentage heights
            here just resolve to auto. */}
        <motion.div
          className="flex h-full min-h-0 flex-col"
          initial={isSheet ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8 }}
          animate={isSheet ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          transition={isSheet ? { duration: 0.2 } : { type: "spring", stiffness: 300, damping: 30 }}
        >
          {children}
        </motion.div>
        {sheetOnMobile && <div aria-hidden className="h-[env(safe-area-inset-bottom)] shrink-0 sm:hidden" />}
        {sheetOnMobile && (
          // Centered and narrower than the sheet so it never covers the close button.
          <div
            aria-hidden
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerEnd}
            onPointerCancel={handleSheetPointerEnd}
            className="absolute left-1/2 top-0 flex h-7 w-32 -translate-x-1/2 cursor-grab touch-none items-start justify-center pt-2.5 active:cursor-grabbing sm:hidden"
          >
            <span className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
          </div>
        )}
        <DialogPrimitive.Close
          ref={closeRef}
          className="touch-target absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Fermer</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4", className)} {...props} />;
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("mt-1 text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
