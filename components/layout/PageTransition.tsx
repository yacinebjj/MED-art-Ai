"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * ENTER-ONLY page transition: the new route mounts IMMEDIATELY and fades in.
 *
 * This used to be `<AnimatePresence mode="wait">` (exit the old page fully,
 * THEN mount the new one). With the App Router that is a navigation hazard:
 * the new segment is held back until the old one's exit animation reports
 * completion, and an exit animation can stall — animation frames are
 * throttled or paused while an installed PWA / standalone window isn't in
 * the foreground, and App Router children swapped under an exiting
 * AnimatePresence child are a known source of stuck transitions. The result
 * was the "click → nothing happens until F5" freeze in the installed app.
 * No exit phase means nothing can ever block the router: the click shows
 * the new page (or its loading.tsx skeleton) on the very next frame.
 *
 * `page-reveal` (app/globals.css): on top of this glide, the page's own
 * top-level sections rise in one after another.
 */
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      key={pathname}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={cn("page-reveal", className)}
    >
      {children}
    </motion.div>
  );
}
