"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useHydrateLanguageStore, useLanguageStore, type ContentLanguage } from "@/store/useLanguageStore";

const OPTIONS: { value: ContentLanguage; label: string }[] = [
  { value: "fr", label: "🇫🇷 Français" },
  { value: "en", label: "🇬🇧 English" },
];

/** The two segments of the toggle variant: short codes, the full name for screen readers and the tooltip. */
const TOGGLE_OPTIONS: { value: ContentLanguage; short: string; name: string }[] = [
  { value: "fr", short: "FR", name: "Français" },
  { value: "en", short: "EN", name: "English" },
];

const TOOLTIP_TEXT = "Langue du contenu généré (Studio, Lab, flashcards)";

/** Mount once (app/dashboard/layout.tsx): applies the persisted AI-content language after hydration. Renders nothing. */
export function LanguageStoreHydrator() {
  useHydrateLanguageStore();
  return null;
}

/**
 * The single selector for the language of AI-generated content — bound to the
 * global store, so changing it here changes it for every Studio tile, every
 * Lab tool and the flashcards at once. `compact` drops the label for tight
 * headers. `variant="toggle"` (the Studio header): a two-segment FR | EN
 * switch with a sliding thumb instead of a dropdown — one click, and both
 * choices always in view.
 */
export function AiLanguageSelect({
  compact = false,
  variant = "select",
  className,
}: {
  compact?: boolean;
  variant?: "select" | "toggle";
  className?: string;
}) {
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  if (variant === "toggle") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex shrink-0 items-center gap-1.5", className)}>
            <Languages aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
            <div
              role="radiogroup"
              aria-label={TOOLTIP_TEXT}
              className="relative grid h-8 w-[5.25rem] grid-cols-2 rounded-full border border-zinc-200/80 bg-zinc-100/80 p-0.5 dark:border-white/[0.08] dark:bg-white/[0.05]"
            >
              {/* The thumb: one white pill under the active code, gliding between the two halves. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-0.125rem)] rounded-full bg-white shadow-[0_1px_2px_rgba(24,24,27,0.12),0_2px_6px_-2px_rgba(24,24,27,0.12)] ring-1 ring-black/[0.04] transition-transform duration-300 ease-out dark:bg-zinc-700 dark:shadow-[0_1px_2px_rgba(0,0,0,0.5)] dark:ring-white/[0.08]",
                  language === "en" && "translate-x-full"
                )}
              />
              {TOGGLE_OPTIONS.map((option) => {
                const active = language === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={option.name}
                    onClick={() => setLanguage(option.value)}
                    className={cn(
                      "relative z-10 flex items-center justify-center rounded-full text-[11px] font-semibold tracking-[0.06em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "text-zinc-900 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    )}
                  >
                    {option.short}
                  </button>
                );
              })}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>{TOOLTIP_TEXT}</TooltipContent>
      </Tooltip>
    );
  }

  const select = (
    <div className={cn("flex items-center gap-1.5", className)}>
      {!compact && <Languages aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <Select
        value={language}
        onValueChange={(value) => setLanguage(value === "en" ? "en" : "fr")}
        options={OPTIONS}
        className={cn("h-8 rounded-lg py-1 text-xs font-medium shadow-none", compact ? "w-[7.5rem] px-2" : "w-[8.5rem] px-2.5")}
      />
    </div>
  );

  if (!compact) return select;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{select}</TooltipTrigger>
      <TooltipContent>{TOOLTIP_TEXT}</TooltipContent>
    </Tooltip>
  );
}
