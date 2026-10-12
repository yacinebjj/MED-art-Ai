"use client";

import { motion } from "framer-motion";
import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZE_MAP = {
  sm: { box: "h-9 w-9", icon: "h-5 w-5", dot: "h-1 w-1" },
  md: { box: "h-14 w-14", icon: "h-7 w-7", dot: "h-1.5 w-1.5" },
  lg: { box: "h-20 w-20", icon: "h-10 w-10", dot: "h-2 w-2" },
} as const;

/**
 * "Medical cross intertwined with an AI neural node" brand mark — a
 * gradient stethoscope glyph with two expanding pulse rings (CSS
 * animate-ring-pulse, tailwind.config.ts) and two orbiting nodes (framer-
 * motion rotation). Used for the sidebar logo (sm, mostly static-feeling),
 * and full loading/empty states (lg, all motion active) — the same mark at
 * every size so it reads as one consistent identity, not a different logo
 * per context.
 */
export function AnimatedBrandMark({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = SIZE_MAP[size];

  return (
    <div className={cn("relative flex shrink-0 items-center justify-center", dims.box, className)}>
      <span className={cn("absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-500/50 to-violet-500/50 animate-ring-pulse")} />
      <span
        className={cn("absolute inset-0 rounded-2xl bg-gradient-to-br from-primary-500/50 to-violet-500/50 animate-ring-pulse")}
        style={{ animationDelay: "1.2s" }}
      />

      <motion.div
        className="absolute inset-0"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, ease: "linear", duration: 6 }}
        aria-hidden
      >
        <span className={cn("absolute left-1/2 top-0 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_8px_2px_rgba(34,211,238,0.7)]", dims.dot)} />
      </motion.div>
      <motion.div
        className="absolute inset-0"
        animate={{ rotate: -360 }}
        transition={{ repeat: Infinity, ease: "linear", duration: 8 }}
        aria-hidden
      >
        <span className={cn("absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full bg-violet-400 shadow-[0_0_6px_2px_rgba(167,139,250,0.7)]", dims.dot)} />
      </motion.div>

      <span
        className={cn(
          "relative z-10 flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-violet-600 text-white shadow-lg",
          dims.box
        )}
      >
        <Stethoscope className={dims.icon} />
      </span>
    </div>
  );
}
