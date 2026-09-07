"use client";

import { cn } from "@/lib/utils";

export type SourcesResultsTab = "sources" | "results";

interface SourcesResultsTabsProps {
  active: SourcesResultsTab;
  onChange: (tab: SourcesResultsTab) => void;
  sourcesLabel: string;
  resultsLabel: string;
  /** Shown as a small count badge on the "Résultats" tab (history length / saved-exam count) — omit or pass 0 to hide it. */
  resultsCount?: number;
}

/**
 * Mobile-only ("Sources" / "Résultats") segmented switch. Replaces the
 * desktop's permanent side-by-side aside+main split on narrow screens,
 * where showing the course-selection panel and the generated-content panel
 * at once left too little room for either — squeezed further whenever a
 * long result (a full exam, a multi-page résumé) needed real reading space.
 * Desktop layouts render both panels unconditionally and never mount this
 * (the caller wraps it in its own responsive branch, not this component,
 * since only the caller knows its own breakpoint).
 */
export function SourcesResultsTabs({ active, onChange, sourcesLabel, resultsLabel, resultsCount }: SourcesResultsTabsProps) {
  return (
    <div role="tablist" className="mb-2 flex shrink-0 gap-1 rounded-2xl bg-black/5 p-1 dark:bg-white/5">
      <button
        type="button"
        role="tab"
        aria-selected={active === "sources"}
        onClick={() => onChange("sources")}
        className={cn(
          "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98]",
          active === "sources" ? "bg-background text-foreground shadow-soft" : "text-muted-foreground"
        )}
      >
        {sourcesLabel}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "results"}
        onClick={() => onChange("results")}
        className={cn(
          "relative flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98]",
          active === "results" ? "bg-background text-foreground shadow-soft" : "text-muted-foreground"
        )}
      >
        {resultsLabel}
        {typeof resultsCount === "number" && resultsCount > 0 && (
          <span className="ml-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">
            {resultsCount}
          </span>
        )}
      </button>
    </div>
  );
}
