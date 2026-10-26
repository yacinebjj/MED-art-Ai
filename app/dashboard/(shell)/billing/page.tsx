"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Hourglass,
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
import { PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE, PAYMENT_INTERRUPTED_MESSAGE } from "@/lib/payment-messages";

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

/** No answer from our checkout route by then (it gives Chargily 20 s): the gateway is stalling — say so instead of spinning. */
const CHECKOUT_REQUEST_TIMEOUT_MS = 35_000;
/** Back from Chargily with ?status=success: ask every 5 s, for up to 2 minutes, until the payment is confirmed. */
const CONFIRM_POLL_MS = 5000;
const CONFIRM_POLL_MAX_MS = 2 * 60 * 1000;
/**
 * Set right before leaving for Chargily. Coming back WITHOUT ?status= (its page
 * stalled on a 504, the back button, a closed tab) then reads as an
 * interrupted payment. A checkout lives 30 minutes, so an older mark means nothing.
 */
const CHECKOUT_STARTED_KEY = "medart:chargily-checkout-started";
const CHECKOUT_MARK_MAX_AGE_MS = 45 * 60 * 1000;

type ConfirmPhase = "idle" | "checking" | "confirmed" | "slow";

function markCheckoutStarted() {
  try {
    sessionStorage.setItem(CHECKOUT_STARTED_KEY, String(Date.now()));
  } catch {
    // Storage blocked: only the « interrupted payment » notice is lost.
  }
}

/** Reads and clears the mark: true when a Chargily payment was started in this tab less than 45 minutes ago. */
function takeCheckoutMark(): boolean {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_STARTED_KEY);
    sessionStorage.removeItem(CHECKOUT_STARTED_KEY);
    const startedAt = Number(raw);
    return raw !== null && Number.isFinite(startedAt) && Date.now() - startedAt < CHECKOUT_MARK_MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** Confirms the student's pending payments directly with Chargily (activating the paid ones); null when it could not ask. */
async function reconcilePayments(): Promise<{ activated: number; pending: number; latestPaid: boolean } | null> {
  try {
    const res = await fetch("/api/chargily/reconcile", { method: "POST", cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { activated?: unknown; pending?: unknown; latestStatus?: unknown } | null;
    if (typeof data?.activated !== "number" || typeof data.pending !== "number") return null;
    return { activated: data.activated, pending: data.pending, latestPaid: data.latestStatus === "paid" };
  } catch {
    return null;
  }
}

/** An outage of the payment gateway reads as a calm « try again shortly », not as a failure. */
function ErrorNotice({ message, className }: { message: string; className?: string }) {
  const gatewayDown = message === PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-2xl border p-4 text-sm",
        gatewayDown ? "flex items-start gap-3 border-amber-400/40 bg-amber-500/10 text-amber-100" : "border-rose-400/40 bg-rose-500/10 text-rose-200",
        className
      )}
    >
      {gatewayDown && <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />}
      {gatewayDown ? <span>{message}</span> : message}
    </div>
  );
}

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

