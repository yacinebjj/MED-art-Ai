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
    current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [currentIndex]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Navigation entre les questions"
      className={cn("flex gap-2 overflow-x-auto scroll-smooth pb-1", className)}
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
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 active:scale-90",
              isCurrent
                ? "scale-110 bg-primary-600 text-white shadow-glow dark:bg-primary-500"
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
