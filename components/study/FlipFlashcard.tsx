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

import { useEffect, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Eye, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudyTools } from "@/lib/translations/studyTools";
import type { FlashcardPoolItem } from "@/types/flashcard";

/** A just-graded card shows a brief, warm confirmation before the deck
 * advances — never a bare "Incorrect" stamp, which reads as a scolding. */
export type GradeFeedback = "correct" | "incorrect" | null;

/**
 * Touch swipe tuning (Tinder/Anki-style) — mirrors the swipe-to-change-slide
 * pattern in components/visual-studio/SlideDeckCanvas.tsx: a dead zone
 * decides horizontal-drag vs vertical-scroll once, then the drag either
 * springs back to neutral or flings the card fully off-screen.
 */
const SWIPE_TRIGGER_THRESHOLD_PX = 96;
const SWIPE_AXIS_LOCK_PX = 8;
const SWIPE_EXIT_DISTANCE_PX = 420;
const SWIPE_MAX_ROTATION_DEG = 14;
const SWIPE_EXIT_DURATION_MS = 260;
const SWIPE_SNAP_BACK_DURATION_MS = 240;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

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
  /** Set by the parent for a short window right after grading — freezes
   * navigation and shows the reassuring overlay below instead of an
   * instant, jarring jump to the next card. */
  feedback: GradeFeedback;
}

