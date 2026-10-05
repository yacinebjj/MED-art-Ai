"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, CreditCard, Sparkles, Gift } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { RevealSection } from "@/components/ui/RevealSection";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PricingTierCard, PromoMonthlyOnlyCard } from "@/components/pricing/PricingTierCard";
import { GroupInviteFlow } from "@/components/pricing/GroupInviteFlow";
import { CohortVerificationFlow } from "@/components/pricing/CohortVerificationFlow";
import { FREE_TRIAL, getPlansForCycle, type BillingCycle } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Public pricing page (anonymous visitors). Renders the real lib/pricing.ts
 * plans; every CTA routes to /register — the actual Chargily checkout and the
 * Groupe / Promo pooled purchases live on app/dashboard/(shell)/billing.
 */
export default function PricingPage() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const plans = getPlansForCycle(cycle);

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1">
        {/* --- Hero --- */}
        <section className="relative overflow-hidden bg-slate-50 py-16 dark:bg-slate-900/40 sm:py-24">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary-400/10 blur-3xl" />
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <RevealSection>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-xs font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300 sm:text-sm">
                <Sparkles className="h-4 w-4 shrink-0" />
                {fr ? "Des tarifs pensés pour l'Algérie" : "Pricing designed for Algeria"}
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
                {fr ? "Un tarif pour chaque façon de réviser" : "A plan for every way to study"}
              </h1>
              <p className="mt-4 text-base text-slate-600 dark:text-slate-300 sm:text-lg">
                {fr
                  ? "Seul, à 5 amis, ou à 15 avec ta promo — paie en Dinars, par carte Edahabia ou CIB, en toute sécurité."
                  : "Alone, with 5 friends, or 15 from your class — pay in Dinars, by Edahabia or CIB card, securely."}
              </p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-300 sm:text-sm">
                <Gift className="h-4 w-4 shrink-0" />
                {fr
                  ? `${FREE_TRIAL.courses} cours + ${FREE_TRIAL.messages} messages offerts, une seule fois`
                  : `${FREE_TRIAL.courses} course + ${FREE_TRIAL.messages} messages free, one time only`}
              </p>
            </RevealSection>

            <RevealSection delay={0.1} className="mt-10 flex justify-center">
              <BillingCycleToggle value={cycle} onChange={setCycle} />
            </RevealSection>
          </div>
        </section>

        {/* --- Pricing grid --- */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
            {plans.map((plan, index) => (
              <RevealSection key={plan.id} delay={index * 0.1} className="h-full">
                <PricingTierCard
                  plan={plan}
                  ctaSlot={
                    <Button asChild size="lg" variant={plan.featured ? "primary" : "outline"} className="mt-6 w-full">
                      <Link href="/register">
                        <CreditCard className="h-4 w-4" />
                        {plan.tier === "group"
                          ? fr
                            ? "Créer mon compte et mon groupe"
                            : "Create my account and group"
                          : plan.tier === "promo"
                            ? fr
                              ? "Créer mon compte et ma Promo"
                              : "Create my account and Cohort"
                            : fr
                              ? "Créer mon compte"
                              : "Create my account"}
                      </Link>
                    </Button>
                  }
                >
                  {plan.tier === "group" && <GroupInviteFlow cycle={cycle} href={null} />}
                  {plan.tier === "promo" && <CohortVerificationFlow href={null} />}
                </PricingTierCard>
              </RevealSection>
            ))}
            {!plans.some((plan) => plan.tier === "promo") && (
              <RevealSection delay={0.2} className="h-full">
                <PromoMonthlyOnlyCard onShowMonthly={() => setCycle("monthly")} />
              </RevealSection>
            )}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
            {fr
              ? `Chaque compte commence par ${FREE_TRIAL.courses} cours avec le Studio complet + ${FREE_TRIAL.messages} messages Assistant / Copilot offerts, une seule fois, sans carte bancaire. Ensuite, tu paies une fois pour la durée choisie : aucun prélèvement automatique.`
              : `Every account starts with ${FREE_TRIAL.courses} course with the full Studio + ${FREE_TRIAL.messages} free Assistant / Copilot messages, one time only, no card needed. Then you pay once for the length you pick: no automatic charges.`}
          </p>
        </section>

        {/* --- Trust row: Edahabia / CIB / Chargily Pay --- */}
        <RevealSection>
          <section className="mx-auto max-w-4xl px-4 pb-20 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-border bg-background/50 p-6 text-center backdrop-blur-md sm:flex-row sm:justify-center sm:gap-6 sm:text-left">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-14 shrink-0 place-content-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-xs font-bold text-white shadow-sm">
                  Edahabia
                </span>
                <span className="grid h-10 w-14 shrink-0 place-content-center rounded-lg border border-border bg-card text-xs font-bold text-foreground shadow-sm">
                  CIB
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                {fr ? "Paiement 100% sécurisé en DZD, propulsé par Chargily Pay." : "100% secure payment in DZD, powered by Chargily Pay."}
              </div>
            </div>
          </section>
        </RevealSection>
      </main>

      <Footer />
    </div>
  );
}
