"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { BILLING_CYCLES, computeSavingsPercent, type BillingCycle, type PricingTierId } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

const TIERS: PricingTierId[] = ["individual", "group", "promo"];

/** Savings of a duration across the tiers: one figure when equal, "jusqu'à" the best otherwise. */
function savingsLabel(cycle: BillingCycle, fr: boolean): string {
  const pcts = TIERS.map((tier) => computeSavingsPercent(tier, cycle) ?? 0);
  const max = Math.max(...pcts);
  const amount = fr ? `−${max} %` : `−${max}%`;
  if (pcts.every((pct) => pct === max)) return amount;
  return fr ? `jusqu'à ${amount}` : `up to ${amount}`;
}

function savingsNote(fr: boolean): string {
  return fr
    ? `4 mois : ${savingsLabel("quad", true)}. Année (8 mois d'études) : ${savingsLabel("annual", true)}.`
    : `4 months: ${savingsLabel("quad", false)}. Year (8 study months): ${savingsLabel("annual", false)}.`;
}

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
 * The optional note states the saving of each longer duration against the
 * 1-month price, read from lib/pricing.ts (it differs per tier, so the year
 * shows the best one: "jusqu'à").
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
          {fr ? savingsNote(true) : savingsNote(false)}
        </p>
      )}
    </div>
  );
}
