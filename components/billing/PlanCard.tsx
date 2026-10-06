"use client";

import { useState } from "react";
import { CreditCard, Gauge, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { CohortVerificationFlow } from "@/components/pricing/CohortVerificationFlow";
import { cn } from "@/lib/utils";
import {
  formatDZD,
  GROUP_SIZE,
  groupLeaderTotalDZD,
  POOL_DEADLINE_DAYS,
  REFUND_DELAY_LABEL,
  type BillingCycle,
  type GroupPaymentMode,
  type Plan,
  type PlanId,
} from "@/lib/pricing";

/** What a billing-page plan card asks the page to do. */
export type PlanAction =
  | { type: "checkout"; plan: PlanId }
  | { type: "leader"; plan: PlanId }
  | { type: "pool"; kind: "group" | "promo"; cycle: BillingCycle };

/** Stable key so the page can show a spinner on the exact button that was pressed. */
export function planActionKey(action: PlanAction): string {
  return action.type === "pool" ? `pool:${action.kind}:${action.cycle}` : `${action.type}:${action.plan}`;
}

interface PlanCardProps {
  plan: Plan;
  isCurrentPlan: boolean;
  /** Key of the action in flight (planActionKey), or null. */
  loadingKey: string | null;
  onAction: (action: PlanAction) => void;
}

const MODE_OPTIONS: { id: GroupPaymentMode; icon: typeof Zap; title: string }[] = [
  { id: "leader", icon: Zap, title: "Je paie pour les 5" },
  { id: "pooled", icon: Users, title: "Chacun paie sa part" },
];

/**
 * Billing-page card for one tier at one cycle (monetization v2), built on the
 * shared PricingTierCard. Individuel → Chargily checkout; Groupe → the
 * student picks « Je paie pour les 5 » (leader checkout) or « Chacun paie sa
 * part » (pooled purchase); Cohorte → pooled purchase, any duration.
 */
export function PlanCard({ plan, isCurrentPlan, loadingKey, onAction }: PlanCardProps) {
  const [groupMode, setGroupMode] = useState<GroupPaymentMode>("leader");
  const busy = loadingKey !== null;
  const cycle: BillingCycle = plan.cycle ?? "monthly";

  let action: PlanAction;
  let ctaLabel: string;
  let ctaNote: string | null = null;

  if (plan.tier === "group") {
    if (groupMode === "leader") {
      action = { type: "leader", plan: plan.id };
      ctaLabel = `Payer ${formatDZD(groupLeaderTotalDZD(plan))} pour les ${GROUP_SIZE}`;
      ctaNote = "Paiement unique via Chargily. Tes 4 codes d'invitation apparaissent ensuite dans « Tes groupes ».";
    } else {
      action = { type: "pool", kind: "group", cycle };
      ctaLabel = "Créer le groupe";
      ctaNote = `Tu paies ta part (${formatDZD(plan.priceDZD)}) à l'étape suivante, puis tu partages le lien.`;
    }
  } else if (plan.tier === "promo") {
    action = { type: "pool", kind: "promo", cycle };
    ctaLabel = "Lancer la Cohorte";
    ctaNote = `Tu paies ta part (${formatDZD(plan.priceDZD)}) à l'étape suivante, puis tu partages le lien à ta promo.`;
  } else {
    action = { type: "checkout", plan: plan.id };
    ctaLabel = isCurrentPlan ? "Renouveler" : `Payer ${formatDZD(plan.priceDZD)}`;
  }

  const key = planActionKey(action);

  return (
    <PricingTierCard
      plan={plan}
      isCurrent={isCurrentPlan}
      ctaSlot={
        <div className="mt-6">
          <Button
            size="lg"
            variant={plan.featured ? "primary" : "outline"}
            className="h-auto min-h-[3rem] w-full whitespace-normal py-3 text-center leading-tight"
            onClick={() => onAction(action)}
            isLoading={loadingKey === key}
            disabled={busy}
          >
            <CreditCard className="h-4 w-4 shrink-0" />
            {ctaLabel}
          </Button>
          {ctaNote && <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">{ctaNote}</p>}
        </div>
      }
    >
      {plan.tier === "group" && (
        <fieldset>
          <legend className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Qui paie ?</legend>
          <div role="radiogroup" className="mt-2 grid grid-cols-1 gap-2">
            {MODE_OPTIONS.map((option) => {
              const selected = groupMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setGroupMode(option.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/25" : "border-border bg-card hover:bg-accent"
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                      selected ? "border-primary-600 dark:border-primary-400" : "border-muted-foreground/50"
                    )}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-primary-600 dark:bg-primary-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
                      <option.icon className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                      {option.title}
                      <span className="ml-auto tabular-nums">
                        {option.id === "leader" ? formatDZD(groupLeaderTotalDZD(plan)) : `${formatDZD(plan.priceDZD)} / pers.`}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                      {option.id === "leader"
                        ? "Un seul paiement, activation immédiate, 4 codes d'invitation à partager."
                        : `Jauge 1/${GROUP_SIZE} → ${GROUP_SIZE}/${GROUP_SIZE} : l'abonnement démarre pour les ${GROUP_SIZE} dès 5/5. Pas complet en ${POOL_DEADLINE_DAYS} jours ? Remboursement déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}.`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Gauge className="h-3 w-3" />
            Exactement {GROUP_SIZE} personnes, ni plus ni moins.
          </p>
        </fieldset>
      )}
      {plan.tier === "promo" && <CohortVerificationFlow href={null} />}
    </PricingTierCard>
  );
}
