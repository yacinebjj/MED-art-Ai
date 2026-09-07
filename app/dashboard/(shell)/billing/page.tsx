"use client";

import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, CreditCard, Clock, BookOpenText, GraduationCap, Sparkles, Receipt } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MotionCard } from "@/components/ui/MotionCard";
import { RevealSection } from "@/components/ui/RevealSection";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { PLANS, getPlansForCycle, formatDZD, type PlanId, type BillingCycle } from "@/lib/pricing";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tSettings } from "@/lib/translations/settings";

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

// --- Usage Analytics: hardcoded zero-state (no backend yet) ---------------
// No real analytics backend exists yet for "hours studied" / "summaries
// generated" / "exams taken" aggregates. This USED to show fake positive
// placeholder numbers (42h/156/24) identical for every account, which read
// as fabricated usage history. Corrected to a realistic blank state — 0
// across the board, matching what an actual new account should show —
// instead of invented numbers. Still hardcoded: swap for a real query once
// that aggregation exists server-side.
const USAGE_METRICS = [
  { key: "hours", labelKey: "hoursStudiedLabel", value: "0h", icon: Clock },
  { key: "summaries", labelKey: "summariesGeneratedLabel", value: "0", icon: BookOpenText },
  { key: "exams", labelKey: "examsTakenLabel", value: "0", icon: GraduationCap },
] as const;

