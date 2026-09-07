"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PathophysiologyCascadeSlide } from "@/lib/presentation-types";

/** Vertical cascade of an arbitrary N steps — same expand/collapse interaction and card chrome as DiseaseJourneyViewer, but for a free-form step list instead of the fixed 7-stage taxonomy. Uses the shared "danger" (rose) tone: a pathophysiology cascade traces a disease progressing toward harm, same semantic as complications/mistakes elsewhere in the Studio. */
export function PathophysiologyCascade({ slide }: { slide: PathophysiologyCascadeSlide }) {
  const { cascade } = slide;
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft dark:shadow-glass-dark sm:p-6">
      <h3 className="mb-6 text-center text-lg font-bold text-foreground">{cascade.title}</h3>

      <ol className="relative">
        {cascade.steps.map((step, index) => {
          const isExpanded = expandedIndex === index;
          const isLast = index === cascade.steps.length - 1;

          return (
            <li key={step.id} className="relative flex gap-4 pb-6 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-5 top-11 h-[calc(100%-2.75rem)] w-px bg-rose-200 dark:bg-rose-500/25"
                />
              )}

              <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-600 ring-4 ring-card dark:bg-rose-500/15 dark:text-rose-300">
                {step.order}
              </span>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  aria-expanded={isExpanded}
                  className={cn(
                    "w-full rounded-xl border border-rose-200 bg-rose-50/40 p-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-rose-300 active:scale-[0.99]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    "dark:border-rose-500/25 dark:bg-rose-500/10 dark:hover:border-rose-500/45"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="mb-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                        Étape {step.order}
                      </span>
                      <h4 className="truncate text-sm font-bold text-foreground sm:text-base">{step.title}</h4>
                      <p className="mt-1 text-sm leading-snug text-muted-foreground">{step.summary}</p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
                        isExpanded && "rotate-180"
                      )}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="animate-fade-in overflow-hidden">
                    <div className="mt-2 space-y-3 rounded-xl border border-rose-100 bg-rose-50/50 p-4 dark:border-rose-500/15 dark:bg-rose-500/5">
                      <p className="text-sm leading-relaxed text-foreground/90">{step.details}</p>
                      {step.keyPoints.length > 0 && (
                        <ul className="space-y-1.5">
                          {step.keyPoints.map((point, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500 dark:bg-rose-400" />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
