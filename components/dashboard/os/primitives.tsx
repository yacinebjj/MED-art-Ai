"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Cascade, CascadeDelayProvider, useCascade, useEnclosingCascadeDelay } from "@/components/layout/Cascade";

/**
 * Shared building blocks of the Medical OS dashboard widgets: a glass card
 * with an icon header, a radial gauge, a skeleton, a client-only clock — and
 * the beats of the home page's entrance.
 */

/**
 * The home page's entrance (components/layout/Cascade.tsx): when it appears —
 * on arrival, and every time the student comes back to it — each block rises
 * in on its own beat, in ms, top to bottom, the way the eye reads it. A block
 * whose data comes later rises the moment it arrives.
 */
export const HOME_CASCADE = {
  greeting: 0,
  quickLaunchHeading: 70,
  resume: 120,
  /** + TILE_STEP per tile. */
  labTiles: 170,
  curriculumHeading: 260,
  /** The unit toolbar, or the empty / error / no-year state. */
  curriculumBody: 310,
  curriculumChips: 340,
  /** + MODULE_STEP per card (the first ten; the others come with the tenth). */
  moduleCards: 380,
  analyticsHeading: 480,
  /** + WIDGET_STEP per widget. */
  analyticsWidgets: 520,
} as const;

export const TILE_STEP = 40;
export const MODULE_STEP = 40;
export const WIDGET_STEP = 45;

export function OsCard({
  icon: Icon,
  iconClassName,
  title,
  action,
  children,
  className,
  glow,
  cascadeIndex,
}: {
  icon: LucideIcon;
  /** Gradient classes for the icon chip, e.g. "from-orange-500 to-amber-500". */
  iconClassName: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Hover glow tint (literal class, real-hover devices only), e.g. "[@media(hover:hover)]:hover:shadow-orange-500/15". */
  glow?: string;
  /** Its place among the home's widgets: they rise in one after another (HOME_CASCADE.analyticsWidgets). */
  cascadeIndex: number;
}) {
  const cascade = useCascade(HOME_CASCADE.analyticsWidgets, cascadeIndex, WIDGET_STEP);
  return (
    <section
      style={cascade.style}
      className={cn(
        cascade.className,
        "glass-card group/card relative isolate flex flex-col overflow-hidden rounded-3xl border border-white/30 p-4 shadow-glass transition-[transform,box-shadow] duration-300 dark:border-white/[0.06] dark:shadow-glass-dark sm:p-5 [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:shadow-xl",
        glow,
        className
      )}
    >
      {/* Hover sheen in its own clip layer, cut to the inner corner radius: a blurred child spills past `overflow-hidden` + rounded corners on mobile. Real hover only. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[calc(1.5rem-1px)] [clip-path:inset(0_round_calc(1.5rem-1px))]">
        <span className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-white/40 to-transparent opacity-0 blur-2xl transition-opacity duration-500 dark:from-white/10 [@media(hover:hover)]:group-hover/card:opacity-100" />
      </span>
      <header className="relative mb-3 flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", iconClassName)}>
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight text-foreground">{title}</h3>
        {action}
      </header>
      <CascadeDelayProvider value={cascade.delay}>
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
      </CascadeDelayProvider>
    </section>
  );
}

export function RadialGauge({
  value,
  size = 84,
  stroke = 9,
  className,
  trackClassName = "stroke-muted",
  gradient,
  children,
}: {
  /** 0-100, or null for "no data" (empty ring). */
  value: number | null;
  size?: number;
  stroke?: number;
  className?: string;
  trackClassName?: string;
  /** Two colors for the arc's linear gradient. */
  gradient: [string, string];
  children?: ReactNode;
}) {
  // The arc draws itself as its card arrives (framer animates the SVG attribute; the card's own entrance is CSS).
  const delayMs = useEnclosingCascadeDelay();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const id = `gauge-${gradient[0].replace(/[^a-z0-9]/gi, "")}-${gradient[1].replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={gradient[0]} />
            <stop offset="100%" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={trackClassName} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={`url(#${id})`}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct / 100) }}
          transition={{ duration: 0.9, delay: delayMs / 1000, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-[color-mix(in_oklab,var(--muted)_80%,transparent)]", className)} />;
}

/** A widget's place while its data loads — it rises on the widget's own beat (`cascadeIndex`, as OsCard). */
export function WidgetSkeleton({ cascadeIndex }: { cascadeIndex: number }) {
  return (
    <Cascade at={HOME_CASCADE.analyticsWidgets} index={cascadeIndex} step={WIDGET_STEP} className="glass-card flex min-h-[200px] flex-col gap-3 rounded-3xl p-5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </Cascade>
  );
}

/**
 * Current time, CLIENT-ONLY (null during SSR and the first client render, so
 * nothing time-dependent can cause a hydration mismatch), re-read every
 * `intervalMs`.
 */
export function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}
