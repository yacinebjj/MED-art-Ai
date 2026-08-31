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
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudyTools } from "@/lib/translations/studyTools";
import type { RemediationPlan, RemediationPriority } from "@/types/remediation";

type Status = "loading" | "needs-auth" | "error" | "no-modules-active" | "no-plan-yet" | "no-data" | "ready";

const PRIORITY_RANK: Record<RemediationPriority, number> = { haute: 0, moyenne: 1, basse: 2 };

const PRIORITY_BADGE: Record<RemediationPriority, string> = {
  haute: "border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300",
  moyenne: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  basse: "border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
};

/** Maps each priority to its studyTools.ts translation key — PRIORITY_LABEL used to hold the rendered French text directly, but that text now needs to vary by language, and this constant lives outside the component so it can't call useLanguage() itself. */
const PRIORITY_LABEL_KEY: Record<RemediationPriority, "priorityHigh" | "priorityMedium" | "priorityLow"> = {
  haute: "priorityHigh",
  moyenne: "priorityMedium",
  basse: "priorityLow",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function WeaknessRemediationPlan() {
  const { language } = useLanguage();
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
        setError(tStudyTools("serverContactError", language));
        return;
      }
      if (res.status === 401) {
        setStatus("needs-auth");
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        setStatus("error");
        setError(body?.error ?? tStudyTools("loadFailed", language));
        return;
      }

      // "no-modules-active" is only the right empty state when NEITHER
      // source has anything: no module activated for the Studio QCM-tab
      // source, AND no Générateur d'Examen attempt on record either — a
      // student who's only ever used the exam generator must still reach
      // the "Générer" button below, not this dead end. See
      // app/api/study/remediation-plan/route.ts's own comment.
      if ((body.activeModuleCount ?? 0) === 0 && !body.hasExamAttempts) {
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
    // `language` is read for its value at the moment an error/status string
    // is produced, not a reason to re-run the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/study/remediation-plan/generate", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        setStatus("error");
        setError(res.status === 429 ? buildRateLimitMessage(res) : body?.error ?? tStudyTools("generationFailed", language));
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
      setError(err instanceof Error ? err.message : tStudyTools("unknownError", language));
    } finally {
      setIsGenerating(false);
    }
  }

  if (status === "loading") {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{tStudyTools("loadingRemediationPlan", language)}</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "needs-auth") {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <LogIn className="h-6 w-6" />
          <p className="text-sm">{tStudyTools("signInForWeakPoints", language)}</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "no-modules-active") {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Target className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-semibold text-foreground">{tStudyTools("noActiveModulesTitle", language)}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {tStudyTools("noActiveModulesRemediationSubtitle", language)}
          </p>
        </CardContent>
      </Card>
    );
  }

  const sortedWeakSpots = plan ? [...plan.weakSpots].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) : [];

  return (
    <Card className="animate-in fade-in-0 duration-300">
      <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <CardTitle>{tStudyTools("cardTitle", language)}</CardTitle>
          {plan && (
            <>
              <p className="text-xs text-muted-foreground">{tStudyTools("generatedOn", language)} {formatDate(plan.generatedAt)}</p>
              {/* No automated staleness detection (would mean comparing
                  against qcm_attempts on every render, or a background job
                  neither of which exist here) — this is the honest,
                  low-cost alternative: a standing reminder that the plan
                  reflects a snapshot, not a live view, so a student who's
                  answered a bunch of new QCMs since knows to act on it. */}
              <p className="text-[11px] italic text-muted-foreground/80">
                {tStudyTools("regenerateReminder", language)}
              </p>
            </>
          )}
        </div>
        {status === "ready" && (
          <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={isGenerating} className="w-full sm:w-auto">
            {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {tStudyTools("regenerateButton", language)}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "error" && (
          <div key="error" className="flex animate-in flex-col items-center gap-3 py-10 text-center text-muted-foreground fade-in-0 duration-300">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {status === "no-data" && (
          <div key="no-data" className="flex animate-in flex-col items-center gap-3 py-10 text-center fade-in-0 duration-300">
            <Target className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-semibold text-foreground">{tStudyTools("notEnoughDataTitle", language)}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {tStudyTools("notEnoughDataSubtitle", language)}
            </p>
          </div>
        )}

        {status === "no-plan-yet" && (
          <div key="no-plan-yet" className="flex animate-in flex-col items-center gap-3 py-10 text-center fade-in-0 duration-300">
            <Target className="h-8 w-8 text-primary-500/70" />
            <p className="text-sm font-semibold text-foreground">{tStudyTools("noPlanYetTitle", language)}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {tStudyTools("noPlanYetSubtitle", language)}
            </p>
            <Button onClick={handleGenerate} disabled={isGenerating} className="mt-2">
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {tStudyTools("generatePlanButton", language)}
            </Button>
          </div>
        )}

        {status === "ready" && (
          <div key="ready" className="animate-in space-y-3 fade-in-0 duration-300">
            {sortedWeakSpots.map((spot, i) => (
              <div
                key={i}
                style={{ animationDelay: `${i * 60}ms` }}
                className="animate-in rounded-2xl border border-border bg-card p-4 fade-in slide-in-from-bottom-1 duration-300"
              >
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
                      {tStudyTools(PRIORITY_LABEL_KEY[spot.priority], language)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{spot.whyItMatters}</p>
                <div className="mt-3 rounded-r-xl border-l-4 border-primary bg-primary-50 p-3 text-sm text-primary-900 dark:bg-primary-900/20 dark:text-primary-100">
                  <p className="mb-0.5 text-[10px] font-black uppercase tracking-wide opacity-70">{tStudyTools("howToImprove", language)}</p>
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
