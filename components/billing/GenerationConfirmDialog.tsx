"use client";

import { AlertTriangle, Lightbulb } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";

interface GenerationConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** Main warning, e.g. "Assure-toi d'avoir importé… ". */
  message: string;
  /** Units left this month; null when usage is unknown (the count line is then hidden). */
  remaining: number | null;
  cap: number;
  /** "générations", "résumés"… */
  unitLabel: string;
  /** Extra line under the count (e.g. how a unit is consumed). */
  detail?: string;
  tip?: string;
  confirmLabel?: string;
}

/** "Attention" dialog shown before every quota-consuming module generation. */
export function GenerationConfirmDialog({ open, onOpenChange, onConfirm, message, remaining, cap, unitLabel, detail, tip, confirmLabel = "Oui, générer" }: GenerationConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <DialogTitle className="text-lg font-bold">Attention</DialogTitle>
          <DialogDescription className="mt-2 text-balance text-sm leading-relaxed text-foreground/80">{message}</DialogDescription>
        </div>

        {remaining !== null && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-center">
            <p className="text-sm text-foreground">
              Il ne te reste que{" "}
              <span className="font-bold tabular-nums text-amber-700 dark:text-amber-300">
                {remaining}/{cap}
              </span>{" "}
              {unitLabel} ce mois-ci !
            </p>
            {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
          </div>
        )}
        {remaining === null && detail && <p className="mt-3 text-center text-xs text-muted-foreground">{detail}</p>}

        {tip && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-2.5 text-left text-xs leading-relaxed text-muted-foreground">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{tip}</span>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Pas encore
          </Button>
          <Button
            className="min-h-11 w-full sm:w-auto"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
