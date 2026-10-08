"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, Copy, Hourglass, Lock, RefreshCw, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { CyberHeader, CyberPanel, CyberStage, SegmentedControl } from "@/components/cyber/primitives";
import { REFUND_DELAY_LABEL, formatDZD } from "@/lib/pricing";
import type { RefundRequestView } from "@/lib/billing-pools";

type Tab = "pending" | "refunded";

type LoadState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string }
  | { kind: "ready"; requests: RefundRequestView[] };

interface RefundsResponse {
  success: boolean;
  requests?: RefundRequestView[];
  error?: string;
}

const REASON_LABEL: Record<RefundRequestView["reason"], string> = {
  pool_expired: "Groupe non complet à J+7",
  pool_overflow: "Paiement arrivé sur un groupe déjà complet",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function CopyChip({ value }: { value: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ variant: "error", title: "Copie impossible", description: value });
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copier"
      className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 font-mono text-[11px] text-slate-300 transition-colors hover:bg-white/10"
    >
      <span className="truncate">{value}</span>
      {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
    </button>
  );
}

function RefundRow({ request, onMark }: { request: RefundRequestView; onMark: (request: RefundRequestView) => void }) {
  const age = daysSince(request.createdAt);
  const late = request.status === "pending" && age >= 5;
  return (
    <CyberPanel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{request.email ?? "E-mail inconnu"}</p>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">{request.userId}</p>
        </div>
        <p className="text-xl font-black tabular-nums text-white">{formatDZD(request.amount)}</p>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Motif</dt>
          <dd className="mt-0.5 text-slate-200">{REASON_LABEL[request.reason]}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Demandé le</dt>
          <dd className={late ? "mt-0.5 font-semibold text-amber-300" : "mt-0.5 text-slate-200"}>
            {formatDateTime(request.createdAt)}
            {request.status === "pending" && ` · J+${age}`}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Checkout Chargily</dt>
          <dd className="mt-0.5">{request.chargilyCheckoutId ? <CopyChip value={request.chargilyCheckoutId} /> : <span className="text-slate-500">—</span>}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Groupe</dt>
          <dd className="mt-0.5">{request.poolCode ? <CopyChip value={request.poolCode} /> : <span className="text-slate-500">—</span>}</dd>
        </div>
      </dl>

      {request.status === "refunded" ? (
        <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          <p className="flex items-center gap-1.5 font-bold">
            <CheckCircle2 className="h-4 w-4" />
            Remboursé{request.refundedAt ? ` le ${formatDateTime(request.refundedAt)}` : ""}
            {request.refundedBy ? ` par ${request.refundedBy}` : ""}
          </p>
          {request.note && <p className="mt-1 text-slate-300">Note : {request.note}</p>}
        </div>
      ) : (
        <Button
          onClick={() => onMark(request)}
          className="mt-4 w-full bg-gradient-to-r from-emerald-300 to-teal-400 font-black text-slate-950 hover:bg-transparent sm:w-auto"
        >
          <Undo2 className="h-4 w-4" />
          Marquer comme remboursé
        </Button>
      )}
    </CyberPanel>
  );
}

