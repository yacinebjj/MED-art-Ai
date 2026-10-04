"use client";

import "./cyber.css";
import { forwardRef, useId, type CSSProperties, type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useCyberTilt } from "./hooks";

export type CyberAccent = "cyan" | "violet" | "amber" | "emerald" | "rose";

/** Glow pairs per accent — [ambient A, ambient B, laser A, laser B]. */
const ACCENTS: Record<CyberAccent, [string, string, string, string]> = {
  cyan: ["rgb(34 211 238 / 0.16)", "rgb(139 92 246 / 0.16)", "rgb(34 211 238 / 0.95)", "rgb(139 92 246 / 0.9)"],
  violet: ["rgb(139 92 246 / 0.2)", "rgb(34 211 238 / 0.12)", "rgb(167 139 250 / 0.95)", "rgb(34 211 238 / 0.85)"],
  amber: ["rgb(245 158 11 / 0.16)", "rgb(244 63 94 / 0.12)", "rgb(251 191 36 / 0.95)", "rgb(244 63 94 / 0.85)"],
  emerald: ["rgb(16 185 129 / 0.16)", "rgb(34 211 238 / 0.12)", "rgb(52 211 153 / 0.95)", "rgb(34 211 238 / 0.85)"],
  rose: ["rgb(244 63 94 / 0.16)", "rgb(139 92 246 / 0.14)", "rgb(251 113 133 / 0.95)", "rgb(139 92 246 / 0.85)"],
};

export function accentVars(accent: CyberAccent): CSSProperties {
  const [a, b, la, lb] = ACCENTS[accent];
  return { "--cyber-glow-a": a, "--cyber-glow-b": b, "--cyber-laser-a": la, "--cyber-laser-b": lb } as CSSProperties;
}

/**
 * The abyssal dark canvas a page lives on. It is a `.dark` SUBTREE — every
 * token-based component inside (Button, Checkbox, Dialog content passed
 * through, …) resolves to its dark values — while the shell chrome and the
 * dashboard home keep the student's own theme untouched.
 */
export function CyberStage({
  accent = "cyan",
  className,
  style,
  children,
}: {
  accent?: CyberAccent;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cn("dark cyber-stage rounded-[1.75rem] text-foreground", className)} style={{ ...accentVars(accent), ...style }}>
      {children}
    </div>
  );
}

interface CyberPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Neon laser ring around the panel. `spin` animates it (desktop only, see cyber.css). */
  laser?: boolean | "spin";
  /** Desktop-only 3D micro-tilt + cursor reflection. */
  tilt?: number;
  hover?: boolean;
  accent?: CyberAccent;
}

/** Glass surface with optional laser border, tilt and hover glow. */
export const CyberPanel = forwardRef<HTMLDivElement, CyberPanelProps>(function CyberPanel(
  { laser = false, tilt, hover = false, accent, className, style, children, ...props },
  forwardedRef
) {
  const tiltRef = useCyberTilt<HTMLDivElement>(tilt ?? 0);
  const ref = tilt ? tiltRef : forwardedRef;
  return (
    <div
      ref={ref}
      className={cn("cyber-glass rounded-3xl", hover && "cyber-glass-hover", tilt && "cyber-tilt", className)}
      style={accent ? { ...accentVars(accent), ...style } : style}
      {...props}
    >
      {tilt ? <span aria-hidden className="cyber-reflect" /> : null}
      {children}
      {laser ? <span aria-hidden className="cyber-laser" data-spin={laser === "spin" ? "true" : undefined} /> : null}
    </div>
  );
});

