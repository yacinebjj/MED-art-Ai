"use client";

import { AudioLines, BookOpen } from "lucide-react";
import { useUsage } from "@/hooks/useUsage";
import { cn } from "@/lib/utils";

/**
 * Small, always-visible quota reminders shown where the quota is consumed.
 * Render nothing until the usage snapshot is known (and the v2 quotas are live).
 */

/** Course import counter — upload modal / module page. */
export function CourseCreditLine({ className }: { className?: string }) {
  const { usage } = useUsage();
  if (!usage?.enforced) return null;
  const { used, cap } = usage.courses;
  const full = used >= cap;
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2 text-left text-xs leading-relaxed",
        full ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border bg-muted/40 text-muted-foreground",
        className
      )}
    >
      <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {usage.isTrial ? (
        <span>
          Ton cours gratuit : <strong className="tabular-nums text-foreground">{Math.min(used, cap)}/{cap}</strong>
        </span>
      ) : (
        <span>
          <strong className="tabular-nums text-foreground">
            {used}/{cap}
          </strong>{" "}
          cours importés ce mois-ci — attention : un cours supprimé ne rend pas le crédit.
        </span>
      )}
    </p>
  );
}

/** Audio → Smart Notes counter. */
export function AudioQuotaNotice({ className }: { className?: string }) {
  const { usage } = useUsage();
  if (!usage?.enforced) return null;
  if (usage.isTrial) {
    return (
      <p className={cn("inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-[11px] font-medium text-muted-foreground", className)}>
        <AudioLines className="h-3.5 w-3.5 shrink-0" />
        <span>Audio → Smart Notes fait partie des formules payantes</span>
      </p>
    );
  }
  const { usedToday, capPerDay, usedThisMonth, capPerMonth } = usage.audio;
  const blocked = usedToday >= capPerDay || usedThisMonth >= capPerMonth;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium",
        blocked ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-border bg-muted/40 text-muted-foreground",
        className
      )}
    >
      <AudioLines className="h-3.5 w-3.5 shrink-0" />
      <span>
        {capPerDay} audio par jour · <span className="tabular-nums">{usedThisMonth}/{capPerMonth}</span> ce mois-ci
        {usedToday >= capPerDay && usedThisMonth < capPerMonth ? " · reviens demain" : ""}
      </span>
    </p>
  );
}
