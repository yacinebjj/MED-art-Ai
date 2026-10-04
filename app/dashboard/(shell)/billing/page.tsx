"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpenText, CalendarClock, CheckCircle2, CreditCard, Download, FileQuestion, Gauge, MessageSquare, Receipt, ShieldCheck, Sparkles, Stethoscope, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { CyberHeader, CyberPanel, CyberStage, NeonRing } from "@/components/cyber/primitives";
import { PLANS, getPlansForCycle, formatDZD, type PlanId, type BillingCycle } from "@/lib/pricing";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tSettings } from "@/lib/translations/settings";
import { cn } from "@/lib/utils";

interface SubscriptionInfo {
  plan: PlanId;
  planLabel: string;
  status: string;
  active: boolean;
  periodEnd: string | null;
  periodStart?: string | null;
  effectivePlan: PlanId;
  effectivePlanLabel: string;
  unlimitedThisPeriod: boolean;
  coursesUsed: number;
  courseCap: number;
  highlightMessagesUsed: number;
  highlightMessageCap: number;
  chatMessagesUsed?: number;
  chatMessageCap?: number;
  remediationUsed?: number;
  remediationCap?: number;
  examRegenerationsUsed?: number;
  examRegenerationCap?: number;
}

interface TrialInfo {
  active: boolean;
  daysRemaining: number;
  endsAt: string | null;
}

