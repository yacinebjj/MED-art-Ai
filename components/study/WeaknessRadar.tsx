"use client";

import { useEffect, useState } from "react";
import { Target, Loader2, AlertTriangle, LogIn } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

/** Shape returned by the `weakness_radar` Postgres function (see supabase/schema.sql), one row per module the student has QCM attempts in. */
interface WeaknessRadarRow {
  module_id: number;
  module_name: string;
  total_attempts: number;
  correct_attempts: number;
  mastery_pct: number;
}

function tierBadgeVariant(pct: number): "success" | "warning" | "danger" {
  if (pct >= 75) return "success";
  if (pct >= 40) return "warning";
  return "danger";
}

function tierLabel(pct: number): string {
  if (pct >= 75) return "Solide";
  if (pct >= 40) return "À consolider";
  return "Point faible";
}

/** A small at-a-glance dot ahead of the module name, so the eye can scan
 * the whole list for weak spots before reading a single word. */
const TIER_DOT: Record<ReturnType<typeof tierBadgeVariant>, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
};

export function WeaknessRadar() {
  const [rows, setRows] = useState<WeaknessRadarRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/srs/weakness-radar")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          setNeedsAuth(true);
          return;
        }
        if (Array.isArray(body?.radar)) {
          setRows(body.radar);
        } else {
          setError(body?.error ?? "Impossible de charger tes statistiques.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de contacter le serveur.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (needsAuth) {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
          <LogIn className="h-6 w-6" />
          <p className="text-sm">Connecte-toi pour voir tes points faibles par module.</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (rows === null) {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Calcul de ta maîtrise par module...</span>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="animate-in fade-in-0 duration-300">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
          <Target className="h-6 w-6" />
          <p className="text-sm">
            Réponds à quelques QCM (bouton « J&apos;ai réussi / J&apos;ai raté » sous chaque question) pour débloquer tes statistiques par module.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-in fade-in-0 duration-300">
      <CardHeader className="flex flex-row items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          <Target className="h-5 w-5" />
        </div>
        <div>
          <CardTitle>Weakness Radar</CardTitle>
          <p className="text-sm text-muted-foreground">Ta maîtrise par module, du point le plus faible au plus solide.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.map((row, i) => (
          <div
            key={row.module_id}
            className="-mx-2 animate-in space-y-1.5 rounded-xl px-2 py-1.5 fade-in slide-in-from-bottom-1 duration-300 transition-colors hover:bg-muted/50"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TIER_DOT[tierBadgeVariant(row.mastery_pct)])} aria-hidden="true" />
                {row.module_name}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {row.correct_attempts}/{row.total_attempts} bonnes réponses
                </span>
                <Badge variant={tierBadgeVariant(row.mastery_pct)}>{tierLabel(row.mastery_pct)}</Badge>
              </div>
            </div>
            <Progress value={row.mastery_pct} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
