"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Sparkles, Users } from "lucide-react";
import { MotionCard } from "@/components/ui/MotionCard";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { computeSavingsPercent, formatDZD, groupLeaderTotalDZD, PAID_LIMITS, poolTotalDZD, type Plan } from "@/lib/pricing";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { AUDIO_SMART_NOTES_ENABLED } from "@/lib/feature-flags";

/** What every paid plan includes, per member — mirrors PAID_LIMITS (lib/pricing.ts). */
export const PAID_LIMIT_LINES: { text: Record<Language, string>; hint?: Record<Language, string> }[] = [
  {
    text: { fr: `${PAID_LIMITS.coursesPerMonth} cours par mois, Studio complet`, en: `${PAID_LIMITS.coursesPerMonth} courses a month, full Studio` },
    hint: { fr: "Un cours supprimé ne rend pas le crédit", en: "Deleting a course does not give the credit back" },
  },
  { text: { fr: `${PAID_LIMITS.examsPerMonth} examens de module par mois`, en: `${PAID_LIMITS.examsPerMonth} module exams a month` } },
  {
    text: { fr: `${PAID_LIMITS.synthesesPerMonth} résumés de module par mois`, en: `${PAID_LIMITS.synthesesPerMonth} module summaries a month` },
    hint: {
      fr: "Résumé, Mots-clés ou Dictionnaire : 1 chacun",
      en: "Summary, Keywords or Dictionary: 1 each",
    },
  },
  {
    text: { fr: "Accès complet à l'IA MedArt", en: "Full access to MedArt AI" },
    hint: { fr: "Assistance intelligente en continu", en: "Smart assistance, always on" },
  },
  // Held back for V2 (lib/feature-flags.ts).
  ...(AUDIO_SMART_NOTES_ENABLED
    ? [
        {
          text: {
            fr: `Audio → Smart Notes : ${PAID_LIMITS.audioPerDay}/jour (${PAID_LIMITS.audioPerMonth}/mois)`,
            en: `Audio → Smart Notes: ${PAID_LIMITS.audioPerDay}/day (${PAID_LIMITS.audioPerMonth}/month)`,
          },
        },
      ]
    : []),
  { text: { fr: "Flashcards, To-Do et Notes illimités", en: "Unlimited Flashcards, To-Do and Notes" } },
];

function cycleSuffix(durationMonths: number, language: Language): string {
  if (language === "fr") return durationMonths === 1 ? "mois" : durationMonths === 12 ? "an" : `${durationMonths} mois`;
  return durationMonths === 1 ? "month" : durationMonths === 12 ? "year" : `${durationMonths} months`;
}

function seatsLabel(seats: number, language: Language): string {
  if (seats <= 1) return language === "fr" ? "1 personne" : "1 person";
  return language === "fr" ? `Exactement ${seats} personnes` : `Exactly ${seats} people`;
}

interface PricingTierCardProps {
  /** The plan for the tier/cycle currently selected (never "freemium"). */
  plan: Plan;
  /** Tier-specific block (Groupe payment choice / how-it-works) between the lists and the CTA. */
  children?: ReactNode;
  ctaSlot: ReactNode;
  /** Shown as a "Ta formule" badge. */
  isCurrent?: boolean;
  /** Hide the per-member limits list (compact contexts). */
  hideLimits?: boolean;
}

export function PricingTierCard({ plan, children, ctaSlot, isCurrent = false, hideLimits = false }: PricingTierCardProps) {
  const { language } = useLanguage();
  const fr = language === "fr";
  const perPerson = plan.seats > 1;
  const monthly = Math.round(plan.priceDZD / Math.max(1, plan.durationMonths));
  // Individuel's own feature list IS the limits list — only the two Groupe tiers add tier-specific lines.
  const savings = plan.tier && plan.cycle ? computeSavingsPercent(plan.tier, plan.cycle) : null;
  const highlights = plan.tier === "individual" ? [] : plan.features;

  return (
    <MotionCard
      className={cn(
        "relative flex h-full flex-col overflow-visible p-5 sm:p-7",
        plan.featured && "pt-10 sm:pt-12",
        plan.featured && "border-primary-400 shadow-[0_0_50px_rgba(20,184,166,0.22)] dark:border-primary-500"
      )}
    >
      {plan.featured && (
        <>
          <div aria-hidden className="absolute inset-x-0 top-0 z-0 h-1 rounded-t-2xl bg-gradient-to-r from-primary-400 via-secondary-400 to-primary-400" />
          <span className="absolute left-1/2 top-0 z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-primary-500 to-secondary-600 px-4 py-1 text-xs font-semibold text-white shadow-soft">
            <Sparkles className="h-3 w-3" />
            {fr ? "Le plus choisi" : "Most popular"}
          </span>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-foreground">{plan.label}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {isCurrent && <Badge variant="success">{fr ? "Ta formule" : "Your plan"}</Badge>}
          <Badge variant={perPerson ? "primary" : "neutral"} className="gap-1">
            <Users className="h-3 w-3" />
            {seatsLabel(plan.seats, language)}
          </Badge>
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      <div className="mt-5 min-h-[4.5rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{formatDZD(plan.priceDZD)}</span>
              <span className="text-sm font-medium text-muted-foreground">
                {perPerson ? (fr ? "/ personne " : "/ person ") : ""}/ {cycleSuffix(plan.durationMonths, language)}
              </span>
            </p>
            {plan.durationMonths > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {fr ? `soit ${formatDZD(monthly)} par mois${perPerson ? " et par personne" : ""}` : `that is ${formatDZD(monthly)} a month${perPerson ? " per person" : ""}`}
                {savings ? <span className="ml-1.5 font-semibold text-emerald-600 dark:text-emerald-400">−{savings} %</span> : null}
              </p>
            )}
            {plan.tier === "promo" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {fr ? `soit ${formatDZD(poolTotalDZD(plan))} pour les ${plan.seats} personnes` : `that is ${formatDZD(poolTotalDZD(plan))} for all ${plan.seats} people`}
              </p>
            )}
            {plan.tier === "group" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {fr ? `ou ${formatDZD(groupLeaderTotalDZD(plan))} en une fois si une personne paie les 5 places` : `or ${formatDZD(groupLeaderTotalDZD(plan))} at once if one person pays the 5 seats`}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {highlights.length > 0 && (
        <ul className="mt-4 space-y-2">
          {highlights.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm font-medium text-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" />
              {feature}
            </li>
          ))}
        </ul>
      )}

      {!hideLimits && (
        <div className="mt-5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {perPerson ? (fr ? "Inclus pour chaque membre" : "Included for each member") : fr ? "Inclus" : "Included"}
          </p>
          <ul className="mt-2 space-y-2">
            {PAID_LIMIT_LINES.map((line) => (
              <li key={line.text.fr} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  {line.text[language]}
                  {line.hint && <span className="block text-[11px] leading-snug opacity-80">{line.hint[language]}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {children && <div className="mt-5">{children}</div>}

      <div className="flex-1" />
      {ctaSlot}
    </MotionCard>
  );
}
