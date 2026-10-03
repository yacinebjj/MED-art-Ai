import { cn } from "@/lib/utils";

/**
 * Keyboard-shortcut badge. `inverse` is for use inside a Tooltip, whose
 * surface is dark in light mode and light in dark mode (components/ui/
 * Tooltip.tsx), so the badge stays legible on both.
 */
export function Kbd({ children, tone = "default", className }: { children: React.ReactNode; tone?: "default" | "inverse"; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border px-1 font-sans text-[10px] font-semibold leading-none tracking-wide",
        tone === "default"
          ? "border-border bg-muted text-muted-foreground shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)] dark:shadow-[inset_0_-1px_0_rgb(255_255_255/0.06)]"
          : "border-white/20 bg-white/10 text-white/90 dark:border-slate-900/15 dark:bg-slate-900/10 dark:text-slate-700",
        className
      )}
    >
      {children}
    </kbd>
  );
}
