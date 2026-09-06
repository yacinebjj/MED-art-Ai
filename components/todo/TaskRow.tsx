"use client";

import { AnimatePresence, motion, Reorder, useDragControls, useMotionValue, useTransform } from "framer-motion";
import { Check, Clock, GripVertical, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/Checkbox";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import type { StudyPlanTask } from "@/types/study-planner";

type ContentBadge = "qcm" | "clinical" | "revision" | null;
type WorkloadBadge = "long" | "quick" | null;

/**
 * Every badge here is derived from a real field (title text, hours) — none
 * of them come from a stored/fabricated priority. Checked in priority order
 * (QCM > Clinique > Révision) so a title matching more than one pattern
 * still renders exactly one deterministic content badge.
 */
function deriveContentBadge(title: string): ContentBadge {
  if (/\bqcm\b/i.test(title)) return "qcm";
  if (/cas clinique|cas pratique|\bclinique\b/i.test(title)) return "clinical";
  if (/r[ée]vision|r[ée]viser|rappel|relecture/i.test(title)) return "revision";
  return null;
}

function deriveWorkloadBadge(hours: number | null): WorkloadBadge {
  if (hours === null) return null;
  if (hours >= 3) return "long";
  if (hours <= 1) return "quick";
  return null;
}

const BADGE_STYLES: Record<Exclude<ContentBadge, null>, string> = {
  qcm: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  clinical: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  revision: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const BADGE_LABEL_KEY = {
  qcm: "qcmBadge",
  clinical: "clinicalBadge",
  revision: "revisionBadge",
} as const;

function ContentBadgePill({ badge, language }: { badge: Exclude<ContentBadge, null>; language: Language }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", BADGE_STYLES[badge])}>
      {tTodo(BADGE_LABEL_KEY[badge], language)}
    </span>
  );
}

function WorkloadBadgePill({ badge, language }: { badge: Exclude<WorkloadBadge, null>; language: Language }) {
  return (
    <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline">
      {tTodo(badge === "long" ? "longSessionBadge" : "quickWinBadge", language)}
    </span>
  );
}

const SWIPE_THRESHOLD = 88;

interface TaskRowProps {
  task: StudyPlanTask;
  variant?: "hero" | "compact";
  reorderable: boolean;
  showAiButton: boolean;
  onToggle: (task: StudyPlanTask) => void;
  onDelete: (task: StudyPlanTask) => void;
  onSuggest: (task: StudyPlanTask) => void;
  isSuggesting: boolean;
  suggestions: string[] | null;
  onDismissSuggestions: (taskId: number) => void;
}

/**
 * One reusable row for the hero + every accordion. Drag-to-reorder (grip,
 * vertical) and swipe-to-complete/delete (row body, horizontal) are two
 * deliberately separate hit zones — the grip sits OUTSIDE the swipeable
 * card rather than inside it, so the two gestures can never fight over the
 * same pointer-down.
 */
export function TaskRow({
  task,
  variant = "compact",
  reorderable,
  showAiButton,
  onToggle,
  onDelete,
  onSuggest,
  isSuggesting,
  suggestions,
  onDismissSuggestions,
}: TaskRowProps) {
  const { language } = useLanguage();
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const completeOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const deleteOpacity = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0]);

  const contentBadge = deriveContentBadge(task.title);
  const workloadBadge = deriveWorkloadBadge(task.hours);

  function handleDragEnd(_event: unknown, info: { offset: { x: number } }) {
    if (info.offset.x >= SWIPE_THRESHOLD && !task.isCompleted) {
      onToggle(task);
    } else if (info.offset.x <= -SWIPE_THRESHOLD) {
      onDelete(task);
    }
  }

  const row = (
    <div className="flex items-stretch gap-1">
      {reorderable && (
        <button
          type="button"
          onPointerDown={(e) => dragControls.start(e)}
          className="flex h-auto w-12 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-muted-foreground/40 transition-colors hover:bg-accent hover:text-muted-foreground active:cursor-grabbing"
          aria-label={tTodo("dragHandleAriaLabel", language)}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      <div className="relative min-w-0 flex-1">
        <motion.div
          style={{ opacity: completeOpacity }}
          className="absolute inset-y-0 left-0 z-0 flex w-24 items-center justify-start rounded-l-2xl bg-emerald-500 pl-4 text-white"
        >
          <Check className="h-5 w-5" />
        </motion.div>
        <motion.div
          style={{ opacity: deleteOpacity }}
          className="absolute inset-y-0 right-0 z-0 flex w-24 items-center justify-end rounded-r-2xl bg-destructive pr-4 text-destructive-foreground"
        >
          <Trash2 className="h-5 w-5" />
        </motion.div>

        <motion.div
          drag="x"
          dragConstraints={{ left: -SWIPE_THRESHOLD - 24, right: SWIPE_THRESHOLD + 24 }}
          dragElastic={0.15}
          dragDirectionLock
          dragSnapToOrigin
          style={{ x }}
          onDragEnd={handleDragEnd}
          whileDrag={{ scale: 1.01 }}
          className={cn(
            "glass-card relative z-10 flex min-h-12 items-center gap-2.5 rounded-2xl border p-2.5 shadow-glass transition-colors duration-300 dark:shadow-glass-dark sm:gap-3",
            task.isCompleted ? "border-border/60" : "border-border hover:border-primary/20 hover:shadow-soft",
            variant === "hero" && "p-3"
          )}
        >
          <label className="flex min-h-12 flex-1 cursor-pointer items-center gap-3">
            <Checkbox checked={task.isCompleted} onCheckedChange={() => onToggle(task)} className="h-5 w-5 shrink-0" />
            <span className={cn("flex-1 text-sm transition-colors", task.isCompleted ? "text-muted-foreground line-through" : "text-foreground")}>
              {task.title}
            </span>
          </label>

          <div className="flex shrink-0 items-center gap-1.5">
            {contentBadge && <ContentBadgePill badge={contentBadge} language={language} />}
            {workloadBadge && <WorkloadBadgePill badge={workloadBadge} language={language} />}
            {task.hours !== null && (
              <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground sm:flex">
                <Clock className="h-3 w-3" />
                {task.hours}h
              </span>
            )}
            {showAiButton && !task.isCompleted && (
              <button
                type="button"
                onClick={() => onSuggest(task)}
                disabled={isSuggesting}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-violet-500 transition-colors hover:bg-violet-500/10 disabled:opacity-60"
                aria-label={tTodo("aiSuggestAriaLabel", language)}
                title={tTodo("aiSuggestAriaLabel", language)}
              >
                {isSuggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(task)}
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive sm:flex"
              aria-label={tTodo("deleteAriaLabel", language)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );

  return (
    <div>
      {reorderable ? (
        <Reorder.Item value={task.id} dragListener={false} dragControls={dragControls} as="div">
          {row}
        </Reorder.Item>
      ) : (
        row
      )}
      <AnimatePresence>
        {suggestions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="ml-9 mt-1 overflow-hidden rounded-xl border-l-2 border-violet-300 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/20"
          >
            <div className="flex items-start justify-between gap-2 px-3 py-2">
              <ul className="flex-1 space-y-1 text-xs text-muted-foreground">
                {suggestions.map((suggestion, i) => (
                  <li key={i}>• {suggestion}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onDismissSuggestions(task.id)}
                aria-label={tTodo("aiSuggestDismiss", language)}
                className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
