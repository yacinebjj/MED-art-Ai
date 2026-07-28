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

const CHIP_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-100 text-blue-600 ring-blue-200",
  amber: "bg-amber-100 text-amber-600 ring-amber-200",
  emerald: "bg-emerald-100 text-emerald-600 ring-emerald-200",
  rose: "bg-rose-100 text-rose-600 ring-rose-200",
};

const CARD_TONE_STYLES: Record<Tone, string> = {
  blue: "border-blue-200 hover:border-blue-300",
  amber: "border-amber-200 hover:border-amber-300",
  emerald: "border-emerald-200 hover:border-emerald-300",
  rose: "border-rose-200 hover:border-rose-300",
};

const BADGE_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
};

const BULLET_TONE_STYLES: Record<Tone, string> = {
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
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
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Aucune étape à afficher pour ce parcours clinique.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h3 className="mb-6 text-center text-lg font-bold text-slate-900">{data.title}</h3>

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
                  className="absolute left-5 top-11 h-[calc(100%-2.75rem)] w-px bg-slate-200"
                />
              )}

              <span
                className={cn(
                  "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-4 ring-white",
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
                    "w-full rounded-xl border bg-white p-4 text-left shadow-sm transition-colors",
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
                      <h4 className="truncate text-sm font-bold text-slate-900 sm:text-base">
                        {step.title}
                      </h4>
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
                    <div className="mt-2 space-y-3 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                      <p className="text-sm leading-relaxed text-slate-700">{step.details}</p>
                      {step.keyPoints.length > 0 && (
                        <ul className="space-y-1.5">
                          {step.keyPoints.map((point, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
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
