"use client";

import { useId, type HTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Paramètres' visual kit (app/dashboard/(shell)/settings/page.tsx and
 * components/settings/SettingsSections.tsx): grouped cards in the Apple /
 * Stripe manner — a quiet surface, hairline-separated rows, the label and
 * its help on the left, the control on the right (stacked on phones).
 * Theme-aware through dark: variants (light, dark and night alike). Sizes
 * are in rem where app/globals.css's phone type scale would otherwise lift
 * a px or named size.
 */

/** A section's title and one line saying what it holds. */
export function SettingsSectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[1.25rem] font-semibold tracking-[-0.015em] text-slate-900 dark:text-white">{title}</h2>
      {description && <p className="mt-1 text-[0.875rem] leading-relaxed text-slate-500 dark:text-white/50">{description}</p>}
    </div>
  );
}

interface SettingsCardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  icon?: LucideIcon;
  title?: string;
  description?: ReactNode;
  /** Actions bar along the card's bottom edge (Save…), right-aligned from sm. */
  footer?: ReactNode;
  tone?: "default" | "danger";
}

/** One group of settings. */
export function SettingsCard({ icon: Icon, title, description, footer, tone = "default", className, children, ...props }: SettingsCardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-18px_rgba(15,23,42,0.22)] dark:bg-white/[0.035] dark:shadow-none md:backdrop-blur-xl",
        tone === "danger" ? "border-rose-500/25 dark:border-rose-400/20" : "border-black/[0.06] dark:border-white/[0.08]",
        className
      )}
      {...props}
    >
      {(title || description) && (
        <header className="flex items-start gap-3 px-5 pt-5 sm:px-6">
          {Icon && (
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                tone === "danger" ? "bg-rose-500/10 text-rose-600 dark:bg-rose-400/10 dark:text-rose-300" : "bg-sky-500/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300"
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            {title && <h3 className="text-[0.9375rem] font-semibold text-slate-900 dark:text-white">{title}</h3>}
            {description && <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-slate-500 dark:text-white/50">{description}</p>}
          </div>
        </header>
      )}
      {children}
      {footer && (
        <footer className="flex flex-col-reverse gap-3 border-t border-black/[0.05] bg-slate-50/70 px-5 py-3.5 dark:border-white/[0.06] dark:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Free-form content under a card's header. */
export function SettingsCardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 pb-5 pt-4 sm:px-6", className)}>{children}</div>;
}

/** Hairline-separated rows under a card's header. */
export function SettingsRows({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mt-4 divide-y divide-black/[0.05] border-t border-black/[0.05] dark:divide-white/[0.06] dark:border-white/[0.06]", className)}>{children}</div>;
}

/** One setting: label and help on the left, its control on the right (below it on phones). */
export function SettingsRow({
  label,
  description,
  htmlFor,
  aside,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The control's id, so a click on the label focuses it. */
  htmlFor?: string;
  /** A small badge next to the label (e.g. LockedBadge). */
  aside?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const labelClass = "text-[0.875rem] font-medium text-slate-900 dark:text-white/90";
  return (
    <div className={cn("flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:px-6", className)}>
      <div className="min-w-0 sm:max-w-[45%]">
        <div className="flex flex-wrap items-center gap-2">
          {htmlFor ? (
            <label htmlFor={htmlFor} className={labelClass}>
              {label}
            </label>
          ) : (
            <span className={labelClass}>{label}</span>
          )}
          {aside}
        </div>
        {description && <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-slate-500 dark:text-white/45">{description}</p>}
      </div>
      {/* A full-width field fills the slot; a compact control (a switch, a button) sits at its right end from sm. */}
      {children && <div className="flex min-w-0 sm:w-[min(20rem,55%)] sm:shrink-0 sm:justify-end">{children}</div>}
    </div>
  );
}

/** "Verrouillé" — a field that can no longer change. */
export function LockedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500 dark:bg-white/[0.07] dark:text-white/50">
      <Lock className="h-2.5 w-2.5" aria-hidden />
      {label}
    </span>
  );
}

/** A locked field's value: legible, plainly read-only (dashed edge and a padlock), never a faded input. */
export function LockedValue({ value }: { value: string }) {
  return (
    <div className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-dashed border-black/[0.1] bg-slate-50 px-3.5 text-[0.875rem] text-slate-700 dark:border-white/[0.12] dark:bg-white/[0.03] dark:text-white/75">
      <span className="min-w-0 truncate">{value || "—"}</span>
      <Lock className="h-4 w-4 shrink-0 text-slate-400 dark:text-white/40" aria-hidden />
    </div>
  );
}

/** Apple-style segmented choice: the selected option rides on a raised thumb. */
export function SettingsSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  const layoutId = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.06]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative min-h-9 rounded-lg px-3.5 text-[0.8125rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40",
              active ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-white/55 dark:hover:text-white"
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_2px_8px_-2px_rgba(15,23,42,0.12)] dark:bg-white/[0.12] dark:shadow-none"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Loading placeholder shaped like a card of rows. */
export function SettingsCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white/70 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <div className="flex items-center gap-3 px-5 pt-5 sm:px-6">
        <span className="h-9 w-9 animate-pulse rounded-xl bg-slate-200/80 dark:bg-white/[0.06]" />
        <span className="h-4 w-40 animate-pulse rounded-md bg-slate-200/80 dark:bg-white/[0.06]" />
      </div>
      <div className="mt-4 divide-y divide-black/[0.05] border-t border-black/[0.05] dark:divide-white/[0.06] dark:border-white/[0.06]">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-6 px-5 py-4 sm:px-6">
            <span className="h-3.5 w-28 animate-pulse rounded-md bg-slate-200/80 dark:bg-white/[0.06]" />
            <span className="h-11 w-1/2 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.04]" />
          </div>
        ))}
      </div>
    </div>
  );
}