/** Page header: neon icon chip, gradient title, subtitle, actions on the right. */
export function CyberHeader({
  icon: Icon,
  kicker,
  title,
  subtitle,
  actions,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  kicker?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-violet-600 text-white shadow-[0_0_28px_rgba(34,211,238,0.45)]">
          <span aria-hidden className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/25" />
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          {kicker && <p className="cyber-kicker">{kicker}</p>}
          <h1 className="cyber-title truncate text-xl font-black tracking-tight sm:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400 sm:text-sm">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Rounded SVG coordinate — identical on server and client (avoids float hydration mismatches). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Glowing circular progress. `value` is a real 0..1 ratio from the caller —
 * renders an empty track (never a fake fill) when it is 0.
 */
export function NeonRing({
  value,
  size = 120,
  stroke = 10,
  from = "#22d3ee",
  to = "#8b5cf6",
  ticks = 0,
  glow = true,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  from?: string;
  to?: string;
  /** Cockpit-style graduation marks around the dial. */
  ticks?: number;
  glow?: boolean;
  className?: string;
  children?: ReactNode;
  "aria-label"?: string;
}) {
  const gradientId = useId();
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const radius = (size - stroke) / 2 - (ticks > 0 ? 8 : 0);
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <div
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        {ticks > 0 &&
          Array.from({ length: ticks }, (_, i) => {
            const angle = (i / ticks) * Math.PI * 2;
            const major = i % 5 === 0;
            const r1 = size / 2 - 1;
            const r2 = r1 - (major ? 7 : 4);
            return (
              <line
                key={i}
                x1={round2(center + Math.cos(angle) * r1)}
                y1={round2(center + Math.sin(angle) * r1)}
                x2={round2(center + Math.cos(angle) * r2)}
                y2={round2(center + Math.sin(angle) * r2)}
                stroke={i / ticks <= clamped ? from : "rgb(148 163 184 / 0.25)"}
                strokeWidth={major ? 2 : 1}
                strokeLinecap="round"
              />
            );
          })}
        <circle cx={center} cy={center} r={radius} fill="none" strokeWidth={stroke} stroke="rgb(148 163 184 / 0.12)" />
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={`url(#${gradientId})`}
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - clamped) }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={glow && clamped > 0 ? { filter: `drop-shadow(0 0 6px ${from})` } : undefined}
        />
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">{children}</div>}
    </div>
  );
}

/**
 * One-shot micro-particle burst + ripple. Re-key with a new `nonce` to fire
 * again; `nonce` 0 renders nothing. Hidden under reduced motion (cyber.css).
 */
export function ParticleBurst({ nonce, color = "rgb(34 211 238)", count = 10, spread = 46 }: { nonce: number; color?: string; count?: number; spread?: number }) {
  if (nonce === 0) return null;
  return (
    <span key={nonce} aria-hidden className="pointer-events-none absolute inset-0 overflow-visible" style={{ "--cyber-particle": color } as CSSProperties}>
      <span className="cyber-ripple" />
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const distance = spread * (0.7 + (i % 3) * 0.2);
        return (
          <span
            key={i}
            className="cyber-particle"
            style={{ "--dx": `${Math.cos(angle) * distance}px`, "--dy": `${Math.sin(angle) * distance}px` } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  count?: number;
}

/** Pill switch with a shared-layout glowing indicator. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
  ariaLabel,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const layoutId = useId();
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("cyber-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1", className)}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60",
              size === "sm" ? "min-h-9 px-2 text-xs" : "min-h-11 px-4 text-sm",
              active ? "text-slate-950" : "text-slate-400 hover:text-white"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 shadow-[0_0_22px_rgba(34,211,238,0.45)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {Icon && <Icon className="h-4 w-4" />}
              {option.label}
              {typeof option.count === "number" && (
                <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-slate-950/15" : "bg-white/10")}>{option.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Small stat tile: label, big value, optional hint and accent bar. */
export function CyberStat({
  label,
  value,
  hint,
  icon: Icon,
  tone = "cyan",
  ratio,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: CyberAccent;
  /** Optional 0..1 fill for the bottom bar. */
  ratio?: number;
}) {
  const toneClass: Record<CyberAccent, string> = {
    cyan: "text-cyan-300 from-cyan-400 to-sky-500",
    violet: "text-violet-300 from-violet-400 to-fuchsia-500",
    amber: "text-amber-300 from-amber-400 to-orange-500",
    emerald: "text-emerald-300 from-emerald-400 to-teal-500",
    rose: "text-rose-300 from-rose-400 to-pink-500",
  };
  const [textTone] = toneClass[tone].split(" ");
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
        {Icon && <Icon className={cn("h-3.5 w-3.5", textTone)} />}
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-black tabular-nums text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
      {typeof ratio === "number" && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className={cn("h-full rounded-full bg-gradient-to-r", toneClass[tone].split(" ").slice(1).join(" "))}
            initial={false}
            animate={{ width: `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      )}
    </div>
  );
}
