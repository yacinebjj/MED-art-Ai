"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface LectureQuizPanelProps {
  smartNotes: string;
}

/**
 * On-demand "QCM Éclair + mots-clés" — click only (never on mount), built
 * strictly from the real Smart Notes text already on screen
 * (app/api/lecture-notes/insights/route.ts never invents a fact absent from
 * it). Purely ephemeral practice: answering here never touches the real
 * SRS/Leitner pipeline (qcm_attempts) — a wrong tap has zero consequence
 * beyond this component's own local state, and nothing here is saved.
 */
export function LectureQuizPanel({ smartNotes }: LectureQuizPanelProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const [quiz, setQuiz] = useState<QuizQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  async function handleGenerate() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/lecture-notes/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smartNotes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "Impossible de générer le QCM Éclair.");
      setKeywords(data.keywords);
      setQuiz(data.quiz);
      setAnswers({});
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsLoading(false);
    }
  }

  function selectAnswer(questionIndex: number, optionIndex: number) {
    setAnswers((prev) => (prev[questionIndex] !== undefined ? prev : { ...prev, [questionIndex]: optionIndex }));
  }

  if (!quiz) {
    return (
      <button
        type="button"
        onClick={handleGenerate}
        disabled={isLoading}
        className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-50/60 px-5 py-3 text-sm font-semibold text-violet-700 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-violet-100/80 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-950/20 dark:text-violet-300 dark:hover:bg-violet-950/40"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {isLoading ? "Génération du QCM Éclair..." : "QCM Éclair + mots-clés"}
      </button>
    );
  }

  return (
    <div className="animate-fade-in flex flex-col gap-4">
      {keywords && keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((keyword, i) => (
            <span
              key={i}
              className="rounded-full bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {quiz.map((q, qi) => {
          const selected = answers[qi];
          const isAnswered = selected !== undefined;
          return (
            <div key={qi} className="glass-card rounded-2xl border border-border p-4 shadow-soft">
              <p className="text-sm font-semibold text-foreground">
                {qi + 1}. {q.question}
              </p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {q.options.map((opt, oi) => {
                  const isCorrect = oi === q.correctIndex;
                  const isSelected = oi === selected;
                  return (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => selectAnswer(qi, oi)}
                      disabled={isAnswered}
                      className={cn(
                        "flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all duration-300",
                        !isAnswered && "border-border hover:-translate-y-0.5 hover:border-primary-300 hover:bg-accent",
                        isAnswered &&
                          isCorrect &&
                          "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300",
                        isAnswered &&
                          isSelected &&
                          !isCorrect &&
                          "border-destructive/50 bg-destructive/10 text-destructive",
                        isAnswered && !isSelected && !isCorrect && "border-border opacity-50"
                      )}
                    >
                      {isAnswered && isCorrect && <Check className="h-4 w-4 shrink-0" />}
                      {isAnswered && isSelected && !isCorrect && <X className="h-4 w-4 shrink-0" />}
                      <span className="flex-1">{opt}</span>
                    </button>
                  );
                })}
              </div>
              <AnimatePresence>
                {isAnswered && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: 0.2 }}
                    className="mt-2.5 overflow-hidden text-xs leading-relaxed text-muted-foreground"
                  >
                    {q.explanation}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
