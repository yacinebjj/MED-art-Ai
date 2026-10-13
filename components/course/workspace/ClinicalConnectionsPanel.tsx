"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link2, Loader2, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudio } from "@/lib/translations/studio";

interface ClinicalConnectionsPanelProps {
  courseId: number;
}

/**
 * On-demand "Connexions cliniques" insight for the Explication tile —
 * click only (never on mount), nothing persisted (no new column, no cache
 * table on either end). Real sibling-course titles are looked up server-side
 * (see app/api/studio/clinical-connections/route.ts); this component only
 * ever renders whatever the model actually returned, never a placeholder
 * dressed up as a real connection.
 */
export function ClinicalConnectionsPanel({ courseId }: ClinicalConnectionsPanelProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [connections, setConnections] = useState<string[] | null>(null);

  async function handleClick() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/studio/clinical-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? tStudio("clinicalConnectionsError", language));
      setConnections(data.connections);
    } catch (error) {
      toast({ variant: "error", title: error instanceof Error ? error.message : tStudio("clinicalConnectionsError", language) });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="not-prose my-6">
      {!connections ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-50/60 px-4 py-2.5 text-sm font-semibold text-violet-700 shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:bg-violet-100/80 hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-60 dark:bg-violet-950/20 dark:text-violet-300 dark:hover:bg-violet-950/40"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {isLoading ? tStudio("clinicalConnectionsLoading", language) : tStudio("clinicalConnectionsButton", language)}
        </button>
      ) : (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="glass-card rounded-2xl border border-violet-300/50 p-4 shadow-glass dark:border-violet-800/50 dark:shadow-glass-dark"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                <Sparkles className="h-3 w-3" />
                {tStudio("clinicalConnectionsTitle", language)}
              </p>
              <button
                type="button"
                onClick={() => setConnections(null)}
                aria-label={tStudio("clinicalConnectionsDismiss", language)}
                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <ul className="mt-2.5 space-y-2">
              {connections.map((connection, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
                  <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span>{connection}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
