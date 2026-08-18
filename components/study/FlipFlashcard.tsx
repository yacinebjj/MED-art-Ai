"use client";

/**
 * NotebookLM-style flashcard surface — a real CSS 3D flip (perspective +
 * rotateY + backface-visibility), not a show/hide toggle, plus the full set
 * of session controls (see-answer button, prev/next navigation, correct/
 * incorrect scoring). Self-contained: ActiveFlashcardsDeck only supplies data
 * and handlers, every interaction lives here.
 *
 * Theme-aware by construction, not by special-casing dark mode: both faces
 * use `bg-card text-card-foreground border border-border` — the same
 * semantic tokens every other surface in this app (Card, Dialog, etc.) uses,
 * which already resolve to the right light/dark values via next-themes. The
 * back face adds a `border-primary` accent instead of a separate tinted
 * background, so light and dark mode never need distinct color branches here.
 */

import { useEffect } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { FlashcardPoolItem } from "@/types/flashcard";

interface FlipFlashcardProps {
  item: FlashcardPoolItem;
  index: number;
  total: number;
  flipped: boolean;
  onFlip: () => void;
  onPrev: () => void;
  onNext: () => void;
  canGoPrev: boolean;
  score: { correct: number; incorrect: number };
  onGrade: (isCorrect: boolean) => void;
}

export function FlipFlashcard({ item, index, total, flipped, onFlip, onPrev, onNext, canGoPrev, score, onGrade }: FlipFlashcardProps) {
  // Spacebar flips the current card — guarded so it never hijacks Space
  // while the student happens to have a text field focused elsewhere on the
  // page (this view has none, but the guard costs nothing and is the
  // correct default for a global keydown listener).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      onFlip();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFlip]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Carte {index + 1} / {total}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {score.correct}
          </span>
          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
            <X className="h-3.5 w-3.5" />
            {score.incorrect}
          </span>
        </span>
      </div>

      <div className="[perspective:1200px]">
        <button
          type="button"
          onClick={onFlip}
          aria-label={flipped ? "Revenir à la question" : "Voir la réponse"}
          className={cn(
            "relative min-h-[260px] w-full cursor-pointer rounded-2xl text-left [transform-style:preserve-3d] transition-transform duration-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            flipped && "[transform:rotateY(180deg)]"
          )}
        >
          {/* Front — Question */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-sm [backface-visibility:hidden]">
            <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Question</span>
            <p className="text-base font-semibold leading-relaxed">{item.question}</p>
            <span className="mt-2 text-[10px] text-muted-foreground/70">Clique, ou appuie sur Espace, pour voir la réponse</span>
          </div>

          {/* Back — Answer */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-primary bg-card p-6 text-center text-card-foreground shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="text-[10px] font-black uppercase tracking-wide text-primary-700 dark:text-primary-300">Réponse</span>
            <p className="text-base font-medium leading-relaxed">{item.answer}</p>
            <span className="mt-2 text-[10px] text-muted-foreground/70">Clique, ou appuie sur Espace, pour revenir à la question</span>
          </div>
        </button>
      </div>

      <div className="flex justify-center">
        <Button type="button" variant="secondary" size="sm" onClick={onFlip}>
          {flipped ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" />
              Voir la question
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" />
              Voir la réponse
            </>
          )}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" aria-label="Carte précédente" onClick={onPrev} disabled={!canGoPrev}>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onGrade(false)}
            className="bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300"
          >
            <X className="h-3.5 w-3.5" />
            Incorrect
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onGrade(true)}
            className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300"
          >
            <Check className="h-3.5 w-3.5" />
            Correct
          </Button>
        </div>

        <Button type="button" variant="ghost" size="icon" aria-label="Carte suivante" onClick={onNext}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
