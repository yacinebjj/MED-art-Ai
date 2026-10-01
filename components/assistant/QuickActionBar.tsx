"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Layers, Lightbulb, ListChecks, Scale, SlidersHorizontal, Stethoscope, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant, type ASSISTANT_TRANSLATIONS } from "@/lib/translations/assistant";
import { Switch } from "@/components/ui/Switch";
import { ASSISTANT_STYLES, type AssistantMode, type AssistantPrefs, type AssistantStyle } from "@/lib/assistant-modes";

type TranslationKey = keyof typeof ASSISTANT_TRANSLATIONS;

export const QUICK_ACTIONS: { mode: AssistantMode; icon: LucideIcon; label: TranslationKey; placeholder: TranslationKey }[] = [
  { mode: "clinical_case", icon: Stethoscope, label: "modeClinicalCase", placeholder: "placeholderClinicalCase" },
  { mode: "mcq", icon: ListChecks, label: "modeMcq", placeholder: "placeholderMcq" },
  { mode: "differential", icon: Scale, label: "modeDifferential", placeholder: "placeholderDifferential" },
  { mode: "summary", icon: FileText, label: "modeSummary", placeholder: "placeholderSummary" },
  { mode: "simplify", icon: Lightbulb, label: "modeSimplify", placeholder: "placeholderSimplify" },
  { mode: "flashcards", icon: Layers, label: "modeFlashcards", placeholder: "placeholderFlashcards" },
];

const STYLE_LABEL: Record<AssistantStyle, { label: TranslationKey; hint: TranslationKey }> = {
  academic: { label: "styleAcademic", hint: "styleAcademicHint" },
  simple: { label: "styleSimple", hint: "styleSimpleHint" },
  patient: { label: "stylePatient", hint: "stylePatientHint" },
};

/**
 * Chips above the composer. A chip does NOT send anything: it arms a quick
 * action ("QCM", "Flashcards"…) for the student's NEXT message, which the
 * server then answers with that action's dedicated instructions (see
 * lib/ai/assistant-prompts.ts). Tapping the armed chip again disarms it. The
 * leading sliders button opens the answer-style settings.
 */
export function QuickActionBar({
  mode,
  onSelectMode,
  prefs,
  onChangePrefs,
  disabled = false,
}: {
  mode: AssistantMode | null;
  onSelectMode: (mode: AssistantMode | null) => void;
  prefs: AssistantPrefs;
  onChangePrefs: (next: AssistantPrefs) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [settingsOpen]);

  const customized = prefs.style !== "academic" || prefs.stepByStep;

  return (
    <div className="relative">
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label={tAssistant("settingsTitle", language)}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-full left-3 right-3 z-40 mb-2 rounded-2xl border border-border bg-popover p-3.5 text-popover-foreground shadow-glass dark:shadow-glass-dark sm:right-auto sm:w-80"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tAssistant("settingsTitle", language)}</p>

            <div role="radiogroup" aria-label={tAssistant("settingsTitle", language)} className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
              {ASSISTANT_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={prefs.style === style}
                  onClick={() => {
                    haptic();
                    onChangePrefs({ ...prefs, style });
                  }}
                  className={cn(
                    "min-h-11 rounded-lg px-2 text-sm font-medium transition-[background-color,color,transform] duration-150 active:scale-95",
                    prefs.style === style ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {tAssistant(STYLE_LABEL[style].label, language)}
                </button>
              ))}
            </div>
            <p className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">{tAssistant(STYLE_LABEL[prefs.style].hint, language)}</p>

            <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-border/70 pt-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{tAssistant("stepByStep", language)}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{tAssistant("stepByStepHint", language)}</span>
              </span>
              <Switch
                checked={prefs.stepByStep}
                onCheckedChange={(checked) => {
                  haptic();
                  onChangePrefs({ ...prefs, stepByStep: checked });
                }}
                aria-label={tAssistant("stepByStep", language)}
              />
            </label>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        role="toolbar"
        aria-label={tAssistant("quickActionsLabel", language)}
        // The chips scroll sideways INSIDE this strip only (contained, pan-x);
        // the page itself can never move — see the thread's overflow-x lock.
        className="flex gap-2 overflow-x-auto overscroll-x-contain px-3 pb-2 pt-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-4"
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            haptic();
            setSettingsOpen((open) => !open);
          }}
          aria-label={tAssistant("settings", language)}
          aria-expanded={settingsOpen}
          className={cn(
            "relative flex h-11 shrink-0 items-center justify-center rounded-full border px-3.5 transition-[transform,background-color] duration-150 active:scale-95",
            settingsOpen || customized
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border bg-card/80 text-muted-foreground"
          )}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
          {customized && <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-card" />}
        </button>

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
                setSettingsOpen(false);
                onSelectMode(active ? null : actionMode);
              }}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-[transform,background-color,color,border-color,box-shadow] duration-150 active:scale-95 disabled:opacity-50",
                active
                  ? "border-emerald-500 bg-emerald-500 text-white shadow-[0_6px_18px_-6px_rgba(16,185,129,0.65)]"
                  : "border-border bg-card/80 text-foreground/80"
              )}
            >
              <Icon className="h-4 w-4" />
              {tAssistant(label, language)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