interface Invoice {
  id: string;
  reference: string;
  planId: string;
  planLabel: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "canceled";
  createdAt: string;
  paidAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatFrenchDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatBillingCycle(durationMonths: number): string {
  if (durationMonths === 1) return "mois";
  if (durationMonths === 12) return "an";
  return `${durationMonths} mois`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Builds a printable receipt (HTML file, "Imprimer → PDF") from a real paid payment row. */
function downloadReceipt(invoice: Invoice, email: string) {
  const rows: [string, string][] = [
    ["Référence Chargily", invoice.reference],
    ["Formule", invoice.planLabel],
    ["Montant", `${invoice.amount.toLocaleString("fr-FR")} ${invoice.currency}`],
    ["Moyen de paiement", "Edahabia / CIB via Chargily Pay"],
    ["Date du paiement", formatFrenchDate(invoice.paidAt ?? invoice.createdAt)],
    ["Compte", email],
  ];
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reçu MedArt AI — ${escapeHtml(invoice.reference)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#0f172a}
h1{font-size:22px;margin:0}.muted{color:#64748b;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:24px}
td{padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px}td:last-child{text-align:right;font-weight:600}
.badge{display:inline-block;margin-top:12px;padding:4px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:700}</style></head>
<body><h1>MedArt AI — Reçu de paiement</h1><p class="muted">Document récapitulatif généré depuis ton espace Abonnement.</p><span class="badge">Payé</span>
<table>${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</table>
<p class="muted" style="margin-top:24px">Pour obtenir un PDF : Fichier → Imprimer → Enregistrer au format PDF.</p></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `recu-medart-${invoice.reference}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Edahabia (gold, "الذهبية") and CIB payment-method chips — text badges, not logos. */
function PaymentMethodChips() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex h-9 items-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-600 px-3 text-xs font-black tracking-wide text-amber-950 shadow-[0_0_16px_rgba(245,158,11,0.35)]">
        EDAHABIA
      </span>
      <span className="inline-flex h-9 items-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-700 px-3 text-xs font-black tracking-wide text-white shadow-[0_0_16px_rgba(16,185,129,0.35)]">
        CIB
      </span>
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
        Paiement sécurisé en DZD · Chargily Pay
      </span>
    </div>
  );
}

function UsageGauge({ icon: Icon, label, used, cap, unlimited }: { icon: typeof Gauge; label: string; used: number; cap: number; unlimited: boolean }) {
  const ratio = unlimited || cap <= 0 ? 0 : Math.min(1, used / cap);
  const tone = ratio >= 0.9 ? "#fb7185" : ratio >= 0.7 ? "#fbbf24" : "#22d3ee";
  return (
    <CyberPanel className="flex items-center gap-4 p-4">
      <NeonRing value={ratio} size={64} stroke={6} from={tone} to="#8b5cf6" glow={ratio > 0} aria-label={`${label} : ${used} / ${unlimited ? "illimité" : cap}`}>
        <Icon className="h-5 w-5 text-cyan-300" />
      </NeonRing>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
        <p className="mt-1 text-xl font-black tabular-nums text-white">
          {used}
          <span className="text-sm font-semibold text-slate-500"> / {unlimited ? "∞" : cap}</span>
        </p>
        <p className="text-[11px] text-slate-500">{unlimited ? "Illimité pendant l'essai" : cap > 0 ? `${Math.max(0, cap - used)} restant${cap - used > 1 ? "s" : ""}` : "Non inclus"}</p>
      </div>
    </CyberPanel>
  );
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
  const { language } = useLanguage();

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
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
        if (cancelled) return;
        setSubscription(data.subscription ?? null);
        setTrial(data.trial ?? null);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    fetch("/api/billing/invoices")
      .then((res) => res.json())
      .then((data) => !cancelled && setInvoices(Array.isArray(data?.invoices) ? data.invoices : []))
      .catch(() => !cancelled && setInvoices([]));
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
      if (!res.ok) throw new Error(data.error ?? "Impossible de créer le paiement.");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer le paiement.");
      setLoadingPlan(null);
    }
  }

  const currentPlanId = subscription?.effectivePlan ?? "freemium";
  const currentPlan = PLANS[currentPlanId];
  const isPaidActive = Boolean(subscription?.active && subscription.effectivePlan === subscription.plan && subscription.periodEnd);
  const unlimited = Boolean(subscription?.unlimitedThisPeriod || trial?.active);

  // Countdown to renewal (paid) or to the end of the trial — real dates only.
  const countdown = useMemo(() => {
    if (isPaidActive && subscription?.periodEnd) {
      const end = new Date(subscription.periodEnd).getTime();
      const start = subscription.periodStart ? new Date(subscription.periodStart).getTime() : end - currentPlan.durationMonths * 30 * DAY_MS;
      const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
      const ratio = end > start ? Math.min(1, Math.max(0, (end - Date.now()) / (end - start))) : 0;
      return { daysLeft, ratio, label: `Renouvellement le ${formatFrenchDate(subscription.periodEnd)}` };
    }
    if (trial?.active) {
      return { daysLeft: trial.daysRemaining, ratio: Math.min(1, trial.daysRemaining / 7), label: trial.endsAt ? `Essai jusqu'au ${formatFrenchDate(trial.endsAt)}` : "Essai en cours" };
    }
    return null;
  }, [isPaidActive, subscription, trial, currentPlan.durationMonths]);

  const statusBadge = isPaidActive
    ? { label: "Actif · payé", variant: "success" as const }
    : trial?.active
      ? { label: "Essai illimité", variant: "primary" as const }
      : subscription && subscription.effectivePlan !== subscription.plan
        ? { label: "Expiré", variant: "danger" as const }
        : { label: "Gratuit", variant: "outline" as const };

  return (
    <CyberStage className="mx-auto max-w-5xl overflow-x-clip p-4 sm:p-6 lg:p-8">
      <CyberHeader
        icon={CreditCard}
        kicker="Cockpit abonnement"
        title={tSettings("subscriptionTitle", language)}
        subtitle="Paiement sécurisé en DZD via Edahabia (Algérie Poste) ou carte CIB, propulsé par Chargily Pay."
      />

      <div className="mt-6 space-y-4">
        {status === "success" && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Paiement reçu ! Ton abonnement sera activé dans quelques instants (confirmation automatique).
          </div>
        )}
        {status === "failure" && (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />
            Le paiement a échoué ou a été annulé. Aucun montant n&apos;a été débité.
          </div>
        )}
        {error && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
      </div>

      {/* ── Status + countdown ─────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <CyberPanel laser="spin" accent={isPaidActive ? "emerald" : "cyan"} className="p-5 sm:p-6">
          {!loaded ? (
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
          ) : (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <NeonRing value={countdown?.ratio ?? 0} size={128} stroke={10} ticks={40} from={isPaidActive ? "#34d399" : "#22d3ee"} to="#8b5cf6" aria-label={countdown ? `${countdown.daysLeft} jours restants` : "Formule gratuite"}>
                <span className="text-3xl font-black tabular-nums text-white">{countdown ? countdown.daysLeft : "—"}</span>
                <span className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">{countdown ? "jours" : "sans échéance"}</span>
              </NeonRing>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="cyber-kicker">{tSettings("currentSubscription", language)}</p>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>
                <p className="mt-2 text-2xl font-black text-white">{currentPlan.label}</p>
                <p className="mt-1 text-sm text-slate-300">
                  <b className="text-white">{formatDZD(currentPlan.priceDZD)}</b> / {formatBillingCycle(currentPlan.durationMonths)}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                  <CalendarClock className="h-3.5 w-3.5 text-cyan-300" />
                  {countdown
                    ? countdown.label
                    : subscription && subscription.effectivePlan !== subscription.plan
                      ? `Ta formule « ${subscription.planLabel} » a expiré — tu es repassé(e) en Freemium`
                      : "Formule gratuite — pas de renouvellement"}
                </p>
                <Button variant="outline" size="sm" className="mt-4 w-full sm:w-auto" onClick={() => setPlansOpen((v) => !v)}>
                  {plansOpen ? tSettings("hidePlans", language) : tSettings("changeSubscription", language)}
                </Button>
              </div>
            </div>
          )}
        </CyberPanel>

        <CyberPanel className="p-5 sm:p-6">
          <p className="cyber-kicker flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            {tSettings("paymentMethod", language)}
          </p>
          <p className="mt-2 text-sm text-slate-300">Aucune carte n&apos;est enregistrée : chaque paiement passe par la page sécurisée Chargily.</p>
          <div className="mt-4">
            <PaymentMethodChips />
          </div>
        </CyberPanel>
      </div>

      {plansOpen && (
        <div className="mt-6">
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
                  {plan.tier === "promo" && (
                    <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      Tarif réservé aux cohortes universitaires — une vérification de ton éligibilité pourra t&apos;être demandée.
                    </p>
                  )}
                </PricingTierCard>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Real quota gauges ──────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-black text-white">
          <Gauge className="h-5 w-5 text-cyan-300" />
          {tSettings("usageStatsTitle", language)}
        </h2>
        <p className="mt-1 text-xs text-slate-400">Compteurs réels de ta période en cours (remis à zéro chaque mois).</p>
        {!loaded ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-3xl bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <UsageGauge icon={BookOpenText} label="Cours générés" used={subscription?.coursesUsed ?? 0} cap={subscription?.courseCap ?? currentPlan.courseCap} unlimited={unlimited} />
            <UsageGauge icon={Sparkles} label="Questions sur sélection" used={subscription?.highlightMessagesUsed ?? 0} cap={subscription?.highlightMessageCap ?? currentPlan.highlightMessageCap} unlimited={unlimited} />
            <UsageGauge icon={MessageSquare} label="Messages assistant" used={subscription?.chatMessagesUsed ?? 0} cap={subscription?.chatMessageCap ?? currentPlan.chatMessageCap} unlimited={unlimited} />
            <UsageGauge icon={Stethoscope} label="Plans de remédiation" used={subscription?.remediationUsed ?? 0} cap={subscription?.remediationCap ?? currentPlan.remediationCap} unlimited={unlimited} />
            <UsageGauge icon={FileQuestion} label="Régénérations d'examen" used={subscription?.examRegenerationsUsed ?? 0} cap={subscription?.examRegenerationCap ?? 5} unlimited={false} />
          </div>
        )}
      </div>

      {/* ── Invoices (real Chargily payments) ──────────────────────────── */}
      <CyberPanel className="mt-8 p-5 sm:p-6">
        <p className="cyber-kicker flex items-center gap-1.5">
          <Receipt className="h-3.5 w-3.5" />
          {tSettings("invoiceHistory", language)}
        </p>
        {invoices === null ? (
          <div className="mt-4 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
            <Receipt className="h-7 w-7 text-slate-500" />
            <p className="text-sm text-slate-400">Aucun paiement pour l&apos;instant.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{invoice.planLabel}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {formatFrenchDate(invoice.createdAt)} · réf. {invoice.reference}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-sm font-black tabular-nums text-white">
                    {invoice.amount.toLocaleString("fr-FR")} {invoice.currency}
                  </span>
                  <Badge variant={invoice.status === "paid" ? "success" : invoice.status === "pending" ? "outline" : "danger"}>
                    {invoice.status === "paid" ? tSettings("paidStatus", language) : invoice.status === "pending" ? "En attente" : invoice.status === "canceled" ? "Annulé" : tSettings("failedStatus", language)}
                  </Badge>
                  <button
                    type="button"
                    disabled={invoice.status !== "paid"}
                    onClick={() => downloadReceipt(invoice, user?.email ?? "")}
                    className={cn(
                      "flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors",
                      invoice.status === "paid" ? "border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10" : "cursor-not-allowed border-white/10 text-slate-600"
                    )}
                    title={invoice.status === "paid" ? "Télécharger le reçu" : "Reçu disponible une fois le paiement confirmé"}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Reçu
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CyberPanel>
    </CyberStage>
  );
}
