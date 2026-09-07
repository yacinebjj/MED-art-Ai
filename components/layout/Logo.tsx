import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** "light" adds a small translucent backing chip behind the mark — used
   * only on AuthLayout's dark gradient panel, where the logo's own dark
   * teal/cyan tones could lose contrast against a similarly dark backdrop
   * without it. */
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZE_CLASSES: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
  xl: "h-28 w-28 md:h-36 md:w-36",
};

/**
 * Med Art AI's brand mark — public/logo.png, replacing the old hand-drawn
 * "Stethoscope icon + 'Med Art AI' text" lockup everywhere it appeared
 * (Sidebar, Navbar, Auth pages, Footer, WorkspaceTopbar each had their own
 * separately-coded copy of that same lockup — all now point at this one
 * component instead of duplicating it).
 *
 * No cropping: `object-contain` inside a fixed-size box shows the full
 * source image (including the "MedArt.ai" wordmark) with no clipping,
 * letterboxing on whichever axis the 332x431 source doesn't fill exactly.
 */
export function Logo({ className, variant = "default", size = "md" }: LogoProps) {
  const isLight = variant === "light";
  return (
    <div className={cn("flex items-center", className)}>
      <div
        className={cn(
          "relative shrink-0",
          SIZE_CLASSES[size],
          isLight && "rounded-xl bg-white/10 p-1.5 backdrop-blur-sm"
        )}
      >
        <Image src="/logo.png" alt="Med Art AI" fill sizes="144px" className="object-contain" priority />
      </div>
    </div>
  );
}
