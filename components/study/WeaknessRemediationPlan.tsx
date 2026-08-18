"use client";

/**
 * "Points Faibles & Plan de Remédiation" — replaces the old WeaknessRadar
 * placeholder banner in /study's "revision" tab (see supabase/schema.sql's
 * comment on weakness_active_module_ids for why WeaknessRadar itself was
 * never touched/deleted, just no longer rendered here: its underlying SQL
 * function structurally excludes every Studio course, so its own "Réponds
 * à quelques QCM..." empty state was a permanent dead end for anyone using
 * only Studio courses).
 *
 * Never regenerates automatically on mount — GET /api/study/remediation-plan
 * is a free, cached read; only an explicit "Générer"/"Régénérer" click
 * triggers the actual AI call (POST .../generate), since re-analyzing on
 * every /study visit would silently spend tokens for no reason.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, LogIn, Loader2, ShieldAlert, Sparkles, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import type { RemediationPlan, RemediationPriority } from "@/types/remediation";

type Status = "loading" | "needs-auth" | "error" | "no-modules-active" | "no-plan-yet" | "no-data" | "ready";

const PRIORITY_RANK: Record<RemediationPriority, number> = { haute: 0, moyenne: 1, basse: 2 };

const PRIORITY_BADGE: Record<RemediationPriority, string> = {
  haute: "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  moyenne: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  basse: "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
};

const PRIORITY_LABEL: Record<RemediationPriority, string> = {
  haute: "Priorité haute",
  moyenne: "Priorité moyenne",
  basse: "Priorité basse",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function WeaknessRemediationPlan() {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RemediationPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      const res = await fetch("/api/study/remediation-plan").catch(() => null);
      if (cancelled) return;

      if (!res) {
        setStatus("error");
        setError("Impossible de contacter le serveur.");
        return;
      }
      if (res.status === 401) {
        setStatus("needs-auth");
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        setStatus("error");
        setError(body?.error ?? "Échec du chargement.");
        return;
      }

      if ((body.activeModuleCount ?? 0) === 0) {
        setStatus("no-modules-active");
        return;
      }

      if (body.plan) {
        setPlan(body.plan);
        setStatus("ready");
      } else {
        setStatus("no-plan-yet");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/study/remediation-plan/generate", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        setStatus("error");
        setError(res.status === 429 ? buildRateLimitMessage(res) : body?.error ?? "Échec de la génération.");
        return;
      }
      if (body.noData) {
        setStatus("no-data");
        return;
      }
      setPlan(body.plan);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setIsGenerating(false);
    }
  }

  if (status === "loading") {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Chargement de ton plan de remédiation...</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "needs-auth") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <LogIn className="h-6 w-6" />
          <p className="text-sm">Connecte-toi pour voir tes points faibles.</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "no-modules-active") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Target className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-semibold text-foreground">Aucun module actif.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Activez « Points Faibles & Plan de Remédiation » depuis votre tableau de bord (menu ⋮ d&apos;un module).
          </p>
        </CardContent>
      </Card>
    );
  }

  const sortedWeakSpots = plan ? [...plan.weakSpots].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) : [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <CardTitle>Points Faibles &amp; Plan de Remédiation</CardTitle>
          {plan && (
            <>
              <p className="text-xs text-muted-foreground">Généré le {formatDate(plan.generatedAt)}</p>
              {/* No automated staleness detection (would mean comparing
                  against qcm_attempts on every render, or a background job
                  neither of which exist here) — this is the honest,
                  low-cost alternative: a standing reminder that the plan
                  reflects a snapshot, not a live view, so a student who's
                  answered a bunch of new QCMs since knows to act on it. */}
              <p className="text-[11px] italic text-muted-foreground/80">
                (Pensez à régénérer ce plan si vous avez récemment terminé de nouveaux QCMs)
              </p>
            </>
          )}
        </div>
        {status === "ready" && (
          <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Régénérer
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {status === "no-data" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Target className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-semibold text-foreground">Pas encore assez de données.</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Réponds à quelques QCM dans les cours de tes modules actifs — le plan se construit à partir de tes vraies
              erreurs.
            </p>
          </div>
        )}

        {status === "no-plan-yet" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Target className="h-8 w-8 text-rose-500/70" />
            <p className="text-sm font-semibold text-foreground">Ton plan de remédiation n&apos;a pas encore été généré.</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              L&apos;IA analyse tes QCM ratés ou fragiles dans tes modules actifs pour identifier tes points faibles réels,
              triés par priorité clinique.
            </p>
            <Button onClick={handleGenerate} disabled={isGenerating} className="mt-2">
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Générer mon plan de remédiation
            </Button>
          </div>
        )}

        {status === "ready" && (
          <div className="space-y-3">
            {sortedWeakSpots.map((spot, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">{spot.concept}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {spot.courseTitle}
                    </Badge>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        PRIORITY_BADGE[spot.priority]
                      )}
                    >
                      {PRIORITY_LABEL[spot.priority]}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{spot.whyItMatters}</p>
                <div className="mt-3 rounded-r-xl border-l-4 border-primary bg-primary-50 p-3 text-xs text-primary-900 dark:bg-primary-900/20 dark:text-primary-100">
                  <p className="mb-0.5 text-[10px] font-black uppercase tracking-wide opacity-70">Comment progresser</p>
                  {spot.actionableAdvice}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
