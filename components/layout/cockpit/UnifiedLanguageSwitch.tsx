"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useLanguageStore } from "@/store/useLanguageStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";

const OPTIONS: { value: Language; label: string }[] = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
];

/**
 * One switch for BOTH languages: the interface (LanguageProvider) and the
 * AI-generated content (the global Zustand store, store/useLanguageStore.ts,
 * read by every Studio / Lab / flashcard prompt). The per-tool AI-language
 * selects keep working for a student who wants them to differ.
 */
export function UnifiedLanguageSwitch({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  const aiLanguage = useLanguageStore((state) => state.language);
  const setAiLanguage = useLanguageStore((state) => state.setLanguage);

  function select(value: Language) {
    setLanguage(value);
    setAiLanguage(value);
  }

  const mixed = aiLanguage !== language;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="radiogroup"
          aria-label={language === "fr" ? "Langue de l'interface et du contenu IA" : "Interface and AI-content language"}
          className={cn("relative flex items-center rounded-xl border border-border/60 bg-background/60 p-0.5", className)}
        >
          {OPTIONS.map((option) => {
            const active = language === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => select(option.value)}
                className={cn(
                  "relative z-10 rounded-[10px] px-2.5 py-1 text-[11px] font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-white" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active && (
                  <motion.span
                    layoutId="unified-language-pill"
                    className="absolute inset-0 -z-10 rounded-[10px] bg-gradient-to-br from-primary-500 to-violet-500 shadow-glow"
                    transition={{ type: "spring", stiffness: 500, damping: 36 }}
                  />
                )}
                {option.label}
              </button>
            );
          })}
          {mixed && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background" />}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {language === "fr"
          ? `Interface et contenu IA${mixed ? ` (IA actuellement en ${aiLanguage.toUpperCase()})` : ""}`
          : `Interface and AI content${mixed ? ` (AI currently in ${aiLanguage.toUpperCase()})` : ""}`}
      </TooltipContent>
    </Tooltip>
  );
}
