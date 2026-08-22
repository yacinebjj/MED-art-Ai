"use client";

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, CreditCard, Clock, BookOpenText, GraduationCap } from "lucide-react";
import { PlanCard } from "@/components/billing/PlanCard";
import { Card } from "@/components/ui/Card";
import { MotionCard } from "@/components/ui/MotionCard";
import { RevealSection } from "@/components/ui/RevealSection";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PLANS, type PlanId } from "@/lib/pricing";
import { useAuth } from "@/providers/AuthProvider";

// ssr: false — see UsageCharts.tsx's own comment: recharts crashes
// ("document is not defined") under Next's server-render pass, so this
// chart pair is skipped during SSR and only ever rendered client-side.
const UsageCharts = dynamic(() => import("@/components/billing/UsageCharts").then((m) => m.UsageCharts), {
  ssr: false,
  loading: () => (
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      <div className="h-80 animate-pulse rounded-2xl bg-muted" />
    </div>
  ),
});

interface SubscriptionInfo {
  plan: PlanId;
  planLabel: string;
  status: string;
  active: boolean;
  periodEnd: string | null;
  effectivePlan: PlanId;
  effectivePlanLabel: string;
  unlimitedThisPeriod: boolean;
  coursesUsed: number;
  courseCap: number;
  highlightMessagesUsed: number;
  highlightMessageCap: number;
}

/** Mirrors PlanCard's own formatBillingPeriod convention — kept in sync manually since that one isn't exported. */
function formatBillingCycle(durationMonths: number): string {
  if (durationMonths === 1) return "facturé mensuellement";
  if (durationMonths === 12) return "facturé annuellement";
  return `facturé tous les ${durationMonths} mois`;
}

function formatFrenchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// --- Usage Analytics: mock data ------------------------------------------
// No real analytics backend exists yet for "hours studied" / "summaries
// generated" / "exams taken" aggregates — these are illustrative placeholder
// numbers so the section's shape/design can ship now, swapped for a real
// query once that aggregation exists server-side.
const USAGE_METRICS = [
  { key: "hours", label: "Heures d'étude", value: "42h", icon: Clock },
  { key: "summaries", label: "Résumés générés", value: "156", icon: BookOpenText },
  { key: "exams", label: "Examens passés", value: "24", icon: GraduationCap },
];

// --- Payment method + invoice history: mock data --------------------------
// No real "saved card" or "invoice history" endpoint exists yet — Chargily's
// checkout is redirect-based and doesn't hand this app stored-card or
// invoice data to persist. Shown as clearly-labeled example content (see the
// "Aperçu" notes below each card) rather than pretending it's real, until a
// real Chargily invoice-history integration exists.
const MOCK_INVOICES = [
  { id: "FAC-2025-0006", date: "2025-06-01", status: "paid" as const, amountDZD: 1300 },
  { id: "FAC-2025-0005", date: "2025-05-01", status: "paid" as const, amountDZD: 1300 },
  { id: "FAC-2025-0004", date: "2025-04-01", status: "failed" as const, amountDZD: 1300 },
];

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
  const [plansOpen, setPlansOpen] = useState(false);

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

  const currentPlanId = subscription?.effectivePlan ?? "freemium";
  const currentPlan = PLANS[currentPlanId];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Abonnement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paiement sécurisé en DZD via Edahabia (Algérie Poste) ou carte CIB, propulsé par Chargily Pay.
        </p>
      </div>

      {status === "success" && (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Paiement reçu ! Ton abonnement sera activé dans quelques instants (confirmation automatique).
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Abonnement actuel — REAL subscription data (see /api/subscription), not mock. */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Abonnement actuel</h2>
            <Badge variant="primary">{currentPlan.label}</Badge>
          </div>

          <p className="mt-4">
            <span className="text-2xl font-medium text-foreground">{currentPlan.priceDZD.toLocaleString("fr-FR")} DZD</span>
            <span className="text-xs text-muted-foreground"> / {formatBillingCycle(currentPlan.durationMonths)}</span>
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            {subscription?.active && subscription.effectivePlan === subscription.plan && subscription.periodEnd
              ? `Se renouvelle le ${formatFrenchDate(subscription.periodEnd)}`
              : subscription?.effectivePlan !== subscription?.plan && subscription
                ? `Ta formule « ${subscription.planLabel} » a expiré — tu es repassé(e) en Freemium`
                : "Formule gratuite — pas de renouvellement"}
          </p>

          <Button variant="outline" size="sm" className="mt-4" onClick={() => setPlansOpen((v) => !v)}>
            {plansOpen ? "Masquer les formules" : "Changer d'abonnement"}
          </Button>
        </Card>

        {/* Moyen de paiement — Aperçu: aucune API Chargily ne renvoie encore
            de carte enregistrée à cette app (son checkout est basé sur une
            redirection, pas un token de carte stocké) — étiqueté clairement
            comme aperçu plutôt que présenté comme une vraie carte liée. */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Moyen de paiement</h2>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Aperçu</span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-10 w-14 shrink-0 place-content-center rounded-lg bg-gradient-to-br from-primary-500 to-secondary-600 text-xs font-bold text-white shadow-sm">
              Edahabia
            </span>
            <div className="text-sm">
              <p className="font-medium text-foreground">Terminant par 4589</p>
              <p className="text-muted-foreground">Expire 10/2028</p>
            </div>
          </div>

          <Button variant="outline" size="sm" className="mt-4" disabled title="Bientôt disponible">
            <CreditCard className="h-3.5 w-3.5" />
            Mettre à jour la carte
          </Button>
        </Card>
      </div>

      {plansOpen && (
        <RevealSection>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Object.values(PLANS).map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrentPlan={subscription?.effectivePlan === plan.id}
                isLoading={loadingPlan === plan.id}
                onSubscribe={() => handleSubscribe(plan.id)}
              />
            ))}
          </div>
        </RevealSection>
      )}

      {/* Historique des factures — Aperçu: pas encore d'intégration
          Chargily pour l'historique réel des factures, données d'exemple. */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Historique des factures</h2>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Aperçu</span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y-2 divide-border">
            <thead className="text-left">
              <tr className="text-foreground">
                <th className="whitespace-nowrap px-3 py-2 font-medium">Facture</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Date</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Statut</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Montant</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MOCK_INVOICES.map((invoice) => (
                <tr key={invoice.id} className="text-foreground">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{invoice.id}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatFrenchDate(invoice.date)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge variant={invoice.status === "paid" ? "success" : "danger"}>
                      {invoice.status === "paid" ? "Payé" : "Échoué"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {invoice.amountDZD.toLocaleString("fr-FR")} DZD
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" disabled title="Bientôt disponible" className="font-medium text-muted-foreground underline underline-offset-2 opacity-50">
                      Télécharger
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Statistiques d'utilisation — mock data, see USAGE_METRICS/
          STUDY_TIME_DATA/USAGE_BREAKDOWN_DATA above for why. */}
      <RevealSection>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Statistiques d'utilisation</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aperçu — exemple de données, en attendant l'agrégation réelle.</p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {USAGE_METRICS.map((metric, index) => (
              <RevealSection key={metric.key} delay={index * 0.08}>
                <MotionCard className="p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    <metric.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">{metric.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{metric.label}</p>
                </MotionCard>
              </RevealSection>
            ))}
          </div>

          <UsageCharts />
        </div>
      </RevealSection>
    </div>
  );
}
