"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { PlanCard } from "@/components/billing/PlanCard";
import { Card } from "@/components/ui/Card";
import { PLANS, type PlanId } from "@/lib/pricing";
import { useAuth } from "@/providers/AuthProvider";

interface SubscriptionInfo {
  plan: PlanId;
  planLabel: string;
  status: string;
  active: boolean;
  periodEnd: string | null;
  generationsUsed: number;
  generationCap: number | null;
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageContent />
    </Suspense>
  );
}

function BillingPageContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const { user } = useAuth();

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadSubscription() {
    const res = await fetch("/api/subscription");
    const data = await res.json();
    setSubscription(data.subscription);
  }

  useEffect(() => {
    if (user) loadSubscription();
  }, [user]);

  async function handleSubscribe(plan: PlanId) {
    if (!user) return;

    setError(null);
    setLoadingPlan(plan);

    try {
      const res = await fetch("/api/chargily/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Impossible de créer le paiement.");
      }

      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer le paiement.");
      setLoadingPlan(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Abonnement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paiement sécurisé en DZD via Edahabia (Algérie Poste) ou carte CIB, propulsé par Chargily
          Pay.
        </p>
      </div>

      {status === "success" && (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Paiement reçu ! Ton abonnement sera activé dans quelques instants (confirmation
          automatique).
        </Card>
      )}
      {status === "failure" && (
        <Card className="flex items-center gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          <XCircle className="h-4 w-4 shrink-0" />
          Le paiement a échoué ou a été annulé. Aucun montant n'a été débité.
        </Card>
      )}
      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </Card>
      )}

      {subscription?.active && (
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">
            Formule actuelle : <span className="font-semibold text-foreground">{subscription.planLabel}</span>
            {subscription.periodEnd && (
              <>
                {" "}
                — valable jusqu'au{" "}
                <span className="font-semibold text-foreground">
                  {new Date(subscription.periodEnd).toLocaleDateString("fr-FR")}
                </span>
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {subscription.generationCap === null
              ? "Générations IA illimitées."
              : `${subscription.generationsUsed} / ${subscription.generationCap} générations IA utilisées cette période.`}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {Object.values(PLANS).map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrentPlan={subscription?.active === true && subscription.plan === plan.id}
            isLoading={loadingPlan === plan.id}
            onSubscribe={() => handleSubscribe(plan.id)}
          />
        ))}
      </div>
    </div>
  );
}
