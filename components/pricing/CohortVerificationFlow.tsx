"use client";

import Link from "next/link";
import { ArrowRight, Gauge, RotateCcw, Share2, UserPlus } from "lucide-react";
import { formatDZD, PLANS, POOL_DEADLINE_DAYS, PROMO_SIZE, REFUND_DELAY_LABEL } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

interface CohortVerificationFlowProps {
  /** Where the visitor goes to actually start a Promo: /register (public pages) or /dashboard/billing; null hides the link. */
  href?: string | null;
}

/**
 * "Comment ça marche" for the Promo Cohorte tier. The previous version
 * pretended to verify a faculty + delegate code client-side; there is no such
 * check, so this now explains the real mechanism (lib/billing-pools.ts): a
 * shared invite link, a 15/15 gauge, and an automatic refund request if the
 * gauge is not full in time. No fake verification, no fake link.
 */
export function CohortVerificationFlow({ href = "/register" }: CohortVerificationFlowProps) {
  const { language } = useLanguage();
  const fr = language === "fr";
  const price = formatDZD(PLANS.promo_monthly.priceDZD);

  const steps = fr
    ? [
        { icon: UserPlus, title: "Une personne lance la Promo", text: `Elle paie sa part (${price}) et reçoit un lien d'invitation.` },
        { icon: Share2, title: "La promo rejoint via le lien", text: `Chacun paie ${price} ; la jauge avance de 1/${PROMO_SIZE} à ${PROMO_SIZE}/${PROMO_SIZE}.` },
        { icon: Gauge, title: `À ${PROMO_SIZE}/${PROMO_SIZE}, c'est parti`, text: `L'abonnement d'1 mois démarre en même temps pour les ${PROMO_SIZE}.` },
      ]
    : [
        { icon: UserPlus, title: "One person starts the Cohort", text: `They pay their share (${price}) and get an invite link.` },
        { icon: Share2, title: "The class joins via the link", text: `Everyone pays ${price}; the gauge goes from 1/${PROMO_SIZE} to ${PROMO_SIZE}/${PROMO_SIZE}.` },
        { icon: Gauge, title: `At ${PROMO_SIZE}/${PROMO_SIZE}, you're in`, text: `The 1-month plan starts at the same time for all ${PROMO_SIZE}.` },
      ];

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{fr ? "Comment ça marche" : "How it works"}</p>

      <ol className="mt-3 space-y-2.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
              <step.icon className="h-4 w-4" />
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">{index + 1}</span>
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-foreground">{step.title}</span>
              <span className="block text-xs text-muted-foreground">{step.text}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] leading-snug text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
        <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {fr
          ? `Pas ${PROMO_SIZE}/${PROMO_SIZE} en ${POOL_DEADLINE_DAYS} jours ? Remboursement déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}. Partage le lien uniquement avec ta promo.`
          : `Not ${PROMO_SIZE}/${PROMO_SIZE} within ${POOL_DEADLINE_DAYS} days? A refund is requested automatically and received within 5 business days. Share the link with your class only.`}
      </p>

      {href && (
        <Link href={href} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline dark:text-primary-400">
          {href.startsWith("/dashboard") ? (fr ? "Lancer la Promo depuis mon espace Abonnement" : "Start the Cohort from my Billing space") : fr ? "Créer mon compte pour lancer la Promo" : "Create my account to start the Cohort"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
