"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal, TiltCard } from "../primitives";

/** One glass tile of the arsenal grid: icon, title, pitch, and a live mini-UI. */
export function BentoTile({
  icon: Icon,
  title,
  pitch,
  tint,
  badge,
  children,
  className,
  delay = 0,
}: {
  icon: LucideIcon;
  title: string;
  pitch: string;
  /** Gradient classes for the icon chip and the hover aura, e.g. "from-cyan-400 to-blue-600". */
  tint: string;
  badge?: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={cn("h-full", className)}>
      <TiltCard max={4} className="h-full rounded-3xl">
        <div className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.015] p-5 backdrop-blur-xl transition-colors duration-300 hover:border-white/20 sm:p-6">
          <div aria-hidden className={cn("pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-gradient-to-br opacity-20 blur-3xl transition-opacity duration-500 group-hover:opacity-40", tint)} />
          <div className="relative flex items-start gap-3">
            <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg", tint)}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-extrabold tracking-tight text-white">{title}</h3>
                {badge && <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">{badge}</span>}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{pitch}</p>
            </div>
          </div>
          <div className="relative mt-5 flex-1">{children}</div>
        </div>
      </TiltCard>
    </Reveal>
  );
}
