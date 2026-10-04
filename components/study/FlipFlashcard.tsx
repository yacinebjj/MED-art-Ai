"use client";

/**
 * Flashcard surface — a real CSS 3D flip (perspective + rotateY +
 * backface-visibility) inside a desktop-only 3D micro-tilt, with magnetic
 * Difficile / Moyen / Facile rating buttons (keys 1 / 2 / 3), Space to flip,
 * and Tinder/Anki-style touch swipes (right = Moyen, left = Difficile).
 * Self-contained: ActiveFlashcardsDeck only supplies data and handlers.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";
import { motion } from "framer-motion";
import { Brain, ChevronLeft, ChevronRight, Eye, Flame, Gauge, RotateCcw, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { tStudyTools } from "@/lib/translations/studyTools";
import { ParticleBurst } from "@/components/cyber/primitives";
import { useBurst, useCyberTilt, useMagnetic } from "@/components/cyber/hooks";
import type { FlashcardPoolItem } from "@/types/flashcard";

/** A just-graded card shows a brief, warm confirmation before the deck advances. */
export type GradeFeedback = "correct" | "incorrect" | null;

/** Self-assessed recall quality. "hard" counts as "à revoir", "medium"/"easy" as recalled. */
export type FlashcardRating = "hard" | "medium" | "easy";

const SWIPE_TRIGGER_THRESHOLD_PX = 96;
const SWIPE_AXIS_LOCK_PX = 8;
const SWIPE_EXIT_DISTANCE_PX = 420;
const SWIPE_MAX_ROTATION_DEG = 14;
const SWIPE_EXIT_DURATION_MS = 260;
const SWIPE_SNAP_BACK_DURATION_MS = 240;

const RATING_COPY: Record<Language, Record<FlashcardRating, { label: string; hint: string }>> = {
  fr: {
    hard: { label: "Difficile", hint: "À revoir" },
    medium: { label: "Moyen", hint: "Retrouvé avec effort" },
    easy: { label: "Facile", hint: "Acquis" },
  },
  en: {
    hard: { label: "Hard", hint: "Review again" },
    medium: { label: "Good", hint: "Recalled with effort" },
    easy: { label: "Easy", hint: "Mastered" },
  },
};

const RATING_STYLE: Record<FlashcardRating, { icon: typeof Flame; className: string; glow: string; key: string }> = {
  hard: {
    icon: Flame,
    key: "1",
    glow: "rgb(251 113 133)",
    className: "border-rose-400/40 bg-rose-500/10 text-rose-100 hover:border-rose-300/70 hover:bg-rose-500/20 hover:shadow-[0_0_26px_rgba(244,63,94,0.4)]",
  },
  medium: {
    icon: Gauge,
    key: "2",
    glow: "rgb(251 191 36)",
    className: "border-amber-400/40 bg-amber-500/10 text-amber-100 hover:border-amber-300/70 hover:bg-amber-500/20 hover:shadow-[0_0_26px_rgba(245,158,11,0.4)]",
  },
  easy: {
    icon: Zap,
    key: "3",
    glow: "rgb(52 211 153)",
    className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300/70 hover:bg-emerald-500/20 hover:shadow-[0_0_26px_rgba(16,185,129,0.4)]",
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const RatingButton = memo(function RatingButton({
  rating,
  language,
  disabled,
  onRate,
}: {
  rating: FlashcardRating;
  language: Language;
  disabled: boolean;
  onRate: (rating: FlashcardRating) => void;
}) {
  const ref = useMagnetic<HTMLButtonElement>(0.18);
  const style = RATING_STYLE[rating];
  const copy = RATING_COPY[language][rating];
  const Icon = style.icon;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onRate(rating)}
      disabled={disabled}
      className={cn(
        "cyber-magnetic group relative flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl border px-1.5 transition-[background-color,border-color,box-shadow] duration-200 active:scale-95 sm:min-h-[3.75rem] sm:px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40",
        style.className
      )}
    >
      <span aria-hidden className="cyber-sheen" />
      <span className="flex min-w-0 max-w-full items-center gap-1.5 text-sm font-black">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{copy.label}</span>
      </span>
      <span className="hidden max-w-full truncate text-[10px] font-semibold opacity-70 min-[400px]:block">
        {copy.hint} <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-mono sm:inline">{style.key}</kbd>
      </span>
    </button>
  );
});

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
  onGrade: (isCorrect: boolean, rating: FlashcardRating) => void;
  /** Set by the parent right after grading — freezes navigation and shows the overlay. */
  feedback: GradeFeedback;
}

