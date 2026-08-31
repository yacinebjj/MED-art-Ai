"use client";

import { useState } from "react";
import { AlertOctagon, ChevronUp, GraduationCap, Lightbulb, ListChecks, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuizPanel } from "@/components/visual-studio/QuizPanel";
import type { LearningModeContent } from "@/lib/presentation-types";

export function LearningModeDrawer({ content }: { content: LearningModeContent }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-t border-border bg-card">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors duration-300 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <GraduationCap className="h-4 w-4" />
        Mode Apprentissage
        <ChevronUp className={cn("h-4 w-4 transition-transform duration-200", !isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="animate-fade-in">
            <div className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/25 dark:bg-blue-500/10">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                  <ScrollText className="h-4 w-4" />
                  Résumé Express
                </h4>
                <p className="text-sm leading-relaxed text-blue-900 dark:text-blue-100">{content.summary}</p>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <ListChecks className="h-4 w-4" />
                  Points Clés
                </h4>
                <ul className="space-y-1.5">
                  {content.keyPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-snug text-foreground/90">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  <Lightbulb className="h-4 w-4" />
                  Perle Clinique
                </h4>
                <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-100">{content.pearl}</p>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/25 dark:bg-rose-500/10">
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  <AlertOctagon className="h-4 w-4" />
                  Erreurs Fréquentes
                </h4>
                <ul className="space-y-1.5">
                  {content.commonMistakes.map((mistake, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-snug text-rose-900 dark:text-rose-200">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500 dark:bg-rose-400" />
                      <span>{mistake}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {content.quiz.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-500/25 dark:bg-violet-500/10 lg:col-span-2">
                  <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
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
