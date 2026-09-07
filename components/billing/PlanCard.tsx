import { CheckCircle2 } from "lucide-react";
import { MotionCard } from "@/components/ui/MotionCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { isPaidPlanId, type Plan } from "@/lib/pricing";

/** "800 DZD / mois" for the 3 monthly plans, "5 000 DZD / 3 mois" and "12 000 DZD / an" for Semester/Annual — durationMonths drives this instead of a hardcoded 12-or-semestre check, which broke the moment a 3rd duration (1 month) entered the plan lineup. */
function formatBillingPeriod(durationMonths: number): string {
  if (durationMonths === 1) return "mois";
  if (durationMonths === 12) return "an";
  return `${durationMonths} mois`;
}

export function PlanCard({
  plan,
  isCurrentPlan,
  isLoading,
  onSubscribe,
}: {
  plan: Plan;
  isCurrentPlan: boolean;
  isLoading: boolean;
  onSubscribe: () => void;
}) {
  const isFreemium = !isPaidPlanId(plan.id);

  return (
    <MotionCard className="flex flex-col p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-foreground">{plan.label}</h3>
        {isCurrentPlan && <Badge variant="success">Formule actuelle</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-extrabold tracking-tight text-foreground">
          {plan.priceDZD.toLocaleString("fr-FR")}
        </span>
        <span className="text-sm font-medium text-muted-foreground">
          DZD / {formatBillingPeriod(plan.durationMonths)}
        </span>
      </div>

      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
            {feature}
          </li>
        ))}
      </ul>

      <Button
        className="mt-8 w-full"
        size="lg"
        variant={isCurrentPlan ? "outline" : "primary"}
        onClick={onSubscribe}
        isLoading={isLoading}
        disabled={isLoading || isFreemium}
      >
        {isFreemium ? "Niveau par défaut" : isCurrentPlan ? "Renouveler" : "Souscrire"}
      </Button>
    </MotionCard>
  );
}
