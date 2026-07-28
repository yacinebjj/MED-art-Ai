"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PathophysiologyCascadeSlide } from "@/lib/presentation-types";

/** Vertical cascade of an arbitrary N steps — same expand/collapse interaction as DiseaseJourneyViewer, but for a free-form step list instead of the fixed 7-stage taxonomy. */
export function PathophysiologyCascade({ slide }: { slide: PathophysiologyCascadeSlide }) {
  const { cascade } = slide;
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  return (
    <div>
      <h3 className="mb-6 text-center text-lg font-bold text-slate-900">{cascade.title}</h3>

      <ol className="relative">
        {cascade.steps.map((step, index) => {
          const isExpanded = expandedIndex === index;
          const isLast = index === cascade.steps.length - 1;

          return (
            <li key={step.id} className="relative flex gap-4 pb-6 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-5 top-11 h-[calc(100%-2.75rem)] w-px bg-red-200"
                />
              )}

              <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-600 ring-4 ring-white">
                {step.order}
              </span>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  aria-expanded={isExpanded}
                  className="w-full rounded-xl border border-red-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-red-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="mb-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                        Étape {step.order}
                      </span>
                      <h4 className="truncate text-sm font-bold text-slate-900 sm:text-base">{step.title}</h4>
                      <p className="mt-1 text-sm leading-snug text-slate-600">{step.summary}</p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200",
                        isExpanded && "rotate-180"
                      )}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="animate-fade-in overflow-hidden">
                    <div className="mt-2 space-y-3 rounded-xl border border-red-100 bg-red-50/60 p-4">
                      <p className="text-sm leading-relaxed text-slate-700">{step.details}</p>
                      {step.keyPoints.length > 0 && (
                        <ul className="space-y-1.5">
                          {step.keyPoints.map((point, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
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
