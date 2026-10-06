"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

interface BillingCycleToggleProps {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  /** Show the one-liner under the toggle (the duration discounts). */
  showNote?: boolean;
  className?: string;
}

/**
 * 3-way segmented control (1 Mois / 4 Mois / Année). The active pill glides
 * between slots through a shared `layoutId` — scoped with useId() so two
 * toggles on the same page never fight over the same pill.
 *
 * v3 prices: 4 months = −20 %, the year (8 study months) = −45 %, for every
 * tier (lib/pricing.ts) — the optional note says so, plainly.
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
            ? "4 mois : −20 %. Année (8 mois d'études) : −45 %."
            : "4 months: −20%. Year (8 study months): −45%."}
        </p>
      )}
    </div>
  );
}
