"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  className?: string;
  label?: string;
}

export function BrandLoader({ className, label }: BrandLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div
        className={cn(
          "relative h-32 w-32 shrink-0 animate-pulse drop-shadow-[0_0_40px_rgba(20,184,166,0.5)]",
          className
        )}
      >
        {/* Two staggered expanding rings — same "neural node halo" language
            as AnimatedBrandMark (tailwind.config.ts's animate-ring-pulse),
            reused here so a route-level loading screen reads as the same
            brand identity rather than a generic spinner. Blurred so they
            read as a soft bloom behind the (transparent-background) logo
            PNG rather than a hard-edged shape peeking out from its corners,
            and kept at the exact same inset-0 box as the logo itself (no
            separate padding) so this degrades gracefully at every size this
            component is used at in the app — both the full h-32 hero use
            and the h-6 inline spinner use next to "Chargement du cours...".  */}
        <span aria-hidden className="absolute inset-0 rounded-full bg-gradient-to-br from-primary-500/40 to-secondary-500/40 blur-xl animate-ring-pulse" />
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-gradient-to-br from-primary-500/40 to-secondary-500/40 blur-xl animate-ring-pulse"
          style={{ animationDelay: "1.2s" }}
        />
        <Image src="/logo.png" alt="Chargement" fill sizes="128px" className="relative object-contain" />
      </div>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}