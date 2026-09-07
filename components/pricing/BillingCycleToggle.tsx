"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

interface BillingCycleToggleProps {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}

/**
 * 3-way segmented control (1 Mois / 4 Mois / 1 An). The active pill slides
 * between positions via a single shared `layoutId` (framer-motion morphs the
 * same element between its old and new slot instead of cross-fading two
 * separate ones) rather than each button owning its own background — that's
 * what makes the transition read as one smooth glide, not a flicker.
 */
export function BillingCycleToggle({ value, onChange }: BillingCycleToggleProps) {
  const { language } = useLanguage();

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-soft backdrop-blur-md">
      {BILLING_CYCLES.map((cycle) => {
        const isActive = cycle.id === value;
        return (
          <button
            key={cycle.id}
            type="button"
            onClick={() => onChange(cycle.id)}
            className={cn(
              "relative rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:px-5",
              isActive ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isActive && (
              <motion.span
                layoutId="billing-cycle-pill"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-full bg-primary shadow-glow"
              />
            )}
            <span className="relative">{cycle.label[language]}</span>
          </button>
        );
      })}
    </div>
  );
}
