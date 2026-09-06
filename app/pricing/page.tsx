"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, CreditCard, Sparkles } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { RevealSection } from "@/components/ui/RevealSection";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { GroupInviteFlow } from "@/components/pricing/GroupInviteFlow";
import { CohortVerificationFlow } from "@/components/pricing/CohortVerificationFlow";
import { getPlansForCycle, type BillingCycle } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * Standalone public pricing page for the launch promo video, and the
 * homepage's own "#tarifs" section (app/page.tsx) both render the SAME real
 * lib/pricing.ts plans now — this page's CTAs still route to /register
 * rather than straight to checkout, since this is a pre-signup marketing
 * page for anonymous visitors (same pattern as the homepage); the real
 * Chargily checkout wiring lives on app/dashboard/(shell)/billing/page.tsx,
 * reached after signing up.
 */
export default function PricingPage() {
  const { language } = useLanguage();
  const [cycle, setCycle] = useState<BillingCycle>("annual");
  const [cohortVerified, setCohortVerified] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1">
        {/* --- Hero --- */}
        <section className="relative overflow-hidden bg-slate-50 py-20 dark:bg-slate-900/40 sm:py-24">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-primary-400/10 blur-3xl" />
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <RevealSection>
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-xs font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300 sm:text-sm">
                <Sparkles className="h-4 w-4 shrink-0" />
                {language === "fr" ? "Des tarifs pensés pour l'Algérie" : "Pricing designed for Algeria"}
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
                {language === "fr" ? "Un tarif pour chaque façon de réviser" : "A plan for every way to study"}
              </h1>
              <p className="mt-4 text-base text-slate-600 dark:text-slate-300 sm:text-lg">
                {language === "fr"
                  ? "Seul, en groupe, ou avec toute ta promo — paie en Dinars, par Carte Edahabia ou CIB, en toute sécurité."
                  : "Alone, as a group, or with your whole cohort — pay in Dinars, by Edahabia or CIB card, securely."}
              </p>
            </RevealSection>

            <RevealSection delay={0.1} className="mt-10 flex justify-center">
              <BillingCycleToggle value={cycle} onChange={setCycle} />
            </RevealSection>
          </div>
        </section>

        {/* --- Pricing grid --- */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
            {getPlansForCycle(cycle).map((plan, index) => (
              <RevealSection key={plan.id} delay={index * 0.1} className="h-full">
                <PricingTierCard
                  plan={plan}
                  ctaSlot={
                    plan.tier === "promo" ? (
                      <Button asChild={cohortVerified} size="lg" className="mt-6 w-full" disabled={!cohortVerified}>
                        {cohortVerified ? (
                          <Link href="/register">
                            <CreditCard className="h-4 w-4" />
                            {language === "fr" ? "Payer avec Edahabia" : "Pay with Edahabia"}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <CreditCard className="h-4 w-4" />
                            {language === "fr" ? "Vérifie ton éligibilité d'abord" : "Verify your eligibility first"}
                          </span>
                        )}
                      </Button>
                    ) : (
                      <Button asChild size="lg" variant={plan.featured ? "primary" : "outline"} className="mt-6 w-full">
                        <Link href="/register">
                          <CreditCard className="h-4 w-4" />
                          {language === "fr" ? "Payer avec Edahabia" : "Pay with Edahabia"}
                        </Link>
                      </Button>
                    )
                  }
                >
                  {plan.tier === "group" && <GroupInviteFlow />}
                  {plan.tier === "promo" && <CohortVerificationFlow onVerifiedChange={setCohortVerified} />}
                </PricingTierCard>
              </RevealSection>
            ))}
          </div>
        </section>

        {/* --- Trust row: Edahabia / CIB / Chargily Pay --- */}
        <RevealSection>
          <section className="mx-auto max-w-4xl px-4 pb-20 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-background/50 p-6 text-center backdrop-blur-md sm:flex-row sm:justify-center sm:gap-6 sm:text-left">
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
                {language === "fr"
                  ? "Paiement 100% sécurisé en DZD, propulsé par Chargily Pay."
                  : "100% secure payment in DZD, powered by Chargily Pay."}
              </div>
            </div>
          </section>
        </RevealSection>
      </main>

      <Footer />
    </div>
  );
}
