import { Activity } from "lucide-react";
import type { ClinicalSignsSlide } from "@/lib/presentation-types";

export function ClinicalSignsGrid({ slide }: { slide: ClinicalSignsSlide }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {slide.signs.map((sign) => (
        <div
          key={sign.name}
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 transition-colors duration-300 dark:border-amber-500/25 dark:bg-amber-500/10"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
              <Activity className="h-4 w-4" />
            </span>
            <h4 className="text-sm font-bold text-foreground">{sign.name}</h4>
          </div>

          <p className="text-sm leading-snug text-foreground/90">{sign.description}</p>

          <div className="rounded-lg bg-background/60 p-3 dark:bg-background/30">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Comment le rechercher
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{sign.howToElicit}</p>
          </div>

          <div className="rounded-lg bg-background/60 p-3 dark:bg-background/30">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Signification
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{sign.significance}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