export function FlipFlashcard({ item, index, total, flipped, onFlip, onPrev, onNext, canGoPrev, score, onGrade, feedback }: FlipFlashcardProps) {
  const { language } = useLanguage();
  const isLocked = feedback !== null;
  const remaining = total - index - 1;
  const tiltRef = useCyberTilt<HTMLDivElement>(5);
  const [burstNonce, fireBurst] = useBurst();
  const [lastRating, setLastRating] = useState<FlashcardRating>("medium");

  // Touch swipe: right = "Moyen" (recalled), left = "Difficile". Funnels into the same rate() as the buttons.
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  // Undecided until the gesture clears SWIPE_AXIS_LOCK_PX; a "y" lock defers to native scroll.
  const axisRef = useRef<"x" | "y" | null>(null);
  // A drag that just ended must never ALSO flip the card via the trailing click.
  const draggedRef = useRef(false);
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rotation = prefersReducedMotion ? 0 : clamp(dragX / 10, -SWIPE_MAX_ROTATION_DEG, SWIPE_MAX_ROTATION_DEG);

  function rate(rating: FlashcardRating) {
    if (isLocked) return;
    setLastRating(rating);
    fireBurst();
    onGrade(rating !== "hard", rating);
  }

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

    if (axisRef.current !== "x") return;
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
      const recalled = finalDragX > 0;
      if (prefersReducedMotion) {
        setDragX(0);
      } else {
        setIsExiting(true);
        setDragX(recalled ? SWIPE_EXIT_DISTANCE_PX : -SWIPE_EXIT_DISTANCE_PX);
      }
      rate(recalled ? "medium" : "hard");
    } else {
      setDragX(0);
    }
  }

  function handleTouchCancel() {
    touchStartRef.current = null;
    axisRef.current = null;
    setIsDragging(false);
    setDragX(0);
  }

  // Space flips, 1 / 2 / 3 rate, arrows navigate — never while typing, never during the feedback beat.
  // One listener for the card's lifetime: it reads the latest props through a ref (no re-subscribe per render).
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (isLocked || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
    if (e.code === "Space") {
      e.preventDefault();
      onFlip();
    } else if (e.key === "1") rate("hard");
    else if (e.key === "2") rate("medium");
    else if (e.key === "3") rate("easy");
    else if (e.key === "ArrowRight") onNext();
    else if (e.key === "ArrowLeft" && canGoPrev) onPrev();
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Stable identity so the memoized rating buttons don't re-render on every parent render.
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const stableRate = useCallback((rating: FlashcardRating) => rateRef.current(rating), []);

  const progressPct = ((index + 1) / Math.max(total, 1)) * 100;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
          <span>
            {tStudyTools("cardCounterLabel", language)} <b className="text-white">{index + 1}</b> / {total}
            <span className="mx-1.5 text-slate-600">·</span>
            {remaining > 0
              ? (remaining > 1 ? tStudyTools("cardsRemainingPlural", language) : tStudyTools("cardsRemainingSingular", language)).replace("{n}", String(remaining))
              : tStudyTools("lastCard", language)}
          </span>
          <span className="flex items-center gap-3 tabular-nums">
            <span className="text-emerald-300">✓ {score.correct}</span>
            <span className="text-rose-300">↺ {score.incorrect}</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="h-full w-full origin-left rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-violet-500 shadow-[0_0_12px_rgba(34,211,238,0.6)]"
            initial={false}
            animate={{ scaleX: progressPct / 100 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <div className="relative">
        {/* Swipe layer — carries the drag/exit transform in isolation from the overlay. */}
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
          className="[touch-action:pan-y]"
        >
          {/* Desktop 3D micro-tilt layer (CSS vars, no re-render). */}
          <div ref={tiltRef} className="cyber-tilt relative rounded-[1.75rem] [perspective:1400px]">
            <div
              role="button"
              tabIndex={isLocked ? -1 : 0}
              aria-disabled={isLocked}
              onClick={() => {
                if (isLocked) return;
                if (draggedRef.current) {
                  draggedRef.current = false;
                  return;
                }
                onFlip();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isLocked) {
                  e.preventDefault();
                  onFlip();
                }
              }}
              aria-label={flipped ? tStudyTools("ariaReturnToQuestion", language) : tStudyTools("ariaSeeAnswer", language)}
              className={cn(
                // Height follows the screen, never the text: long cards scroll inside their face,
                // so the rating buttons below always stay on screen.
                "grid h-[clamp(260px,46dvh,440px)] w-full cursor-pointer rounded-[1.75rem] text-left [transform-style:preserve-3d] transition-transform duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                isLocked && "cursor-default",
                flipped && "[transform:rotateY(180deg)]"
              )}
            >
              {/* Front — Question */}
              <div className="relative flex min-h-0 flex-col items-center gap-3 overflow-hidden rounded-[1.75rem] border border-cyan-400/25 cyber-face-front p-5 text-center shadow-[0_30px_80px_-30px_rgba(34,211,238,0.45)] [backface-visibility:hidden] [grid-area:1/1] sm:p-7">
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.18),transparent_60%)]" />
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
                <span className="relative flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">
                  <Brain className="h-3 w-3" />
                  {tStudyTools("questionLabel", language)}
                </span>
                <div className="cyber-scrollbar relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain">
                  <p className={cn("my-auto break-words font-bold leading-relaxed text-white [overflow-wrap:anywhere]", item.question.length > 180 ? "text-base sm:text-lg" : "text-lg sm:text-xl")}>{item.question}</p>
                </div>
                <span className="relative shrink-0 text-[11px] text-slate-400">{tStudyTools("frontHint", language)}</span>
              </div>

              {/* Back — Answer */}
              <div className="relative flex min-h-0 flex-col items-center gap-3 overflow-hidden rounded-[1.75rem] border border-violet-400/35 cyber-face-back p-5 text-center shadow-[0_30px_80px_-30px_rgba(139,92,246,0.5)] [backface-visibility:hidden] [grid-area:1/1] [transform:rotateY(180deg)] sm:p-7">
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(139,92,246,0.22),transparent_60%)]" />
                <span className="relative flex shrink-0 items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-violet-200">
                  <Sparkles className="h-3 w-3" />
                  {tStudyTools("answerLabel", language)}
                </span>
                <div className="cyber-scrollbar relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain">
                  <p className={cn("my-auto break-words font-medium leading-relaxed text-slate-100 [overflow-wrap:anywhere]", item.answer.length > 260 ? "text-sm sm:text-base" : "text-base sm:text-lg")}>{item.answer}</p>
                </div>
                <span className="relative shrink-0 text-[11px] text-slate-400">{tStudyTools("backHint", language)}</span>
              </div>
            </div>
            <span aria-hidden className="cyber-reflect" />
          </div>
        </div>

        {/* Post-grade confirmation, on its own non-transformed layer. */}
        {feedback && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={cn(
                "relative flex animate-in items-center gap-2 rounded-full px-5 py-2.5 text-sm font-black text-slate-950 shadow-lg zoom-in-95 fade-in duration-200",
                feedback === "correct" ? "bg-emerald-300 shadow-[0_0_30px_rgba(52,211,153,0.6)]" : "bg-rose-300 shadow-[0_0_30px_rgba(251,113,133,0.6)]"
              )}
            >
              <ParticleBurst nonce={burstNonce} color={RATING_STYLE[lastRating].glow} count={12} spread={70} />
              {feedback === "correct" ? <Sparkles className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
              {feedback === "correct" ? tStudyTools("feedbackCorrect", language) : tStudyTools("feedbackIncorrect", language)}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <button
          type="button"
          aria-label={tStudyTools("ariaPrevCard", language)}
          onClick={onPrev}
          disabled={!canGoPrev || isLocked}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onFlip}
          disabled={isLocked}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm font-bold text-cyan-100 transition-colors hover:bg-cyan-400/20 disabled:opacity-40 sm:px-4"
        >
          {flipped ? <RotateCcw className="h-4 w-4 shrink-0" /> : <Eye className="h-4 w-4 shrink-0" />}
          <span className="truncate">{flipped ? tStudyTools("buttonSeeQuestion", language) : tStudyTools("ariaSeeAnswer", language)}</span>
          <kbd className="ml-1 hidden rounded border border-cyan-300/30 px-1.5 font-mono text-[10px] sm:inline">Espace</kbd>
        </button>
        <button
          type="button"
          aria-label={tStudyTools("ariaNextCard", language)}
          onClick={onNext}
          disabled={isLocked}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5">
        {(["hard", "medium", "easy"] as const).map((rating) => (
          <RatingButton key={rating} rating={rating} language={language} disabled={isLocked} onRate={stableRate} />
        ))}
      </div>
    </div>
  );
}
