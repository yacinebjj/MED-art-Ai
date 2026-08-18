"use client";

import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

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
 */
export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { overlayClassName?: string; onOverlayClick?: () => void }
>(({ className, overlayClassName, onOverlayClick, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    {/* Radix's own DismissableLayer already closes on outside pointerdown by
        default (every other caller of this component relies on that, purely
        via `open`/`onOpenChange` on <Dialog>) — `onOverlayClick` is an
        additional, explicit, opt-in handler for callers (e.g.
        FileViewerModal) that want the "click the blurred background to
        close" behavior spelled out literally rather than implicit. Purely
        additive: omitted by every other Dialog user, so their behavior is
        byte-for-byte unchanged. */}
    <DialogOverlay className={overlayClassName} onClick={onOverlayClick} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
        "rounded-2xl border border-border bg-card p-6 shadow-card focus:outline-none",
        className
      )}
      {...props}
    >
      {/* Purely for the spring entrance — deliberately unstyled otherwise
          (no width/border/padding here) so it never fights the sizing/chrome
          classes callers pass via `className` above, which stay on Content
          itself exactly as before this animation was added. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        {children}
      </motion.div>
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-4 w-4" />
        <span className="sr-only">Fermer</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
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
