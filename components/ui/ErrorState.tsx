"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Distinct from an empty state — a request FAILED, as opposed to genuinely
 * returning zero results. Added after a security audit found several
 * components rendering their empty-state copy ("Aucun cours...", "Aucun
 * point faible...") on a fetch failure, indistinguishable from a real "you
 * have no data" outcome — the worst case being a struggling student told
 * they have no weak points when the request to find them just failed.
 */
export function ErrorState({ message = "Échec du chargement des données.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-red-200 bg-red-50/60 py-10 text-center dark:border-red-900/50 dark:bg-red-950/20">
      <AlertCircle className="h-8 w-8 text-red-400 dark:text-red-500" />
      <p className="max-w-[240px] text-sm text-red-600 dark:text-red-400">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" />
          Réessayer
        </Button>
      )}
    </div>
  );
}
