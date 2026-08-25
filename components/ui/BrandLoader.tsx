"use client";

import Image from "next/image";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
        <Image src="/logo.png" alt="Chargement" fill sizes="128px" className="object-contain" />
      </div>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
    </div>
  );
}