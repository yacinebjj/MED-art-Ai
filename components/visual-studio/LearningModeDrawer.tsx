"use client";

import { useState } from "react";
import { AlertOctagon, ChevronUp, GraduationCap, Lightbulb, ListChecks, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuizPanel } from "@/components/visual-studio/QuizPanel";
import type { LearningModeContent } from "@/lib/presentation-types";

export function LearningModeDrawer({ content }: { content: LearningModeContent }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-t border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
      >
        <GraduationCap className="h-4 w-4" />
        Mode Apprentissage
        <ChevronUp className={cn("h-4 w-4 transition-transform duration-200", !isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="animate-fade-in">
            <div className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
                  <ScrollText className="h-4 w-4" />
                  Résumé Express
                </h4>
                <p className="text-sm leading-relaxed text-blue-900">{content.summary}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                  <ListChecks className="h-4 w-4" />
                  Points Clés
                </h4>
                <ul className="space-y-1.5">
                  {content.keyPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-snug text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                  <Lightbulb className="h-4 w-4" />
                  Perle Clinique
                </h4>
                <p className="text-sm leading-relaxed text-emerald-900">{content.pearl}</p>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-rose-700">
                  <AlertOctagon className="h-4 w-4" />
                  Erreurs Fréquentes
                </h4>
                <ul className="space-y-1.5">
                  {content.commonMistakes.map((mistake, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-snug text-rose-900">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                      <span>{mistake}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {content.quiz.length > 0 && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4 lg:col-span-2">
                  <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-purple-700">
                    <GraduationCap className="h-4 w-4" />
                    Mini Quiz
                  </h4>
                  <QuizPanel key={content.quiz[0]?.id} questions={content.quiz} accent="blue" />
                </div>
              )}
            </div>
        </div>
      )}
    </div>
  );
}
