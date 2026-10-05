"use client";

import Link from "next/link";
import { ArrowRight, CreditCard, Gauge, Share2, Users, Wallet } from "lucide-react";
import { formatDZD, GROUP_SIZE, groupLeaderTotalDZD, PLANS, POOL_DEADLINE_DAYS, REFUND_DELAY_LABEL, type BillingCycle, type PlanId } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

interface GroupInviteFlowProps {
  cycle: BillingCycle;
  /** Where the visitor goes to actually start a group: /register (public pages) or /dashboard/billing; null hides the link. */
  href?: string | null;
}

/**
 * "Comment ça marche" for the Groupe tier — a plain explanation of the two
 * real payment options (lib/billing-pools.ts). Nothing here is simulated: the
 * invite code only exists after a real order, on the student's billing page.
 */
export function GroupInviteFlow({ cycle, href = "/register" }: GroupInviteFlowProps) {
  const { language } = useLanguage();
  const fr = language === "fr";
  const plan = PLANS[`group_${cycle}` as PlanId];
  const share = formatDZD(plan.priceDZD);
  const total = formatDZD(groupLeaderTotalDZD(plan));

  const steps = fr
    ? [
        { icon: Users, title: `Réunis ${GROUP_SIZE} amis`, text: `Exactement ${GROUP_SIZE} personnes, toi compris.` },
        { icon: Wallet, title: "Choisis qui paie", text: "Une personne pour les 5, ou chacun sa part." },
        { icon: Share2, title: "Partage le lien", text: "Ton lien d'invitation apparaît dans ton espace Abonnement." },
      ]
    : [
        { icon: Users, title: `Gather ${GROUP_SIZE} friends`, text: `Exactly ${GROUP_SIZE} people, you included.` },
        { icon: Wallet, title: "Choose who pays", text: "One person for all 5, or everyone their share." },
        { icon: Share2, title: "Share the link", text: "Your invite link appears in your Billing space." },
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

      <div className="mt-4 grid grid-cols-1 gap-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <CreditCard className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
            {fr ? "« Je paie pour les 5 »" : "“I pay for all 5”"}
            <span className="ml-auto tabular-nums">{total}</span>
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {fr
              ? "Un seul paiement, activation immédiate pour toi, et 4 codes d'invitation pour tes amis."
              : "One payment, active right away for you, plus 4 invite codes for your friends."}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Gauge className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
            {fr ? "« Chacun paie sa part »" : "“Everyone pays their share”"}
            <span className="ml-auto tabular-nums">{share}</span>
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {fr
              ? `Une jauge passe de 1/${GROUP_SIZE} à ${GROUP_SIZE}/${GROUP_SIZE} ; l'abonnement démarre pour les ${GROUP_SIZE} dès qu'elle est pleine. Pas complet en ${POOL_DEADLINE_DAYS} jours ? Remboursement déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}.`
              : `A gauge goes from 1/${GROUP_SIZE} to ${GROUP_SIZE}/${GROUP_SIZE}; the plan starts for all ${GROUP_SIZE} once it is full. Not full within ${POOL_DEADLINE_DAYS} days? A refund is requested automatically and received within 5 business days.`}
          </p>
        </div>
      </div>

      {href && (
        <Link href={href} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline dark:text-primary-400">
          {href.startsWith("/dashboard") ? (fr ? "Démarrer depuis mon espace Abonnement" : "Start from my Billing space") : fr ? "Créer mon compte pour démarrer un groupe" : "Create my account to start a group"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
