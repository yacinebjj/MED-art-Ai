"use client";

import { useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  ClipboardCheck,
  Dna,
  Pill,
  Route,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DiseaseJourneyData, DiseaseJourneyStage } from "@/lib/visual-studio-types";

type Tone = "blue" | "amber" | "emerald" | "rose";

const STAGE_ICON: Record<DiseaseJourneyStage, LucideIcon> = {
  normal_organ: Activity,
  risk_factors: AlertTriangle,
  pathophysiology: Dna,
  symptoms: Stethoscope,
  diagnosis: ClipboardCheck,
  treatment: Pill,
  complications: AlertOctagon,
};

const STAGE_TONE: Record<DiseaseJourneyStage, Tone> = {
  normal_organ: "blue",
  risk_factors: "amber",
  pathophysiology: "blue",
  symptoms: "amber",
  diagnosis: "blue",
  treatment: "emerald",
  complications: "rose",
};

const STAGE_LABEL: Record<DiseaseJourneyStage, string> = {
  normal_organ: "Organe sain",
  risk_factors: "Facteurs de risque",
  pathophysiology: "Physiopathologie",
  symptoms: "Symptômes",
  diagnosis: "Diagnostic",
  treatment: "Traitement",
  complications: "Complications",
};

/** Shared tone language — kept consistent with every other Visual Studio content panel (chip / card border / badge / bullet), each with a dark-mode-safe pair. */
const CHIP_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
};

const CARD_TONE_STYLES: Record<Tone, string> = {
  blue: "border-blue-200 hover:border-blue-300 dark:border-blue-500/25 dark:hover:border-blue-500/45",
  amber: "border-amber-200 hover:border-amber-300 dark:border-amber-500/25 dark:hover:border-amber-500/45",
  emerald: "border-emerald-200 hover:border-emerald-300 dark:border-emerald-500/25 dark:hover:border-emerald-500/45",
  rose: "border-rose-200 hover:border-rose-300 dark:border-rose-500/25 dark:hover:border-rose-500/45",
};

const BADGE_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

const BULLET_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-500 dark:bg-blue-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  rose: "bg-rose-500 dark:bg-rose-400",
};

interface DiseaseJourneyViewerProps {
  data: DiseaseJourneyData;
  /** Stage number to expand on first render (1-indexed). Defaults to none expanded. */
  defaultExpandedIndex?: number;
}

export function DiseaseJourneyViewer({ data, defaultExpandedIndex }: DiseaseJourneyViewerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    typeof defaultExpandedIndex === "number" ? defaultExpandedIndex : null
  );

  if (!data.steps.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-8 text-center">
        <Route className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Aucune étape à afficher pour ce parcours clinique.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft dark:shadow-glass-dark sm:p-6">
      <h3 className="mb-6 text-center text-lg font-bold text-foreground">{data.title}</h3>

      <ol className="relative">
        {data.steps.map((step, index) => {
          const tone = STAGE_TONE[step.stage];
          const Icon = STAGE_ICON[step.stage];
          const isExpanded = expandedIndex === index;
          const isLast = index === data.steps.length - 1;

          return (
            <li key={step.stage} className="relative flex gap-4 pb-6 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-5 top-11 h-[calc(100%-2.75rem)] w-px bg-border"
                />
              )}

              <span
                className={cn(
                  "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                  CHIP_TONE_STYLES[tone]
                )}
              >
                <Icon className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setExpandedIndex(isExpanded ? null : index)}
                  aria-expanded={isExpanded}
                  className={cn(
                    "w-full rounded-xl border bg-card p-4 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    CARD_TONE_STYLES[tone]
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={cn(
                          "mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                          BADGE_TONE_STYLES[tone]
                        )}
                      >
                        Étape {index + 1} · {STAGE_LABEL[step.stage]}
                      </span>
                      <h4 className="truncate text-sm font-bold text-foreground sm:text-base">
                        {step.title}
                      </h4>
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
                    <div className="mt-2 space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4">
                      <p className="text-sm leading-relaxed text-foreground/90">{step.details}</p>
                      {step.keyPoints.length > 0 && (
                        <ul className="space-y-1.5">
                          {step.keyPoints.map((point, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                              <span
                                className={cn(
                                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                                  BULLET_TONE_STYLES[tone]
                                )}
                              />
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
