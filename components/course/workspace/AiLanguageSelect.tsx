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

/** Mount once (app/dashboard/layout.tsx): applies the persisted AI-content language after hydration. Renders nothing. */
export function LanguageStoreHydrator() {
  useHydrateLanguageStore();
  return null;
}

/**
 * The single selector for the language of AI-generated content — bound to the
 * global store, so changing it here changes it for every Studio tile, every
 * Lab tool and the flashcards at once. `compact` drops the label for tight
 * headers.
 */
export function AiLanguageSelect({ compact = false, className }: { compact?: boolean; className?: string }) {
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

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
      <TooltipContent>Langue du contenu généré (Studio, Lab, flashcards)</TooltipContent>
    </Tooltip>
  );
}
