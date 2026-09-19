"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { MotionCard } from "@/components/ui/MotionCard";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { computeSavingsPercent, formatDZD, BILLING_CYCLES, type Plan } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

interface PricingTierCardProps {
  /** A single Plan variant for the tier/cycle currently selected (e.g. PLANS.group_annual) — plan.tier/plan.cycle must both be set (i.e. never the "freemium" Plan, which isn't part of the tier grid). */
  plan: Plan;
  /** Tier-specific mechanic (group invite demo / cohort verification) rendered between the feature list and the CTA. Absent for the plain Individuel tier. */
  children?: ReactNode;
  ctaSlot: ReactNode;
}

export function PricingTierCard({ plan, children, ctaSlot }: PricingTierCardProps) {
  const { language } = useLanguage();
  const savings = plan.tier && plan.cycle ? computeSavingsPercent(plan.tier, plan.cycle) : null;
  const cycleLabel = BILLING_CYCLES.find((c) => c.id === plan.cycle)?.label[language] ?? "";

  return (
    <MotionCard
      className={cn(
        "relative flex h-full flex-col overflow-visible p-6 sm:p-8",
        // Featured cards get extra top padding so the ribbon (which
        // straddles the top edge) never crowds the plan name. 3rem/3.5rem
        // gives ~24px of clearance below the ribbon's lower edge.
        plan.featured && "pt-12 sm:pt-14",
        plan.featured && "border-primary-400 shadow-[0_0_50px_rgba(20,184,166,0.25)] dark:border-primary-500"
      )}
    >
      {plan.featured && (
        <>
          {/*
           * Static gradient strip along the top edge.
           *
           * Was `animate-shimmer` (a background-position keyframe driving a
           * per-frame repaint on every featured card, forever). Combined
           * with MotionCard's hover transform and the glass backdrop-blur
           * underneath, that was the dominant source of the "laggy" feel
           * on the pricing grid — background-position animations trigger
           * paint on the entire element, not just a GPU-composited layer.
           * The static gradient is visually identical at rest; the only
           * thing lost is a motion nobody was going to stare at anyway.
           */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 z-0 h-1 bg-gradient-to-r from-primary-400 via-secondary-400 to-primary-400"
          />

          {/*
           * "Recommandé" ribbon.
           *
           * `top-0 -translate-y-1/2` centers the ribbon ON the card's top
           * border (half above, half below) — the standard ribbon pattern.
           * The previous `top-3` placed it fully inside, where it collided
           * with the shimmer strip and appeared clipped.
           *
           * z-20 keeps it above the gradient strip (z-0) and any inner
           * content. whitespace-nowrap prevents "Promo Cohorte" and other
           * longer translations from wrapping on narrow cards.
           */}
          <span className="absolute left-1/2 top-0 z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-primary-500 to-secondary-600 px-4 py-1 text-xs font-semibold text-white shadow-soft">
            <Sparkles className="h-3 w-3" />
            {language === "fr" ? "Recommandé" : "Recommended"}
          </span>
        </>
      )}

      <h3 className="text-lg font-bold text-foreground">{plan.label}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      <div className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-wrap items-baseline gap-2"
          >
            <span className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight text-foreground">{formatDZD(plan.priceDZD)}</span>
              <span className="text-sm font-medium text-muted-foreground">/ {cycleLabel}</span>
            </span>
            {savings !== null && (
              <Badge variant="success" className="animate-fade-in">
                {language === "fr" ? `Économisez ${savings}%` : `Save ${savings}%`}
              </Badge>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <ul className="mt-6 space-y-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" />
            {feature}
          </li>
        ))}
      </ul>

      {children && <div className="mt-6">{children}</div>}

      <div className="mt-8 flex-1" />
      {ctaSlot}
    </MotionCard>
  );
}
