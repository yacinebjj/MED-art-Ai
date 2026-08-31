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
    <div className="flex animate-in flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/30 bg-destructive/5 px-4 py-10 text-center fade-in-0 zoom-in-95 duration-300 dark:bg-destructive/10">
      <AlertCircle className="h-8 w-8 text-destructive dark:text-red-300" />
      <p className="max-w-xs text-sm text-destructive dark:text-red-300 sm:max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" />
          Réessayer
        </Button>
      )}
    </div>
  );
}
