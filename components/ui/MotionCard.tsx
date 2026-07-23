"use client";

import { HTMLAttributes } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type ConflictingMotionProps =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

interface MotionCardProps extends Omit<HTMLAttributes<HTMLDivElement>, ConflictingMotionProps> {
  lift?: boolean;
}

export function MotionCard({ className, lift = true, children, ...props }: MotionCardProps) {
  return (
    <motion.div
      whileHover={lift ? { y: -4 } : undefined}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "rounded-2xl border border-border bg-card text-card-foreground shadow-card transition-shadow duration-200 hover:shadow-glow",
        className
      )}
      {...props}
    >
      {children}
    </motion.div>
  );
}
