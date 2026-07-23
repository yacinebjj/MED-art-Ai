"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 " +
    "disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-soft hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground shadow-soft hover:bg-secondary/80",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        danger:
          "bg-destructive text-destructive-foreground shadow-soft hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 rounded-lg px-3 text-sm",
        md: "h-10 rounded-xl px-4 text-sm",
        lg: "h-12 rounded-xl px-6 text-base",
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

type ConflictingMotionProps =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, ConflictingMotionProps>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, isLoading = false, disabled, children, ...props },
    ref
  ) => {
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size }), className)}
          {...(props as Record<string, unknown>)}
        >
          {children}
        </Slot>
      );
    }

    return (
      <motion.button
        ref={ref}
        whileHover={disabled || isLoading ? undefined : { scale: 1.02 }}
        whileTap={disabled || isLoading ? undefined : { scale: 0.97 }}
        transition={{ duration: 0.12 }}
        disabled={disabled || isLoading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
