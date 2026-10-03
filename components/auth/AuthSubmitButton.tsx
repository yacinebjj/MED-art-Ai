"use client";

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Animated ECG trace — the loading state of the auth buttons. CSS-only (stroke-dashoffset), compositor-friendly. */
export function EcgLoader({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 24" className={cn("h-6 w-28", className)} aria-hidden>
      <path
        d="M0 12 H34 L40 12 L44 4 L50 20 L55 0 L60 24 L64 12 L72 12 L76 9 L80 12 H120"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        className="[stroke-dasharray:28_100] motion-safe:animate-[ecg_1.15s_linear_infinite]"
      />
      <style>{"@keyframes ecg{from{stroke-dashoffset:128}to{stroke-dashoffset:0}}"}</style>
    </svg>
  );
}

/** Large primary action with a light sweep on hover; turns into a live ECG while loading. */
export function AuthSubmitButton({ children, isLoading, loadingLabel, disabled }: { children: ReactNode; isLoading: boolean; loadingLabel: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={isLoading || disabled}
      aria-busy={isLoading}
      className="group relative flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 text-base font-black text-slate-950 shadow-[0_0_30px_rgba(34,211,238,0.35)] transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_45px_rgba(34,211,238,0.6)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-80"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/60 to-transparent opacity-0 transition-[transform,opacity] duration-700 group-hover:translate-x-[300%] group-hover:opacity-100"
      />
      {isLoading ? (
        <>
          <EcgLoader />
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : (
        <>
          <span className="relative">{children}</span>
          <ArrowRight className="relative h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
        </>
      )}
    </button>
  );
}
