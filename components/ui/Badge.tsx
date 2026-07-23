import { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        primary: "bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300",
        secondary:
          "bg-secondary-100 text-secondary-800 dark:bg-secondary-900/40 dark:text-secondary-300",
        neutral: "bg-muted text-muted-foreground",
        success:
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        danger: "bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-red-300",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
