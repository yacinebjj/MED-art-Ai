"use client";

import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const Progress = forwardRef<
  ElementRef<typeof ProgressPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    {...props}
  >
    <motion.div
      className="h-full rounded-full bg-gradient-to-r from-primary-500 to-secondary-500"
      initial={{ width: 0 }}
      animate={{ width: `${value ?? 0}%` }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;