export function FlipFlashcard({ item, index, total, flipped, onFlip, onPrev, onNext, canGoPrev, score, onGrade, feedback }: FlipFlashcardProps) {
  const { language } = useLanguage();
  const isLocked = feedback !== null;
  const remaining = total - index - 1;

  // Touch swipe (Tinder/Anki-style): dragging the card horizontally grades
  // it without reaching for the buttons below — right = "Correct", left =
  // "À revoir". Runs entirely alongside those buttons (see the JSX below):
  // neither method disables the other, both funnel into the same onGrade,
  // so the parent's post-grade lock (`feedback`/`isLocked` above) applies
  // identically no matter which one the student used.
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Undecided until the gesture clears SWIPE_AXIS_LOCK_PX, then pinned to
  // whichever axis moved further. A "y" lock defers entirely to native
  // vertical scroll (no state updates at all), so a student scrolling the
  // page with a finger that happens to land on the card never drags it.
  const axisRef = useRef<"x" | "y" | null>(null);
  // Set the instant a real horizontal drag begins; read by the flip
  // button's onClick so a swipe that springs back without reaching the
  // grade threshold never ALSO flips the card out from under the student.
  const draggedRef = useRef(false);
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rotation = prefersReducedMotion ? 0 : clamp(dragX / 10, -SWIPE_MAX_ROTATION_DEG, SWIPE_MAX_ROTATION_DEG);

  function handleTouchStart(e: ReactTouchEvent<HTMLDivElement>) {
    if (isLocked || e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    axisRef.current = null;
    draggedRef.current = false;
  }

  function handleTouchMove(e: ReactTouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    if (!start || isLocked || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (axisRef.current === null) {
      if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axisRef.current === "x") {
        draggedRef.current = true;
        setIsDragging(true);
      }
    }

    if (axisRef.current !== "x") return; // vertical gesture — left to native scroll, untouched
    setDragX(dx);
  }

  function handleTouchEnd() {
    const axis = axisRef.current;
    const finalDragX = dragX;
    touchStartRef.current = null;
    axisRef.current = null;
    setIsDragging(false);

    if (axis !== "x") {
      setDragX(0);
      return;
    }

    if (Math.abs(finalDragX) >= SWIPE_TRIGGER_THRESHOLD_PX) {
      const isCorrect = finalDragX > 0;
      if (prefersReducedMotion) {
        // No flung-card motion for this student — the existing post-grade
        // overlay below is confirmation enough.
        setDragX(0);
      } else {
        setIsExiting(true);
        setDragX(isCorrect ? SWIPE_EXIT_DISTANCE_PX : -SWIPE_EXIT_DISTANCE_PX);
      }
      onGrade(isCorrect);
    } else {
      setDragX(0); // below threshold — spring back to neutral
    }
  }

  // A cancelled gesture (e.g. an incoming call) is not a deliberate
  // release — reset without grading rather than reusing handleTouchEnd.
  function handleTouchCancel() {
    touchStartRef.current = null;
    axisRef.current = null;
    setIsDragging(false);
    setDragX(0);
  }

  // Spacebar flips the current card — guarded so it never hijacks Space
  // while the student happens to have a text field focused elsewhere on the
  // page (this view has none, but the guard costs nothing and is the
  // correct default for a global keydown listener). Also suppressed during
  // the post-grade feedback beat, same as every other control below.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || isLocked) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      onFlip();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onFlip, isLocked]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>
            {tStudyTools("cardCounterLabel", language)} {index + 1} / {total}
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            {remaining > 0
              ? (remaining > 1
                  ? tStudyTools("cardsRemainingPlural", language)
                  : tStudyTools("cardsRemainingSingular", language)
                ).replace("{n}", String(remaining))
              : tStudyTools("lastCard", language)}
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
        <Progress value={((index + 1) / Math.max(total, 1)) * 100} className="h-1.5" />
      </div>

      <div className="relative rounded-2xl">
        {/* Swipeable layer — carries the drag/exit transform in isolation so
            the feedback overlay below (a sibling, not a child) stays put on
            screen even once this has been flung off to one side. */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          style={
            isDragging || dragX !== 0 || isExiting
              ? {
                  transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
                  transition:
                    isDragging || prefersReducedMotion
                      ? "none"
                      : `transform ${isExiting ? SWIPE_EXIT_DURATION_MS : SWIPE_SNAP_BACK_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
                }
              : undefined
          }
          className="rounded-2xl transition-transform duration-300 ease-out [perspective:1200px] [touch-action:pan-y] hover:-translate-y-0.5"
        >
          <button
            type="button"
            onClick={() => {
              // A drag that just ended (whether it sprang back or crossed
              // the grade threshold) must never ALSO flip the card via a
              // trailing synthetic click.
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              onFlip();
            }}
            disabled={isLocked}
            aria-label={flipped ? tStudyTools("ariaReturnToQuestion", language) : tStudyTools("ariaSeeAnswer", language)}
            className={cn(
              "grid min-h-[260px] w-full cursor-pointer rounded-2xl text-left [transform-style:preserve-3d] transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default",
              flipped && "[transform:rotateY(180deg)]"
            )}
          >
            {/* Front — Question */}
            <div className="[grid-area:1/1] flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-sm [backface-visibility:hidden]">
              <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{tStudyTools("questionLabel", language)}</span>
              <p className="text-base font-semibold leading-relaxed">{item.question}</p>
              <span className="mt-2 text-[10px] text-muted-foreground/70">{tStudyTools("frontHint", language)}</span>
            </div>

            {/* Back — Answer */}
            <div className="[grid-area:1/1] flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-primary bg-card p-6 text-center text-card-foreground shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <span className="text-[10px] font-black uppercase tracking-wide text-primary-700 dark:text-primary-300">{tStudyTools("answerLabel", language)}</span>
              <p className="text-base font-medium leading-relaxed">{item.answer}</p>
              <span className="mt-2 text-[10px] text-muted-foreground/70">{tStudyTools("backHint", language)}</span>
            </div>
          </button>
        </div>

        {/* Warm, brief confirmation after grading — never a bare red
            "wrong" stamp. Sits on its own non-transformed layer, a sibling
            of the swipeable card above rather than a child of it, so it
            stays centered on screen even when a swipe just sent the card
            flying off to one side. Never blocks input (pointer-events-none)
            since the controls below are already disabled for the same
            window. */}
        {feedback && (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl transition-opacity duration-200",
              feedback === "correct" ? "bg-emerald-500/10" : "bg-rose-500/10"
            )}
          >
            <div
              className={cn(
                "flex animate-in items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-lg zoom-in-95 fade-in duration-200",
                feedback === "correct" ? "bg-emerald-500" : "bg-rose-500"
              )}
            >
              {feedback === "correct" ? <Sparkles className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
              {feedback === "correct" ? tStudyTools("feedbackCorrect", language) : tStudyTools("feedbackIncorrect", language)}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <Button type="button" variant="secondary" size="sm" onClick={onFlip} disabled={isLocked}>
          {flipped ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" />
              {tStudyTools("buttonSeeQuestion", language)}
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" />
              {tStudyTools("ariaSeeAnswer", language)}
            </>
          )}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="icon" aria-label={tStudyTools("ariaPrevCard", language)} onClick={onPrev} disabled={!canGoPrev || isLocked}>
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <Button type="button" variant="ghost" size="icon" aria-label={tStudyTools("ariaNextCard", language)} onClick={onNext} disabled={isLocked}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onGrade(false)}
            disabled={isLocked}
            className="h-11 bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {tStudyTools("reviewAgain", language)}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onGrade(true)}
            disabled={isLocked}
            className="h-11 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300"
          >
            <Check className="h-3.5 w-3.5" />
            {tStudyTools("correctLabel", language)}
          </Button>
        </div>
      </div>
    </div>
  );
}
