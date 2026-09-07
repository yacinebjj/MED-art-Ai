"use client";

import { HTMLAttributes } from "react";
import { motion } from "framer-motion";

// Same conflict (and same fix) as components/ui/MotionCard.tsx: React's DOM
// event handler types for these props don't structurally match framer-
// motion's own handler signatures for the same prop names.
type ConflictingMotionProps =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

interface RevealSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, ConflictingMotionProps> {
  delay?: number;
}

/**
 * Small "use client" wrapper (same pattern as MotionCard.tsx) so pages that
 * use it — like app/page.tsx — can stay Server Components themselves,
 * rather than the whole page needing "use client" just to use framer-motion.
 * `whileInView` + `viewport={{ once: true }}` is the real mechanism behind
 * "elements gracefully appear as the user scrolls" — plain Tailwind
 * `animate-in` classes alone only fire once on mount, not per-section as it
 * scrolls into view, since they have no notion of viewport intersection
 * without JS driving a class toggle. This IS that JS, via a library already
 * a dependency here, not a hand-rolled IntersectionObserver.
 */
export function RevealSection({ className, delay = 0, children, ...props }: RevealSectionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
