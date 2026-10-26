"use client";

import { ArrowRight, CreditCard, Gauge, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { CohortVerificationFlow } from "@/components/pricing/CohortVerificationFlow";
import type { PoolView } from "@/lib/billing-pools";
import { formatDZD, GROUP_SIZE, POOL_DEADLINE_DAYS, REFUND_DELAY_LABEL, type BillingCycle, type Plan, type PlanId } from "@/lib/pricing";

/** What a billing-page plan card asks the page to do. */
export type PlanAction =
  | { type: "checkout"; plan: PlanId }
  | { type: "pool"; kind: "group" | "promo"; cycle: BillingCycle }
  | { type: "open"; code: string };

/** Stable key so the page can show a spinner on the exact button that was pressed. */
export function planActionKey(action: PlanAction): string {
  if (action.type === "pool") return `pool:${action.kind}:${action.cycle}`;
  if (action.type === "open") return `open:${action.code}`;
  return `${action.type}:${action.plan}`;
}

interface PlanCardProps {
  plan: Plan;
  isCurrentPlan: boolean;
  /** Key of the action in flight (planActionKey), or null. */
  loadingKey: string | null;
  onAction: (action: PlanAction) => void;
  /** The student's open pooled group, if any: group buttons lead back to it instead of starting a second one. */
  openPool?: PoolView | null;
  /** End of the student's running paid plan, if any: a pooled group can only be started once it is over. */
  activePlanEnd?: string | null;
}

function formatFrenchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

const CYCLE_LABEL: Record<BillingCycle, string> = { monthly: "1 mois", quad: "4 mois", annual: "8 mois" };

/**
 * Billing-page card for one tier at one cycle (monetization v2), built on the
 * shared PricingTierCard. Individuel → Chargily checkout; Groupe and Groupe
 * de 10 → pooled purchase, « Chacun paie sa part » (any duration). Groups a
 * leader already paid for in one go keep working in « Tes groupes ».
 */
export function PlanCard({ plan, isCurrentPlan, loadingKey, onAction, openPool = null, activePlanEnd = null }: PlanCardProps) {
  const busy = loadingKey !== null;
  const cycle: BillingCycle = plan.cycle ?? "monthly";

  let action: PlanAction;
  let ctaLabel: string;
  let ctaNote: string | null = null;
  /** Shown instead of an action that cannot happen right now. */
  let blocked = false;

  const startsPooledGroup = plan.tier === "promo" || plan.tier === "group";
  const sameFormula = openPool !== null && openPool.kind === (plan.tier === "promo" ? "promo" : "group") && openPool.cycle === cycle;
  const myHoldLive =
    openPool !== null && openPool.me.status === "holding" && Boolean(openPool.me.holdExpiresAt) && new Date(openPool.me.holdExpiresAt ?? 0).getTime() > Date.now();
  // An EMPTY group the student started (nobody paid, they are not paying) can be replaced by another formula.
  const replaceable = openPool !== null && openPool.isCreator && openPool.confirmed === 0 && openPool.me.status !== "paid" && !myHoldLive;

  if (startsPooledGroup && openPool && (sameFormula || !replaceable)) {
    // One open group at a time: lead the student back to theirs instead of starting a second one.
    action = { type: "open", code: openPool.code };
    ctaLabel = `Ouvrir mon groupe en cours (${openPool.confirmed}/${openPool.size})`;
    ctaNote = `Tu as déjà un groupe en cours (Groupe de ${openPool.size} · ${CYCLE_LABEL[openPool.cycle] ?? openPool.cycle}) : retrouve-le, partage son lien ou paie ta part.`;
  } else if (startsPooledGroup && activePlanEnd) {
    action = { type: "pool", kind: plan.tier === "promo" ? "promo" : "group", cycle };
    ctaLabel = `Abonnement actif jusqu'au ${formatFrenchDate(activePlanEnd)}`;
    ctaNote = "Tu profites déjà de tout MedArt AI. Tu pourras lancer ou rejoindre un groupe dès la fin de ton abonnement.";
    blocked = true;
  } else if (plan.tier === "group") {
    action = { type: "pool", kind: "group", cycle };
    ctaLabel = "Créer le groupe";
    ctaNote = `Étape suivante : tu paies ta part (${formatDZD(plan.priceDZD)}), puis tu partages le lien. Un ami a déjà créé ton groupe ? Ouvre plutôt son lien.`;
  } else if (plan.tier === "promo") {
    action = { type: "pool", kind: "promo", cycle };
    ctaLabel = `Lancer le ${plan.label}`;
    ctaNote = `Étape suivante : tu paies ta part (${formatDZD(plan.priceDZD)}), puis tu partages le lien à tes amis. Un ami a déjà lancé ton groupe ? Ouvre plutôt son lien.`;
  } else {
    action = { type: "checkout", plan: plan.id };
    ctaLabel = isCurrentPlan ? "Renouveler" : `Payer ${formatDZD(plan.priceDZD)}`;
  }
  if (startsPooledGroup && openPool && replaceable && !sameFormula && action.type === "pool" && !blocked) {
    ctaNote = `Ton groupe en cours (Groupe de ${openPool.size} · ${CYCLE_LABEL[openPool.cycle] ?? openPool.cycle}), encore vide, sera remplacé par celui-ci.`;
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
            variant={plan.featured || action.type === "open" ? "primary" : "outline"}
            className="h-auto min-h-[3rem] w-full whitespace-normal py-3 text-center leading-tight"
            onClick={() => onAction(action)}
            isLoading={loadingKey === key}
            disabled={busy || blocked}
          >
            {action.type === "open" ? <ArrowRight className="h-4 w-4 shrink-0" /> : <CreditCard className="h-4 w-4 shrink-0" />}
            {ctaLabel}
          </Button>
          {ctaNote && <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">{ctaNote}</p>}
        </div>
      }
    >
      {plan.tier === "group" && (
        <div className="rounded-xl border border-primary-500/40 bg-primary-50 p-3 dark:border-primary-400/40 dark:bg-primary-900/25">
          <p className="flex flex-wrap items-center gap-x-2 text-sm font-bold text-foreground">
            <Users className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
            Chacun paie sa part
            <span className="ml-auto tabular-nums">{formatDZD(plan.priceDZD)} / pers.</span>
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {`Jauge 1/${GROUP_SIZE} → ${GROUP_SIZE}/${GROUP_SIZE} : l'abonnement démarre pour les ${GROUP_SIZE} dès 5/5. Pas complet en ${POOL_DEADLINE_DAYS} jours ? Remboursement déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}.`}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Gauge className="h-3 w-3" />
            Exactement {GROUP_SIZE} personnes, ni plus ni moins.
          </p>
        </div>
      )}
      {plan.tier === "promo" && <CohortVerificationFlow href={null} />}
    </PricingTierCard>
  );
}
