"use client";

import { useDragControls, type MotionProps } from "framer-motion";
import type { PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const SHEET_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Motion props for a panel that is a bottom sheet below `sm` and a docked
 * side panel above it. On phones: slides up from the bottom edge and can be
 * dragged down to dismiss — but ONLY from the handle (`dragListener: false`),
 * so dragging inside the sheet still scrolls its content normally.
 */
export function useBottomSheetMotion(onClose: () => void) {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const dragControls = useDragControls();

  const sheetProps: MotionProps = isMobile
    ? {
        initial: { y: "100%" },
        animate: { y: 0 },
        exit: { y: "100%" },
        transition: { type: "tween", duration: 0.32, ease: SHEET_EASE },
        drag: "y",
        dragControls,
        dragListener: false,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 1 },
        onDragEnd: (_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose();
        },
      }
    : {
        initial: { opacity: 0, y: 24 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 24 },
        transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] },
      };

  return {
    sheetProps,
    startDrag: (event: ReactPointerEvent) => dragControls.start(event),
  };
}

/** Grab handle for useBottomSheetMotion — phones only, full sheet width. Pass negative margins via className inside a padded sheet. */
export function BottomSheetHandle({
  onPointerDown,
  className,
}: {
  onPointerDown: (event: ReactPointerEvent) => void;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      onPointerDown={onPointerDown}
      className={cn("flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing sm:hidden", className)}
    >
      <span className="h-1.5 w-12 rounded-full bg-zinc-300 dark:bg-zinc-700" />
    </div>
  );
}
