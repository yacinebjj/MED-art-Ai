import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  className?: string;
  label?: string;
}

/**
 * Branded replacement for a generic `Loader2` spinner — a raw inline SVG
 * (no external file, no `next/image`), a stylized medical cross inside a
 * stethoscope loop, pulsing via Tailwind's built-in `animate-pulse`. Used at
 * the app's major loading moments (route-level Suspense fallbacks, full-page/
 * full-panel loading gates) — small inline button-spinners stay `Loader2` on
 * purpose, a pulsing brand mark would be visually oversized there.
 */
export function BrandLoader({ className, label }: BrandLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("h-12 w-12 text-primary animate-pulse", className)}
        role="img"
        aria-label="Chargement"
      >
        {/* Stethoscope loop */}
        <path
          d="M6 3v5a4 4 0 0 0 8 0V3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10 12v2a6 6 0 0 0 12 0v-2.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="21" cy="10.5" r="1.6" fill="currentColor" />
        {/* Medical cross */}
        <path
          d="M6 15h4m-2-2v4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="17" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}