function UsagePanel({ usage, loaded, onRetry }: { usage: UsageSnapshot | null; loaded: boolean; onRetry: () => void }) {
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
    return (
      <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center">
        <p className="text-sm text-slate-400">Ta consommation n&apos;a pas pu être chargée. Tes paiements et ton abonnement ne sont pas concernés.</p>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" />
          Réessayer
        </Button>
      </div>
    );
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
            {AUDIO_SMART_NOTES_ENABLED && (
              <p className="flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                Audio : remis à zéro chaque jour
              </p>
            )}
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
        {/* Paid plans: no message gauge — the assistant is never blocked. Only the free trial's lifetime allowance is shown. */}
        {!usage.messages.perDay && (
          <UsageBar icon={MessageSquare} label="Messages Assistant / Copilot" used={usage.messages.used} cap={usage.messages.cap} caption="essai, à vie" />
        )}
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

/** The student's seat reservation is still running (an expired one no longer ties them to the group). */
function holdIsLive(pool: PoolView): boolean {
  return pool.me.status === "holding" && Boolean(pool.me.holdExpiresAt) && new Date(pool.me.holdExpiresAt ?? 0).getTime() > Date.now();
}

/** Where the student stands in a pooled group, in one line (null when there is nothing to say). */
function myShareLine(pool: PoolView): { text: string; tone: "ok" | "wait" | "todo" } | null {
  if (pool.mode !== "pooled" || pool.status !== "open") return null;
  if (pool.me.status === "paid") return { text: "Ta part est payée : ta place est bloquée.", tone: "ok" };
  if (holdIsLive(pool)) return { text: "Ton paiement est en cours de confirmation.", tone: "wait" };
  if (pool.isCreator && pool.me.status !== "refund_pending" && pool.me.status !== "refunded") {
    return { text: "Ta part n'est pas encore payée : ta place n'est pas bloquée.", tone: "todo" };
  }
  return null;
}

/** The invite link a student shares (same as the tracker's: /join/{code}?k=…). */
function inviteLinkOf(origin: string, pool: PoolView): string {
  return `${origin}/join/${encodeURIComponent(pool.code)}?k=${pool.mode === "leader" ? "lead" : pool.kind}`;
}

const CYCLE_LABEL: Record<BillingCycle, string> = { monthly: "1 mois", quad: "4 mois", annual: "8 mois" };

/** The open pooled groups the student is part of (paid or paying) or started — what « Ton groupe en cours » shows. */
function currentOpenPools(pools: PoolView[] | null): PoolView[] {
  const open = (pools ?? []).filter(
    (p) => p.mode === "pooled" && p.status === "open" && (p.me.status === "paid" || holdIsLive(p) || (p.isCreator && p.me.status !== "refund_pending" && p.me.status !== "refunded"))
  );
  const rank = (p: PoolView) => (p.me.status === "paid" ? 0 : holdIsLive(p) ? 1 : 2);
  return [...open].sort((a, b) => rank(a) - rank(b));
}

function CurrentGroupCard({ pool, others, copied, onCopy }: { pool: PoolView; others: number; copied: boolean; onCopy: (pool: PoolView) => void }) {
  const ratio = pool.size > 0 ? Math.min(1, pool.confirmed / pool.size) : 0;
  const remaining = Math.max(0, pool.size - pool.confirmed);
  const share = myShareLine(pool);
  const paid = pool.me.status === "paid";
  const ctaLabel = paid ? "Ouvrir mon groupe" : holdIsLive(pool) ? "Voir mon paiement" : "Payer ma part";

  return (
    <CyberPanel laser="spin" accent="violet" className="mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="cyber-kicker flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Ton groupe en cours
          </p>
          <p className="mt-1 text-xl font-black text-white">
            Groupe de {pool.size} · {CYCLE_LABEL[pool.cycle] ?? pool.cycle}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {formatDZD(pool.pricePerMember)} par personne · {pool.isCreator ? "tu l'as lancé" : "tu en fais partie"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black tabular-nums text-white">
            {pool.confirmed}
            <span className="text-xl text-slate-500">/{pool.size}</span>
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">places payées</p>
        </div>
      </div>

      <div
        className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={`${pool.confirmed} places payées sur ${pool.size}`}
        aria-valuemin={0}
        aria-valuemax={pool.size}
        aria-valuenow={pool.confirmed}
      >
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width] duration-700" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>

      {share && (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-sm font-semibold",
            share.tone === "ok" ? "text-emerald-300" : share.tone === "wait" ? "text-cyan-200" : "text-amber-200"
          )}
        >
          {share.tone === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : share.tone === "wait" ? <Hourglass className="h-4 w-4 shrink-0" /> : <Lock className="h-4 w-4 shrink-0" />}
          {share.text}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-400">
        {remaining > 0
          ? `Encore ${remaining} paiement${remaining > 1 ? "s" : ""} : l'accès démarre pour tous à ${pool.size}/${pool.size}. Date limite : ${formatFrenchDate(pool.expiresAt)} (sinon, remboursement automatique).`
          : "Toutes les places sont payées : l'activation est en cours."}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button asChild size="lg" className="flex-1 bg-gradient-to-r from-cyan-300 to-sky-400 font-black text-slate-950 hover:bg-transparent">
          <Link href={`/dashboard/billing/pool/${encodeURIComponent(pool.code)}`}>
            {ctaLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Button type="button" size="lg" variant="outline" className="flex-1 border-white/15 text-slate-200" onClick={() => onCopy(pool)}>
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          {copied ? "Lien copié !" : "Copier le lien d'invitation"}
        </Button>
      </div>
      {others > 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          + {others} autre{others > 1 ? "s" : ""} groupe{others > 1 ? "s" : ""} en cours dans « Tes groupes », plus bas.
        </p>
      )}
    </CyberPanel>
  );
}

function PoolItem({ pool, copied, onCopy }: { pool: PoolView; copied: boolean; onCopy: (pool: PoolView) => void }) {
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
      {(() => {
        const share = myShareLine(pool);
        return share ? (
          <p className={cn("mt-1 text-[11px] font-semibold", share.tone === "ok" ? "text-emerald-300" : share.tone === "wait" ? "text-cyan-200" : "text-amber-200")}>
            {share.text}
          </p>
        ) : null;
      })()}
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
          <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onCopy(pool)}>
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
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>(() => (status === "success" ? "checking" : "idle"));
  const [interrupted, setInterrupted] = useState(false);
  const silentCheckDoneRef = useRef(false);
  const userId = user?.id ?? null;

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch("/api/subscription", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as SubscriptionResponse | null;
      if (data) {
        setSubscription(data.subscription ?? null);
        setUsage(data.usage ?? null);
        setIsAdmin(data.isAdmin === true);
      }
    } catch {
      // Network error: the usage panel offers « Réessayer ».
    } finally {
      setLoaded(true);
    }
  }, []);

  const loadPools = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/pools", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { success?: boolean; pools?: unknown } | null;
      if (data?.success && Array.isArray(data.pools)) setPools(data.pools as PoolView[]);
      else setPools((current) => current ?? []);
    } catch {
      // A failed refresh keeps the last known gauges on screen.
      setPools((current) => current ?? []);
    }
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      const res = await fetch("/api/billing/invoices", { cache: "no-store" });
      const data = (await res.json()) as { invoices?: unknown };
      setInvoices(Array.isArray(data?.invoices) ? (data.invoices as Invoice[]) : []);
    } catch {
      setInvoices((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadSubscription();
    void loadPools();
    void loadInvoices();
  }, [user, loadSubscription, loadPools, loadInvoices]);

  const refreshAfterPayment = useCallback(() => {
    void loadSubscription();
    void loadPools();
    void loadInvoices();
  }, [loadSubscription, loadPools, loadInvoices]);

  // Came back without Chargily's redirect (its page stalled on a 504, back button…): say what happens next.
  useEffect(() => {
    if (takeCheckoutMark() && status !== "success" && status !== "failure") setInterrupted(true);
  }, [status]);

  // The browser's back button may restore this page as it was left — pay button still spinning. Unfreeze it.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setLoadingKey(null);
      if (takeCheckoutMark()) setInterrupted(true);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Confirms payments with Chargily itself, never waiting on its webhook alone: once silently on every
  // visit, then every 5 s for 2 minutes after a payment (success return or interrupted one). Activation
  // goes through the webhook's own once-only claim, so a payment is never activated twice.
  const watchPayments = confirmPhase === "checking" || interrupted;
  useEffect(() => {
    if (!userId) return;
    if (!watchPayments && silentCheckDoneRef.current) return;
    silentCheckDoneRef.current = true;
    const startedAt = Date.now();
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      const outcome = await reconcilePayments();
      if (cancelled) return;
      if (outcome && outcome.activated > 0) {
        setConfirmPhase("confirmed");
        setInterrupted(false);
        refreshAfterPayment();
        return;
      }
      if (!watchPayments) return;
      if (outcome && outcome.latestPaid) {
        // The payment just made is already settled — by its webhook or an earlier check.
        setConfirmPhase("confirmed");
        setInterrupted(false);
        refreshAfterPayment();
        return;
      }
      if (outcome && outcome.pending === 0) {
        // Nothing left to ask Chargily about; a late webhook still activates the payment on its own.
        setConfirmPhase((phase) => (phase === "checking" ? "slow" : phase));
        return;
      }
      if (Date.now() - startedAt >= CONFIRM_POLL_MAX_MS) {
        setConfirmPhase((phase) => (phase === "checking" ? "slow" : phase));
        return;
      }
      timer = window.setTimeout(tick, CONFIRM_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, watchPayments, refreshAfterPayment]);

  const openPools = useMemo(() => currentOpenPools(pools), [pools]);
  const primaryOpenPool = openPools[0] ?? null;

  // Live gauge: while a group is filling up, refresh it every 20 s (and when the tab comes back).
  const hasOpenPool = openPools.length > 0;
  useEffect(() => {
    if (!user || !hasOpenPool) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadPools();
    };
    const id = window.setInterval(refresh, 20000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user, hasOpenPool, loadPools]);

  async function handleAction(action: PlanAction) {
    if (!user || loadingKey) return;
    setError(null);
    setLoadingKey(planActionKey(action));
    try {
      if (action.type === "open") {
        router.push(`/dashboard/billing/pool/${encodeURIComponent(action.code)}`);
        return;
      }
      if (action.type === "pool") {
        const res = await fetch("/api/billing/pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: action.kind, cycle: action.cycle }),
        });
        if (!res.ok) {
          // A refused creation is often « you already have a group »: show it right away.
          void loadPools();
          throw new Error(await readError(res, "La création du groupe n'a pas abouti — rien n'a été payé. Réessaie dans un instant."));
        }
        const data = (await res.json()) as { success?: boolean; code?: unknown; error?: unknown };
        if (!data.success || typeof data.code !== "string") throw new Error(typeof data.error === "string" ? data.error : "La création du groupe n'a pas abouti — rien n'a été payé. Réessaie dans un instant.");
        router.push(`/dashboard/billing/pool/${encodeURIComponent(data.code)}`);
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), CHECKOUT_REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch("/api/chargily/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: action.plan }),
          signal: controller.signal,
        });
      } catch {
        // No answer in time: the gateway is stalling. Otherwise the request never left this device.
        throw new Error(controller.signal.aborted ? PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE : "Connexion impossible : vérifie ton réseau puis réessaie. Rien n'a été débité.");
      } finally {
        window.clearTimeout(timeout);
      }
      // 502/503/504 without our own message = a gateway or platform timeout in front of the route.
      if (!res.ok) throw new Error(await readError(res, res.status >= 502 && res.status <= 504 ? PAYMENT_GATEWAY_UNAVAILABLE_MESSAGE : "Impossible de créer le paiement."));
      const data = (await res.json()) as { checkoutUrl?: unknown };
      if (typeof data.checkoutUrl !== "string") throw new Error("Impossible de créer le paiement.");
      markCheckoutStarted();
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer le paiement.");
      setLoadingKey(null);
    }
  }

  async function copyInvite(pool: PoolView) {
    const code = pool.code;
    try {
      await navigator.clipboard.writeText(inviteLinkOf(window.location.origin, pool));
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => (current === code ? null : current)), 1800);
    } catch {
      setError(`Copie impossible sur cet appareil — partage ce code à tes amis : ${code}`);
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
    <CyberStage className="mx-auto max-w-5xl overflow-x-clip">
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
        {confirmPhase === "confirmed" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Paiement confirmé : ton abonnement est actif. Merci ! Si tu as payé pour un Groupe, ton code d&apos;invitation apparaît dans « Tes
              groupes ».
            </span>
          </div>
        ) : confirmPhase === "slow" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Paiement reçu — la confirmation de Chargily / Algérie Poste prend plus de temps que d&apos;habitude. Ton abonnement s&apos;active
              automatiquement dès qu&apos;elle arrive : surtout ne repaie pas. Tu peux fermer cette page.
            </span>
          </div>
        ) : (
          status === "success" && (
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              <Hourglass className="mt-0.5 h-4 w-4 shrink-0 animate-pulse" />
              <span>
                Paiement reçu ! Confirmation auprès de Chargily en cours : ton abonnement s&apos;active automatiquement dans quelques instants, ne
                repaie pas. Si tu as payé pour un Groupe, ton code d&apos;invitation apparaît dans « Tes groupes ».
              </span>
            </div>
          )
        )}
        {interrupted && confirmPhase !== "confirmed" && (
          <div role="status" className="flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
            <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{PAYMENT_INTERRUPTED_MESSAGE}</span>
          </div>
        )}
        {status === "failure" && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Le paiement a échoué ou a été annulé. Aucun montant n&apos;a été débité.
          </div>
        )}
        {error && !plansOpen && <ErrorNotice message={error} />}
      </div>

      {/* ── Ton groupe en cours (never lost, never a second group) ─────── */}
      {primaryOpenPool && (
        <CurrentGroupCard pool={primaryOpenPool} others={openPools.length - 1} copied={copiedCode === primaryOpenPool.code} onCopy={copyInvite} />
      )}

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
          {error && <ErrorNotice message={error} className="mt-4" />}
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:items-stretch">
            {plansForCycle.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrentPlan={isPaidActive && subscription?.effectivePlan === plan.id}
                loadingKey={loadingKey}
                onAction={handleAction}
                openPool={primaryOpenPool}
                activePlanEnd={isPaidActive ? (subscription?.periodEnd ?? null) : null}
              />
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
        <UsagePanel
          usage={usage}
          loaded={loaded}
          onRetry={() => {
            setLoaded(false);
            void loadSubscription();
          }}
        />
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
