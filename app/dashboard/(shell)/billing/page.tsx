"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  AudioLines,
  BookOpenText,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  FileQuestion,
  Gauge,
  Infinity as InfinityIcon,
  Layers,
  Lock,
  MessageSquare,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Undo2,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PlanCard, planActionKey, type PlanAction } from "@/components/billing/PlanCard";
import { CyberHeader, CyberPanel, CyberStage, NeonRing } from "@/components/cyber/primitives";
import { FREE_TRIAL, PLANS, REFUND_DELAY_LABEL, getPlansForCycle, formatDZD, type PlanId, type BillingCycle } from "@/lib/pricing";
import type { UsageSnapshot } from "@/lib/subscription";
import type { PoolView } from "@/lib/billing-pools";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tSettings } from "@/lib/translations/settings";
import { cn } from "@/lib/utils";
import { AUDIO_SMART_NOTES_ENABLED } from "@/lib/feature-flags";

interface SubscriptionInfo {
  plan: PlanId;
  planLabel: string;
  status: string;
  active: boolean;
  periodEnd: string | null;
  periodStart?: string | null;
  effectivePlan: PlanId;
  effectivePlanLabel: string;
}

interface SubscriptionResponse {
  subscription?: SubscriptionInfo | null;
  freeTrial?: { courses: number; messages: number };
  usage?: UsageSnapshot | null;
  isAdmin?: boolean;
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

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" && data.error ? data.error : fallback;
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

// ─── « Ta consommation » ─────────────────────────────────────────────────

function UsageBar({
  icon: Icon,
  label,
  used,
  cap,
  caption,
  hint,
  lockedText,
}: {
  icon: typeof Gauge;
  label: string;
  used: number;
  cap: number;
  caption: string;
  hint?: string;
  /** Shown instead of the bar when the feature is not part of the current plan (cap 0). */
  lockedText?: string;
}) {
  const locked = cap <= 0;
  const ratio = locked ? 0 : Math.min(1, used / cap);
  const remaining = Math.max(0, cap - used);
  const tone = ratio >= 1 ? "bg-rose-400" : ratio >= 0.8 ? "bg-amber-400" : "bg-gradient-to-r from-cyan-400 to-violet-500";

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
          <Icon className="h-4 w-4 shrink-0 text-cyan-300" />
          <span className="truncate">{label}</span>
        </p>
        {locked ? (
          <Lock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        ) : (
          <p className="shrink-0 text-sm font-black tabular-nums text-white">
            {used}
            <span className="text-xs font-semibold text-slate-500"> / {cap}</span>
          </p>
        )}
      </div>
      {locked ? (
        <p className="mt-3 text-xs text-slate-400">{lockedText ?? "Non inclus dans ta formule"}</p>
      ) : (
        <>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={cap}
            aria-valuenow={Math.min(used, cap)}
          >
            <div className={cn("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {remaining > 0 ? `${remaining} restant${remaining > 1 ? "s" : ""}` : "Limite atteinte"} · {caption}
          </p>
        </>
      )}
      {hint && <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

function UsagePanel({ usage, loaded }: { usage: UsageSnapshot | null; loaded: boolean }) {
  if (!loaded) {
    return (
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
        ))}
      </div>
    );
  }
  if (!usage) {
    return <p className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">Ta consommation n&apos;est pas disponible pour le moment. Réessaie dans un instant.</p>;
  }

  const trial = usage.isTrial;
  const lockedPaid = "Inclus dans les formules payantes";

  return (
    <>
      <div className="mt-3 flex flex-col gap-1 text-xs text-slate-400">
        {trial ? (
          <p className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
            Essai unique : {FREE_TRIAL.courses} cours + {FREE_TRIAL.messages} messages offerts. Ces compteurs ne se renouvellent pas.
          </p>
        ) : (
          <>
            {usage.monthResetsAt && (
              <p className="flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                Compteurs du mois remis à zéro le <b className="text-slate-200">{formatFrenchDate(usage.monthResetsAt)}</b>
              </p>
            )}
            <p className="flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
              Messages premium et Audio : remis à zéro chaque jour
            </p>
            {usage.periodEnd && (
              <p className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                Fin de ta période : <b className="text-slate-200">{formatFrenchDate(usage.periodEnd)}</b>
              </p>
            )}
          </>
        )}
        {!usage.enforced && <p className="text-slate-500">Les compteurs sont en cours d&apos;activation : les limites ne sont pas encore appliquées.</p>}
      </div>

      {trial && usage.trialExhausted && (
        <div className="mt-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Ton essai gratuit est terminé. Choisis une formule ci-dessus pour continuer — dès {formatDZD(PLANS.promo_monthly.priceDZD)} par personne et par mois avec le {PLANS.promo_monthly.label}.
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UsageBar
          icon={BookOpenText}
          label="Cours créés"
          used={usage.courses.used}
          cap={usage.courses.cap}
          caption={usage.courses.lifetime ? "essai, à vie" : "ce mois-ci"}
          hint="Un cours supprimé ne rend pas le crédit."
        />
        <UsageBar
          icon={MessageSquare}
          label={usage.messages.perDay ? "Messages IA premium" : "Messages Assistant / Copilot"}
          used={usage.messages.used}
          cap={usage.messages.cap}
          caption={usage.messages.perDay ? "aujourd'hui" : "essai, à vie"}
          hint={usage.messages.perDay ? "Au-delà, bascule automatique sur le modèle standard — tu n'es jamais bloqué(e)." : undefined}
        />
        <UsageBar icon={FileQuestion} label="Examens de module" used={usage.exams.used} cap={usage.exams.cap} caption="ce mois-ci" lockedText={trial ? lockedPaid : undefined} />
        <UsageBar
          icon={Layers}
          label="Résumés de module"
          used={usage.syntheses.used}
          cap={usage.syntheses.cap}
          caption="ce mois-ci"
          hint="Chaque génération Résumé, Mots-clés ou Dictionnaire compte pour 1."
          lockedText={trial ? lockedPaid : undefined}
        />
        {AUDIO_SMART_NOTES_ENABLED && (
          <>
            <UsageBar
              icon={AudioLines}
              label="Audio → Smart Notes (jour)"
              used={usage.audio.usedToday}
              cap={usage.audio.capPerDay}
              caption="aujourd'hui"
              lockedText={trial ? lockedPaid : undefined}
            />
            <UsageBar
              icon={AudioLines}
              label="Audio → Smart Notes (mois)"
              used={usage.audio.usedThisMonth}
              cap={usage.audio.capPerMonth}
              caption="ce mois-ci"
              lockedText={trial ? lockedPaid : undefined}
            />
          </>
        )}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
        <InfinityIcon className="h-4 w-4 shrink-0 text-emerald-300" />
        Flashcards, To-Do et Notes : illimités.
      </p>
    </>
  );
}

// ─── « Tes groupes » ─────────────────────────────────────────────────────

function poolStatusBadge(pool: PoolView): { label: string; variant: "success" | "primary" | "danger" | "warning" | "outline" } {
  if (pool.me.refund?.status === "pending") return { label: "Remboursement en cours", variant: "warning" };
  if (pool.me.refund?.status === "refunded") return { label: "Remboursé", variant: "outline" };
  if (pool.status === "complete") return { label: "Actif", variant: "success" };
  if (pool.status === "expired") return { label: "Expiré", variant: "danger" };
  return { label: pool.mode === "leader" ? "Places à distribuer" : "En attente des membres", variant: "primary" };
}

function PoolItem({ pool, copied, onCopy }: { pool: PoolView; copied: boolean; onCopy: (code: string) => void }) {
  const badge = poolStatusBadge(pool);
  const ratio = pool.size > 0 ? Math.min(1, pool.confirmed / pool.size) : 0;
  const kindLabel = `Groupe de ${pool.size}`;
  const modeLabel = pool.mode === "leader" ? "payé en une fois" : "chacun paie sa part";

  return (
    <li className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Users className="h-4 w-4 shrink-0 text-cyan-300" />
            {kindLabel}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {pool.planLabel} · {modeLabel} · {formatDZD(pool.pricePerMember)} / pers.
          </p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`${kindLabel} : ${pool.confirmed} sur ${pool.size}`} aria-valuemin={0} aria-valuemax={pool.size} aria-valuenow={pool.confirmed}>
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", pool.status === "complete" ? "bg-emerald-400" : "bg-gradient-to-r from-cyan-400 to-violet-500")}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <span className="shrink-0 text-sm font-black tabular-nums text-white">
          {pool.confirmed}/{pool.size}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-slate-400">
        {pool.status === "open" && pool.mode === "pooled" && `L'abonnement démarre pour tous à ${pool.size}/${pool.size}. Date limite : ${formatFrenchDate(pool.expiresAt)}.`}
        {pool.status === "open" && pool.mode === "leader" && `Tes amis activent leur place avec ton code.`}
        {pool.status === "complete" && (pool.periodEnd ? `Actif jusqu'au ${formatFrenchDate(pool.periodEnd)}.` : "Actif pour tous les membres.")}
        {pool.status === "expired" && "Le groupe n'a pas été complété à temps."}
      </p>
      {pool.me.refund && (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-200">
          <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {pool.me.refund.status === "pending"
            ? `Remboursement de ${formatDZD(pool.me.refund.amount)} déclenché automatiquement, reçu sous ${REFUND_DELAY_LABEL}.`
            : `Remboursement de ${formatDZD(pool.me.refund.amount)} envoyé${pool.me.refund.refundedAt ? ` le ${formatFrenchDate(pool.me.refund.refundedAt)}` : ""}.`}
        </p>
      )}

      {pool.mode === "leader" && pool.isCreator && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs text-slate-400">
            Code d&apos;invitation : <span className="break-all font-mono text-sm font-bold tracking-wider text-white">{pool.code}</span>
          </p>
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onCopy(pool.code)}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Lien copié" : "Copier le lien d'invitation"}
          </Button>
        </div>
      )}

      <Link href={`/dashboard/billing/pool/${encodeURIComponent(pool.code)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-cyan-300 hover:text-cyan-200">
        Suivre ce groupe
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </li>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function BillingPage() {
  return (
    <Suspense>
      <BillingPageContent />
    </Suspense>
  );
}

function BillingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const { user } = useAuth();
  const { language } = useLanguage();

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [pools, setPools] = useState<PoolView[] | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plansOpenOverride, setPlansOpenOverride] = useState<boolean | null>(null);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch("/api/subscription")
      .then((res) => res.json() as Promise<SubscriptionResponse>)
      .then((data) => {
        if (cancelled) return;
        setSubscription(data.subscription ?? null);
        setUsage(data.usage ?? null);
        setIsAdmin(data.isAdmin === true);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    fetch("/api/billing/invoices")
      .then((res) => res.json())
      .then((data: { invoices?: unknown }) => !cancelled && setInvoices(Array.isArray(data?.invoices) ? (data.invoices as Invoice[]) : []))
      .catch(() => !cancelled && setInvoices([]));
    fetch("/api/billing/pools")
      .then((res) => res.json())
      .then((data: { success?: boolean; pools?: unknown }) => !cancelled && setPools(data?.success && Array.isArray(data.pools) ? (data.pools as PoolView[]) : []))
      .catch(() => !cancelled && setPools([]));
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleAction(action: PlanAction) {
    if (!user || loadingKey) return;
    setError(null);
    setLoadingKey(planActionKey(action));
    try {
      if (action.type === "pool") {
        const res = await fetch("/api/billing/pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: action.kind, cycle: action.cycle }),
        });
        if (!res.ok) throw new Error(await readError(res, "Impossible de créer le groupe pour le moment."));
        const data = (await res.json()) as { success?: boolean; code?: unknown; error?: unknown };
        if (!data.success || typeof data.code !== "string") throw new Error(typeof data.error === "string" ? data.error : "Impossible de créer le groupe pour le moment.");
        router.push(`/dashboard/billing/pool/${encodeURIComponent(data.code)}`);
        return;
      }
      const res = await fetch("/api/chargily/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.type === "leader" ? { plan: action.plan, mode: "leader" } : { plan: action.plan }),
      });
      if (!res.ok) throw new Error(await readError(res, "Impossible de créer le paiement."));
      const data = (await res.json()) as { checkoutUrl?: unknown };
      if (typeof data.checkoutUrl !== "string") throw new Error("Impossible de créer le paiement.");
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer le paiement.");
      setLoadingKey(null);
    }
  }

  async function copyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${encodeURIComponent(code)}`);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 1800);
    } catch {
      setError("Copie impossible sur cet appareil — recopie le code affiché.");
    }
  }

  const currentPlanId = subscription?.effectivePlan ?? "freemium";
  const currentPlan = PLANS[currentPlanId];
  const isPaidActive = Boolean(subscription?.active && subscription.effectivePlan === subscription.plan && subscription.periodEnd);
  const isExpired = Boolean(subscription && subscription.effectivePlan !== subscription.plan);
  const plansOpen = plansOpenOverride ?? (loaded && !isPaidActive);
  const trialMessagesLeft = usage?.isTrial ? Math.max(0, usage.messages.cap - usage.messages.used) : null;

  const countdown = useMemo(() => {
    if (!isPaidActive || !subscription?.periodEnd) return null;
    const end = new Date(subscription.periodEnd).getTime();
    const start = subscription.periodStart ? new Date(subscription.periodStart).getTime() : end - currentPlan.durationMonths * 30 * DAY_MS;
    const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
    const ratio = end > start ? Math.min(1, Math.max(0, (end - Date.now()) / (end - start))) : 0;
    return { daysLeft, ratio, label: `Fin de période le ${formatFrenchDate(subscription.periodEnd)}` };
  }, [isPaidActive, subscription, currentPlan.durationMonths]);

  const statusBadge = isPaidActive
    ? { label: "Actif · payé", variant: "success" as const }
    : isExpired
      ? { label: "Expiré", variant: "danger" as const }
      : usage?.isTrial && usage.trialExhausted
        ? { label: "Essai terminé", variant: "warning" as const }
        : usage?.isTrial
          ? { label: "Essai gratuit", variant: "primary" as const }
          : { label: "Gratuit", variant: "outline" as const };

  const ringValue = countdown ? countdown.ratio : trialMessagesLeft !== null && usage ? (usage.messages.cap > 0 ? trialMessagesLeft / usage.messages.cap : 0) : 0;
  const plansForCycle = getPlansForCycle(cycle);

  return (
    <CyberStage className="mx-auto max-w-5xl overflow-x-clip p-4 sm:p-6 lg:p-8">
      <CyberHeader
        icon={CreditCard}
        kicker="Ton abonnement"
        title={tSettings("subscriptionTitle", language)}
        subtitle="Paiement sécurisé en DZD via Edahabia (Algérie Poste) ou carte CIB, propulsé par Chargily Pay."
        actions={
          isAdmin ? (
            <Link href="/dashboard/admin/refunds" className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/10 hover:text-white">
              <Undo2 className="h-3.5 w-3.5" />
              Remboursements (admin)
            </Link>
          ) : undefined
        }
      />

      <div className="mt-6 space-y-4">
        {status === "success" && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Paiement reçu ! Ton abonnement sera activé dans quelques instants (confirmation automatique). Si tu as payé pour un Groupe, ton code
              d&apos;invitation apparaît dans « Tes groupes ».
            </span>
          </div>
        )}
        {status === "failure" && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Le paiement a échoué ou a été annulé. Aucun montant n&apos;a été débité.
          </div>
        )}
        {error && !plansOpen && <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
      </div>

      {/* ── Status ─────────────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <CyberPanel laser="spin" accent={isPaidActive ? "emerald" : "cyan"} className="p-5 sm:p-6">
          {!loaded ? (
            <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
          ) : (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <NeonRing
                value={ringValue}
                size={128}
                stroke={10}
                ticks={40}
                from={isPaidActive ? "#34d399" : "#22d3ee"}
                to="#8b5cf6"
                aria-label={countdown ? `${countdown.daysLeft} jours restants` : trialMessagesLeft !== null ? `${trialMessagesLeft} messages offerts restants` : "Formule gratuite"}
              >
                <span className="text-3xl font-black tabular-nums text-white">{countdown ? countdown.daysLeft : trialMessagesLeft ?? "—"}</span>
                <span className="mt-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">{countdown ? "jours" : trialMessagesLeft !== null ? "messages" : "sans échéance"}</span>
              </NeonRing>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="cyber-kicker">{tSettings("currentSubscription", language)}</p>
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                </div>
                <p className="mt-2 text-2xl font-black text-white">{currentPlan.label}</p>
                <p className="mt-1 text-sm text-slate-300">
                  {currentPlanId === "freemium" ? (
                    <>
                      {FREE_TRIAL.courses} cours + {FREE_TRIAL.messages} messages offerts, une seule fois
                    </>
                  ) : (
                    <>
                      <b className="text-white">{formatDZD(currentPlan.priceDZD)}</b>
                      {currentPlan.seats > 1 ? " / personne" : ""} / {formatBillingCycle(currentPlan.durationMonths)}
                    </>
                  )}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                  {countdown
                    ? `${countdown.label} — sans renouvellement automatique`
                    : isExpired && subscription
                      ? `Ta formule « ${subscription.planLabel} » a expiré`
                      : "Aucun paiement enregistré, aucun prélèvement automatique"}
                </p>
                <Button variant="outline" size="sm" className="mt-4 w-full sm:w-auto" onClick={() => setPlansOpenOverride(!plansOpen)}>
                  {plansOpen ? tSettings("hidePlans", language) : isPaidActive ? tSettings("changeSubscription", language) : "Voir les formules"}
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

      {/* ── Plan picker ────────────────────────────────────────────────── */}
      {plansOpen && (
        <section className="mt-8" aria-labelledby="billing-plans-title">
          <h2 id="billing-plans-title" className="text-center text-lg font-black text-white">
            Choisis ta formule
          </h2>
          <div className="mt-4 flex justify-center">
            <BillingCycleToggle value={cycle} onChange={setCycle} />
          </div>
          {error && <div className="mt-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
            {plansForCycle.map((plan) => (
              <PlanCard key={plan.id} plan={plan} isCurrentPlan={isPaidActive && subscription?.effectivePlan === plan.id} loadingKey={loadingKey} onAction={handleAction} />
            ))}
          </div>
          <p className="mt-4 text-center text-[11px] text-slate-500">Aucun renouvellement automatique : tu paies une fois pour la durée choisie, puis tu décides.</p>
        </section>
      )}

      {/* ── Ta consommation ────────────────────────────────────────────── */}
      <CyberPanel className="mt-8 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-black text-white">
          <Gauge className="h-5 w-5 text-cyan-300" />
          Ta consommation
        </h2>
        <UsagePanel usage={usage} loaded={loaded} />
      </CyberPanel>

      {/* ── Tes groupes ────────────────────────────────────────────────── */}
      <CyberPanel className="mt-8 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-black text-white">
          <Users className="h-5 w-5 text-cyan-300" />
          Tes groupes
        </h2>
        <p className="mt-1 text-xs text-slate-400">Tes formules {PLANS.group_monthly.label} et {PLANS.promo_monthly.label}, et où en est chaque jauge.</p>
        {pools === null ? (
          <div className="mt-4 space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </div>
        ) : pools.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
            <Users className="h-7 w-7 text-slate-500" />
            <p className="text-sm text-slate-400">Aucun groupe pour l&apos;instant. Choisis un {PLANS.group_monthly.label} ou un {PLANS.promo_monthly.label} pour réviser à plusieurs, moins cher.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {pools.map((pool) => (
              <PoolItem key={pool.code} pool={pool} copied={copiedCode === pool.code} onCopy={copyInvite} />
            ))}
          </ul>
        )}
      </CyberPanel>

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
