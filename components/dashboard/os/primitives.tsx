"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks of the Medical OS dashboard widgets: a glass card
 * with an icon header, a radial gauge, a skeleton, and a client-only clock.
 */

export const CARD_ENTRANCE = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
} as const;

export function OsCard({
  icon: Icon,
  iconClassName,
  title,
  action,
  children,
  className,
  glow,
}: {
  icon: LucideIcon;
  /** Gradient classes for the icon chip, e.g. "from-orange-500 to-amber-500". */
  iconClassName: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Hover glow tint (literal class), e.g. "hover:shadow-orange-500/15". */
  glow?: string;
}) {
  return (
    <motion.section
      variants={CARD_ENTRANCE}
      className={cn(
        "glass-card group/card relative flex flex-col overflow-hidden rounded-3xl border border-white/30 p-4 shadow-glass transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl dark:border-white/[0.06] dark:shadow-glass-dark sm:p-5",
        glow,
        className
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-white/40 to-transparent opacity-0 blur-2xl transition-opacity duration-500 group-hover/card:opacity-100 dark:from-white/10" />
      <header className="relative mb-3 flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", iconClassName)}>
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight text-foreground">{title}</h3>
        {action}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </motion.section>
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
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-[color-mix(in_oklab,var(--muted)_80%,transparent)]", className)} />;
}

export function WidgetSkeleton() {
  return (
    <div className="glass-card flex min-h-[200px] flex-col gap-3 rounded-3xl p-5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
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
