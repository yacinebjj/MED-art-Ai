import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  className?: string;
  label?: string;
}

/**
 * Branded loading indicator — public/logo.png with a slow pulse/glow, used
 * at the app's major loading moments (route-level Suspense fallbacks,
 * full-page/full-panel loading gates). Default size is intentionally
 * large (it must dominate a loading screen) — callers that need a small
 * inline version override via `className`, passing a matching `h-* w-*`
 * pair (bare, no responsive prefix, so twMerge actually replaces the
 * default instead of leaving it stacked alongside it).
 *
 * No cropping: `object-contain` shows the full logo.png, wordmark
 * included — nothing is clipped by the container.
 */
export function BrandLoader({ className, label }: BrandLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div
        className={cn(
          "relative h-32 w-32 shrink-0 animate-pulse drop-shadow-[0_0_40px_rgba(20,184,166,0.5)]",
          className
        )}
      >
        <Image src="/logo.png" alt="Chargement" fill sizes="128px" className="object-contain" />
      </div>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}