// --- Invoice history: hardcoded blank state (no backend yet) --------------
// No real "invoice history" endpoint exists yet — Chargily's checkout is
// redirect-based and doesn't hand this app invoice data to persist or
// query. This USED to render 3 fake invoice rows (the same fabricated
// "FAC-2025-000x" numbers/amounts shown to every single account), which
// misrepresented real payment history. Corrected to an honest empty list —
// the table below renders a proper "no invoices yet" empty state instead of
// fabricated rows. The typed shape is kept so wiring in a real per-user
// Supabase/Chargily query later is a drop-in change.
type InvoiceRecord = { id: string; date: string; status: "paid" | "failed"; amountDZD: number };
const INVOICES: InvoiceRecord[] = [];

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
  const { language } = useLanguage();

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const [cycle, setCycle] = useState<BillingCycle>("annual");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    fetch("/api/subscription")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSubscription(data.subscription);
      });

    return () => {
      cancelled = true;
    };
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{tSettings("subscriptionTitle", language)}</h1>
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

      <RevealSection>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Abonnement actuel — REAL subscription data (see /api/subscription), not mock. */}
          <Card className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h2 className="text-sm font-medium text-foreground">{tSettings("currentSubscription", language)}</h2>
              </div>
              <Badge variant="primary">{currentPlan.label}</Badge>
            </div>

            <p className="mt-4">
              <span className="text-2xl font-medium text-foreground">{formatDZD(currentPlan.priceDZD)}</span>
              <span className="text-xs text-muted-foreground"> / {formatBillingCycle(currentPlan.durationMonths)}</span>
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              {subscription?.active && subscription.effectivePlan === subscription.plan && subscription.periodEnd
                ? `Se renouvelle le ${formatFrenchDate(subscription.periodEnd)}`
                : subscription?.effectivePlan !== subscription?.plan && subscription
                  ? `Ta formule « ${subscription.planLabel} » a expiré — tu es repassé(e) en Freemium`
                  : "Formule gratuite — pas de renouvellement"}
            </p>

            <Button variant="outline" size="sm" className="mt-4 w-full sm:w-auto" onClick={() => setPlansOpen((v) => !v)}>
              {plansOpen ? tSettings("hidePlans", language) : tSettings("changeSubscription", language)}
            </Button>
          </Card>

          {/* Moyen de paiement — pas de carte enregistrée : le checkout
              Chargily est basé sur une redirection (pas de token de carte
              stocké), donc aucun "Terminant par XXXX" / "Expire MM/AAAA"
              réel n'existe jamais ici. Ces champs (convention de carte
              internationale Visa/Mastercard) étaient de faux exemples
              affichés à tous les comptes — retirés. Ne reste que le visuel
              (doré, en écho à "Edahabia" = "الذهبية", littéralement "la
              dorée") et le nom réel de la méthode acceptée, sans structure
              de gestion de carte internationale (pas de bouton "mettre à
              jour la carte" — il n'y a pas de carte stockée à mettre à jour). */}
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                <CreditCard className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-medium text-foreground">{tSettings("paymentMethod", language)}</h2>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-10 w-14 shrink-0 place-content-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-xs font-bold text-white shadow-sm">
                Edahabia
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-medium text-foreground">Edahabia / CIB</p>
                <p className="text-muted-foreground">via Chargily Pay</p>
              </div>
            </div>
          </Card>
        </div>
      </RevealSection>

      {plansOpen && (
        <RevealSection>
          <div className="flex justify-center">
            <BillingCycleToggle value={cycle} onChange={setCycle} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
            {getPlansForCycle(cycle).map((plan) => {
              const isCurrentPlan = subscription?.effectivePlan === plan.id;
              return (
                <PricingTierCard
                  key={plan.id}
                  plan={plan}
                  ctaSlot={
                    <Button
                      size="lg"
                      variant={isCurrentPlan ? "outline" : plan.featured ? "primary" : "outline"}
                      className="mt-6 w-full"
                      onClick={() => handleSubscribe(plan.id)}
                      isLoading={loadingPlan === plan.id}
                      disabled={loadingPlan !== null}
                    >
                      {isCurrentPlan ? "Renouveler" : "Souscrire"}
                    </Button>
                  }
                >
                  {/* No real per-tier gating exists yet server-side (multi-seat
                      Groupe invites, Promo Cohorte verification are both still
                      front-end previews — see app/pricing/page.tsx and its own
                      components) — a real Chargily charge happens here for
                      ANY of these 3 tiers regardless, so this is an honest
                      disclaimer rather than a fake interactive "verify" gate
                      that would just be theater in front of real money. */}
                  {plan.tier === "promo" && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                      Tarif réservé aux cohortes universitaires — une vérification de ton éligibilité pourra t&apos;être demandée.
                    </p>
                  )}
                </PricingTierCard>
              );
            })}
          </div>
        </RevealSection>
      )}

      {/* Historique des factures — pas encore d'intégration Chargily pour un
          historique réel par utilisateur. Affichait auparavant 3 fausses
          factures identiques pour tout le monde ("FAC-2025-000x", mêmes
          montants) ; remplacé par une liste vide honnête avec un message
          clair plutôt qu'un tableau silencieusement vide. Le rendu du
          tableau reste en place pour le jour où une vraie requête existera. */}
      <RevealSection delay={0.05}>
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
              <Receipt className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-medium text-foreground">{tSettings("invoiceHistory", language)}</h2>
          </div>

          {INVOICES.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
              <Receipt className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Aucune facture pour l'instant.</p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y-2 divide-border text-sm">
                <thead className="text-left">
                  <tr className="text-foreground">
                    <th className="whitespace-nowrap px-3 py-2 font-medium">{tSettings("invoiceColumn", language)}</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">{tSettings("dateColumn", language)}</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">{tSettings("statusColumn", language)}</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">{tSettings("amountColumn", language)}</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {INVOICES.map((invoice) => (
                    <tr key={invoice.id} className="text-foreground">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{invoice.id}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatFrenchDate(invoice.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge variant={invoice.status === "paid" ? "success" : "danger"}>
                          {invoice.status === "paid" ? tSettings("paidStatus", language) : tSettings("failedStatus", language)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {formatDZD(invoice.amountDZD)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button type="button" disabled title={tSettings("comingSoon", language)} className="font-medium text-muted-foreground underline underline-offset-2 opacity-50">
                          Télécharger
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </RevealSection>

      {/* Statistiques d'utilisation — USAGE_METRICS ci-dessus est un état
          vierge codé en dur (0 partout), pas un calcul Supabase réel ; voir
          aussi components/billing/UsageCharts.tsx (hors périmètre de ce
          fichier) qui a le même souci pour ses graphiques (STUDY_TIME_DATA /
          USAGE_BREAKDOWN_DATA, données positives inventées). */}
      <RevealSection>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{tSettings("usageStatsTitle", language)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Aucune activité enregistrée pour l'instant.</p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {USAGE_METRICS.map((metric, index) => (
              <RevealSection key={metric.key} delay={index * 0.08}>
                <MotionCard className="p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    <metric.icon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-3xl font-extrabold tracking-tight text-foreground">{metric.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{tSettings(metric.labelKey, language)}</p>
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
