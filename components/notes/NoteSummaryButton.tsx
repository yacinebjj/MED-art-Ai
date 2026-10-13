"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tNotes } from "@/lib/translations/notes";

interface NoteSummaryButtonProps {
  getPlainText: () => string;
}

/**
 * One-click AI TL;DR for the note currently open — on click only (never on
 * mount/selection-change), nothing persisted; the popover clears when
 * dismissed or when the student switches notes (the editor pane is keyed by
 * note id, so this remounts).
 */
export function NoteSummaryButton({ getPlainText }: NoteSummaryButtonProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  function handleCopy() {
    if (!summary) return;
    navigator.clipboard
      .writeText(summary)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => undefined);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="group relative flex h-10 w-full items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-violet-400/40 bg-violet-500/10 px-3.5 text-xs font-bold text-violet-100 transition-[background-color,box-shadow] hover:bg-violet-500/20 hover:shadow-[0_0_22px_rgba(139,92,246,0.35)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-9 sm:w-auto"
      >
        <span aria-hidden className="cyber-sheen" />
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {tNotes("summarizeButton", language)}
      </button>

      <AnimatePresence>
        {summary && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40 sm:bg-transparent" onClick={() => setSummary(null)} />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              // Phones: a bottom sheet in its own layer (never painted over the note text). sm+: popover.
              className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 rounded-2xl border border-violet-400/40 bg-slate-950 p-4 shadow-[0_20px_60px_-20px_rgba(139,92,246,0.6)] sm:absolute sm:inset-x-auto sm:bottom-full sm:left-0 sm:mb-2 sm:w-96"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">
                  <Sparkles className="h-3 w-3" />
                  {tNotes("summaryTitle", language)}
                </p>
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={handleCopy} aria-label="Copier" className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
                    {copied ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
                  </button>
                  <button type="button" onClick={() => setSummary(null)} aria-label="Fermer" className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </div>
              <p className="cyber-scrollbar mt-2 max-h-[50vh] overflow-y-auto whitespace-pre-line break-words sm:max-h-72 text-sm leading-relaxed text-slate-100">{summary}</p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
