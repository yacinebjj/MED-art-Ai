"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface ExamQuestionNavigatorProps {
  total: number;
  currentIndex: number;
  isAnswered: (index: number) => boolean;
  onJump: (index: number) => void;
  className?: string;
}

/**
 * A horizontally-scrollable strip of numbered pills — one per question,
 * filled once answered, glowing on the current one — so a student can jump
 * straight to any question instead of only ever going one-by-one. Purely a
 * navigation aid over state the page already owns (`answers` keyed by
 * question id, `currentIndex`); it never invents a question count or an
 * answered state of its own.
 */
export function ExamQuestionNavigator({ total, currentIndex, isAnswered, onJump, className }: ExamQuestionNavigatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = containerRef.current?.querySelector<HTMLElement>('[data-current="true"]');
    current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [currentIndex]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Navigation entre les questions"
      // Wraps into rows and scrolls VERTICALLY only (never sideways on a phone).
      className={cn("flex max-h-[6.75rem] flex-wrap gap-1.5 overflow-y-auto overflow-x-hidden overscroll-contain scroll-smooth p-1 sm:max-h-32 sm:gap-2", className)}
    >
      {Array.from({ length: total }, (_, i) => {
        const answered = isAnswered(i);
        const isCurrent = i === currentIndex;
        return (
          <button
            key={i}
            type="button"
            data-current={isCurrent || undefined}
            aria-current={isCurrent ? "true" : undefined}
            aria-label={`Question ${i + 1}${answered ? " (répondue)" : " (sans réponse)"}`}
            onClick={() => onJump(i)}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-[transform,background-color,color] duration-200 active:scale-90 sm:h-11 sm:w-11",
              isCurrent
                ? "bg-primary-600 text-white shadow-glow ring-2 ring-primary-300/60 dark:bg-primary-500"
                : answered
                  ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                  : "bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
