"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tNotes } from "@/lib/translations/notes";

interface NoteSummaryButtonProps {
  getPlainText: () => string;
}

/**
 * On-demand, ephemeral TL;DR for the note currently open — click only
 * (never on mount/selection-change), nothing persisted (no new column, no
 * server-side cache); the popover clears the moment it's dismissed or the
 * student switches notes (this component unmounts/remounts per note since
 * it lives inside the editor pane keyed by note id).
 */
export function NoteSummaryButton({ getPlainText }: NoteSummaryButtonProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleClick() {
    const text = getPlainText().trim();
    if (!text) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/notes/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.summary !== "string") throw new Error(data?.error ?? tNotes("summaryErrorToast", language));
      setSummary(data.summary);
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : tNotes("summaryErrorToast", language) });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-violet-500/30 px-3 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-violet-400 dark:hover:bg-violet-950/30 sm:h-8 sm:w-auto"
      >
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {tNotes("summarizeButton", language)}
      </button>

      <AnimatePresence>
        {summary && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setSummary(null)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="glass-card absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border border-violet-300/50 p-4 shadow-glass dark:border-violet-800/50 dark:shadow-glass-dark sm:w-80"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                  <Sparkles className="h-3 w-3" />
                  {tNotes("summaryTitle", language)}
                </p>
                <button
                  type="button"
                  onClick={() => setSummary(null)}
                  className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{summary}</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
