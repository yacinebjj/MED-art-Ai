"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

interface BillingCycleToggleProps {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  /** Show the honest one-liner under the toggle (same monthly price whatever the duration, Promo is 1 month only). */
  showNote?: boolean;
  className?: string;
}

/**
 * 3-way segmented control (1 Mois / 4 Mois / 1 An). The active pill glides
 * between slots through a shared `layoutId` — scoped with useId() so two
 * toggles on the same page never fight over the same pill.
 *
 * v2 prices are exactly monthly × months (no invented discount), and Promo
 * Cohorte only exists on 1 month: the optional note says both, plainly.
 */
export function BillingCycleToggle({ value, onChange, showNote = true, className }: BillingCycleToggleProps) {
  const { language } = useLanguage();
  const pillId = useId();
  const fr = language === "fr";

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        role="radiogroup"
        aria-label={fr ? "Durée de l'abonnement" : "Subscription length"}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-soft backdrop-blur-md"
      >
        {BILLING_CYCLES.map((cycle) => {
          const isActive = cycle.id === value;
          return (
            <button
              key={cycle.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(cycle.id)}
              className={cn(
                "relative min-h-[40px] rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-5",
                isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId={`billing-cycle-pill-${pillId}`}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-full bg-primary shadow-glow"
                />
              )}
              <span className="relative">{cycle.label[language]}</span>
            </button>
          );
        })}
      </div>
      {showNote && (
        <p className="max-w-xs text-center text-[11px] leading-snug text-muted-foreground">
          {fr
            ? "Même prix par mois quelle que soit la durée. Promo Cohorte : 1 mois uniquement."
            : "Same price per month whatever the length. Cohort plan: 1 month only."}
        </p>
      )}
    </div>
  );
}
