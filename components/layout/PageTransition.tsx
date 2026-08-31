"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * Wrapped in AnimatePresence (mode="wait") so a route change plays a real
 * exit-then-enter sequence instead of a hard swap — the old page's content
 * fades/slides out fully before the new one fades in, which is what avoids
 * the "flash of blank/jumping content" a plain unmount+mount produces. Kept
 * to `mode="wait"` rather than a crossfade specifically because sibling
 * pages in this shell can have very different heights — overlapping their
 * enter/exit would stack both in flow at once and visibly jump the layout,
 * which is worse than the brief moment of empty space `wait` produces.
 */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
