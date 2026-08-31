"use client";

import { useState } from "react";
import { Check, CheckCircle2, RotateCcw, Trophy, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuizQuestion } from "@/lib/presentation-types";

interface QuizPanelProps {
  questions: QuizQuestion[];
  /** Tailwind color used for progress/score accents — matches the parent slide's theme where relevant. */
  accent?: "emerald" | "blue";
}

export function QuizPanel({ questions, accent = "emerald" }: QuizPanelProps) {
  const [index, setIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  if (questions.length === 0) return null;

  const question = questions[index];
  const isAnswered = selectedOption !== null;
  const isLastQuestion = index === questions.length - 1;
  const isCorrectAnswer = isAnswered && selectedOption === question.correctIndex;
  const accentClasses =
    accent === "blue"
      ? {
          bg: "bg-blue-600 dark:bg-blue-500",
          text: "text-blue-700 dark:text-blue-300",
          light: "bg-blue-50 dark:bg-blue-500/10",
          border: "border-blue-200 dark:border-blue-500/25",
        }
      : {
          bg: "bg-emerald-600 dark:bg-emerald-500",
          text: "text-emerald-700 dark:text-emerald-300",
          light: "bg-emerald-50 dark:bg-emerald-500/10",
          border: "border-emerald-200 dark:border-emerald-500/25",
        };

  function handleSelect(optionIndex: number) {
    if (isAnswered) return;
    setSelectedOption(optionIndex);
    if (optionIndex === question.correctIndex) {
      setCorrectCount((c) => c + 1);
    }
  }

  function handleNext() {
    if (isLastQuestion) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelectedOption(null);
  }

  function handleRestart() {
    setIndex(0);
    setSelectedOption(null);
    setCorrectCount(0);
    setFinished(false);
  }

  if (finished) {
    const percentage = Math.round((correctCount / questions.length) * 100);
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-4 rounded-xl border p-6 text-center",
          accentClasses.border,
          accentClasses.light
        )}
      >
        <span className={cn("flex h-14 w-14 items-center justify-center rounded-full text-white", accentClasses.bg)}>
          <Trophy className="h-7 w-7" />
        </span>
        <div>
          <p className="text-2xl font-bold text-foreground">
            {correctCount} / {questions.length}
          </p>
          <p className="text-sm text-muted-foreground">{percentage}% de bonnes réponses</p>
        </div>
        <button
          type="button"
          onClick={handleRestart}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white transition-all duration-300 hover:opacity-90 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            accentClasses.bg
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Recommencer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>
          Question {index + 1} / {questions.length}
        </span>
        <span>
          Score : {correctCount} / {index + (isAnswered ? 1 : 0)}
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-300", accentClasses.bg)}
          style={{ width: `${(index / questions.length) * 100}%` }}
        />
      </div>

      <p className="text-base font-semibold text-foreground">{question.question}</p>

      <div className="space-y-2">
        {question.options.map((option, optionIndex) => {
          const isCorrectOption = optionIndex === question.correctIndex;
          const isSelectedOption = optionIndex === selectedOption;

          return (
            <button
              key={optionIndex}
              type="button"
              onClick={() => handleSelect(optionIndex)}
              disabled={isAnswered}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-left text-sm transition-all duration-300",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                !isAnswered && "border-border bg-card hover:-translate-y-0.5 hover:bg-accent active:scale-[0.99]",
                isAnswered &&
                  isCorrectOption &&
                  "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200",
                isAnswered &&
                  isSelectedOption &&
                  !isCorrectOption &&
                  "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200",
                isAnswered &&
                  !isSelectedOption &&
                  !isCorrectOption &&
                  "border-border bg-card text-muted-foreground opacity-70"
              )}
            >
              <span>{option}</span>
              {isAnswered && isCorrectOption && (
                <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
              {isAnswered && isSelectedOption && !isCorrectOption && (
                <X className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              )}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "animate-fade-in space-y-1.5 rounded-lg border p-3.5 text-sm leading-relaxed",
            isCorrectAnswer
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100"
              : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100"
          )}
        >
          {/* Reassuring feedback is spelled out in words, not left to color alone — clear either way, and never punitive when wrong. */}
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm font-bold",
              isCorrectAnswer ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
            )}
          >
            {isCorrectAnswer ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Bonne réponse !
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 shrink-0" /> Pas tout à fait — voici pourquoi
              </>
            )}
          </p>
          <p>{question.explanation}</p>
        </div>
      )}

      {isAnswered && (
        <button
          type="button"
          onClick={handleNext}
          className={cn(
            "w-full rounded-full py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:opacity-90 active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            accentClasses.bg
          )}
        >
          {isLastQuestion ? "Voir le score" : "Question suivante"}
        </button>
      )}
    </div>
  );
}
