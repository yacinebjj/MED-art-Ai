"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Layers, Lightbulb, ListChecks, Scale, Stethoscope, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant, type ASSISTANT_TRANSLATIONS } from "@/lib/translations/assistant";
import type { AssistantMode } from "@/lib/assistant-modes";

type TranslationKey = keyof typeof ASSISTANT_TRANSLATIONS;

export const QUICK_ACTIONS: { mode: AssistantMode; icon: LucideIcon; label: TranslationKey; placeholder: TranslationKey }[] = [
  { mode: "clinical_case", icon: Stethoscope, label: "modeClinicalCase", placeholder: "placeholderClinicalCase" },
  { mode: "mcq", icon: ListChecks, label: "modeMcq", placeholder: "placeholderMcq" },
  { mode: "differential", icon: Scale, label: "modeDifferential", placeholder: "placeholderDifferential" },
  { mode: "summary", icon: FileText, label: "modeSummary", placeholder: "placeholderSummary" },
  { mode: "simplify", icon: Lightbulb, label: "modeSimplify", placeholder: "placeholderSimplify" },
  { mode: "flashcards", icon: Layers, label: "modeFlashcards", placeholder: "placeholderFlashcards" },
];

/**
 * Chips above the composer. A chip does NOT send anything: it arms a quick
 * action ("QCM", "Flashcards"…) for the student's NEXT message, which the
 * server then answers with that action's dedicated instructions (see
 * lib/ai/assistant-prompts.ts). Tapping the armed chip again disarms it.
 */
export function QuickActionBar({
  mode,
  onSelectMode,
  disabled = false,
}: {
  mode: AssistantMode | null;
  onSelectMode: (mode: AssistantMode | null) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const stripRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // Which ends have more chips beyond them: only those fade (.copilot-chip-strip, app/globals.css).
  const [overflow, setOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const strip = stripRef.current;
    const row = rowRef.current;
    if (!strip || !row) return;
    const measure = () => {
      const start = strip.scrollLeft > 1;
      const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    measure();
    strip.addEventListener("scroll", measure, { passive: true });
    // The strip's own width (window, history panel) and the chips' (language switch).
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    observer.observe(row);
    return () => {
      strip.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={stripRef}
      role="toolbar"
      data-tour="asst-quick"
      aria-label={tAssistant("quickActionsLabel", language)}
      data-fade-start={overflow.start ? "" : undefined}
      data-fade-end={overflow.end ? "" : undefined}
      // The chips scroll sideways INSIDE this strip only (contained, pan-x);
      // the page itself can never move — see the thread's overflow-x lock.
      className="copilot-chip-strip overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* w-max + mx-auto: centred while the chips fit, scrolling from the first one once they don't. */}
      <div ref={rowRef} className="mx-auto flex w-max gap-2 px-4 pb-3 pt-1">
        {QUICK_ACTIONS.map(({ mode: actionMode, icon: Icon, label }) => {
          const active = mode === actionMode;
          return (
            <button
              key={actionMode}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                haptic();
                onSelectMode(active ? null : actionMode);
              }}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium transition-[transform,background-color,color,border-color,box-shadow] duration-150 active:scale-95 disabled:opacity-50 sm:h-10",
                active
                  ? "border-transparent bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_8px_20px_-10px_rgba(14,165,233,0.75)]"
                  : "border-black/[0.06] bg-white/60 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.08] dark:hover:text-white"
              )}
            >
              <Icon strokeWidth={1.75} className={cn("h-4 w-4", active ? "text-white" : "text-sky-600 dark:text-sky-300")} />
              {tAssistant(label, language)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