export default function AdminRefundsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("pending");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [target, setTarget] = useState<RefundRequestView | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async (status: Tab) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/refunds?status=${status}`, { cache: "no-store" });
      if (res.status === 403 || res.status === 401) {
        setState({ kind: "forbidden" });
        return;
      }
      const data = (await res.json().catch(() => null)) as RefundsResponse | null;
      if (!res.ok || !data?.success || !data.requests) {
        setState({ kind: "error", message: data?.error ?? "Lecture des remboursements impossible." });
        return;
      }
      // Newest refunded first; pending stays oldest first (the API order) so the most urgent is on top.
      const requests = status === "refunded" ? [...data.requests].reverse() : data.requests;
      setState({ kind: "ready", requests });
    } catch {
      setState({ kind: "error", message: "Connexion impossible. Vérifie ton réseau et réessaie." });
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  const total = useMemo(() => (state.kind === "ready" ? state.requests.reduce((sum, r) => sum + r.amount, 0) : 0), [state]);

  function openDialog(request: RefundRequestView) {
    setTarget(request);
    setNote("");
    setSubmitError(null);
  }

  async function confirmRefund() {
    if (!target) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/admin/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => null)) as RefundsResponse | null;
      if (!res.ok || !data?.success) {
        setSubmitError(data?.error ?? "Impossible d'enregistrer le remboursement.");
        return;
      }
      const done = target;
      setState((current) => (current.kind === "ready" ? { kind: "ready", requests: current.requests.filter((r) => r.id !== done.id) } : current));
      setTarget(null);
      toast({ variant: "success", title: "Remboursement enregistré", description: `${formatDZD(done.amount)} — ${done.email ?? done.userId}` });
    } catch {
      setSubmitError("Connexion impossible. Vérifie ton réseau et réessaie.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "forbidden") {
    return (
      <CyberStage accent="rose" className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
        <CyberPanel className="p-6 text-center sm:p-8">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Lock className="h-6 w-6 text-rose-300" />
          </span>
          <h1 className="mt-4 text-xl font-black text-white">Accès réservé</h1>
          <p className="mt-2 text-sm text-slate-400">Cette page est réservée à l&apos;équipe MedArt AI.</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/dashboard">Retour au tableau de bord</Link>
          </Button>
        </CyberPanel>
      </CyberStage>
    );
  }

  return (
    <CyberStage accent="emerald" className="mx-auto max-w-5xl overflow-x-clip p-4 sm:p-6 lg:p-8">
      <CyberHeader
        icon={Wallet}
        kicker="Administration"
        title="Remboursements"
        subtitle="Groupes non complétés et paiements en trop"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(tab)} className="border-white/15 text-slate-200">
            <RefreshCw className="h-4 w-4" />
            Actualiser
          </Button>
        }
      />

      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-200">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="leading-relaxed">
          Chargily ne permet pas de rembourser par API : envoie le remboursement (BaridiMob / CCP / dashboard Chargily), puis marque-le ici. Les étudiants
          ont été prévenus d&apos;un délai de {REFUND_DELAY_LABEL}.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Statut des remboursements"
          options={[
            { value: "pending", label: "À rembourser", icon: Hourglass },
            { value: "refunded", label: "Remboursés", icon: CheckCircle2 },
          ]}
        />
        {state.kind === "ready" && (
          <p className="text-sm text-slate-400">
            {state.requests.length} demande{state.requests.length > 1 ? "s" : ""} ·{" "}
            <span className="font-bold tabular-nums text-white">{formatDZD(total)}</span>
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3">
        {state.kind === "loading" &&
          Array.from({ length: 3 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-3xl bg-white/[0.04]" />)}

        {state.kind === "error" && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {state.message}
            <button type="button" onClick={() => void load(tab)} className="ml-2 font-bold underline-offset-4 hover:underline">
              Réessayer
            </button>
          </div>
        )}

        {state.kind === "ready" && state.requests.length === 0 && (
          <CyberPanel className="p-8 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
            <p className="mt-3 text-sm font-bold text-white">{tab === "pending" ? "Aucun remboursement en attente" : "Aucun remboursement enregistré"}</p>
          </CyberPanel>
        )}

        {state.kind === "ready" && state.requests.map((request) => <RefundRow key={request.id} request={request} onMark={openDialog} />)}
      </div>

      <Dialog open={target !== null} onOpenChange={(open) => !open && !submitting && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer le remboursement</DialogTitle>
            <DialogDescription>
              Confirme uniquement après avoir envoyé l&apos;argent. L&apos;étudiant verra « Remboursé » sur sa page de suivi.
            </DialogDescription>
          </DialogHeader>
          {target && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <p className="font-semibold text-foreground">{target.email ?? target.userId}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {formatDZD(target.amount)} · {REASON_LABEL[target.reason]}
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-foreground">Note (facultatif)</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Ex. : BaridiMob, réf. 123456"
                  className="mt-1.5 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setTarget(null)} disabled={submitting}>
                  Annuler
                </Button>
                <Button onClick={() => void confirmRefund()} isLoading={submitting}>
                  {!submitting && <Check className="h-4 w-4" />}
                  Oui, c&apos;est remboursé
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CyberStage>
  );
}
