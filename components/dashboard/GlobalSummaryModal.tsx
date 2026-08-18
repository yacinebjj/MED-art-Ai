"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { DARK_MARKDOWN_COMPONENTS, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, PROSE_CLASSES, normalizeCallouts } from "@/lib/markdown";
import { buildRateLimitMessage } from "@/lib/rate-limit-message";
import type { StudioCourseSummary } from "@/types/studio-course";

interface StoredGlobalSummary {
  text: string;
  generatedAt: string;
  courseIds: number[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/**
 * "Résumé global du module" — lets the student pick which of the module's
 * courses to synthesize together (default: all of them), then displays the
 * cross-course summary from app/api/modules/[id]/global-summary. Loads any
 * already-cached summary on open (free, no AI call) — only the explicit
 * "Générer"/"Régénérer" click spends tokens.
 */
export function GlobalSummaryModal({
  open,
  onOpenChange,
  moduleId,
  moduleTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleId: number;
  moduleTitle: string;
}) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [courses, setCourses] = useState<StudioCourseSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [summary, setSummary] = useState<StoredGlobalSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch(`/api/studio/courses?moduleId=${moduleId}`)
        .then((res) => res.json())
        .catch(() => ({ success: false, courses: [] })),
      fetch(`/api/modules/${moduleId}/global-summary`)
        .then((res) => res.json())
        .catch(() => ({ success: false, summary: null })),
    ])
      .then(([coursesBody, summaryBody]) => {
        if (cancelled) return;
        const loadedCourses: StudioCourseSummary[] = coursesBody?.success ? coursesBody.courses ?? [] : [];
        setCourses(loadedCourses);
        setSelectedIds(new Set(loadedCourses.map((c) => c.id))); // every course selected by default
        setSummary(summaryBody?.success ? summaryBody.summary ?? null : null);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [open, moduleId]);

  function toggleCourse(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (selectedIds.size === 0) {
      toast({ variant: "info", title: "Sélectionne au moins un cours." });
      return;
    }

    setIsGenerating(true);
    try {
      const res = await fetch(`/api/modules/${moduleId}/global-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: Array.from(selectedIds) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(res.status === 429 ? buildRateLimitMessage(res) : data?.error ?? "La génération a échoué.");
      }

      setSummary(data.summary);
      toast({ variant: "success", title: "Résumé global généré" });
    } catch (error) {
      toast({ variant: "error", title: "Échec de la génération", description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onClick={(e) => e.stopPropagation()}
        onOverlayClick={() => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>Résumé global du module</DialogTitle>
          <DialogDescription>
            {moduleTitle} — synthèse inter-cours générée par l&apos;IA.
            {summary && ` Généré le ${formatDate(summary.generatedAt)}.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement...
          </div>
        ) : courses.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Aucun cours dans ce module pour l&apos;instant.</p>
        ) : (
          <div className="space-y-4">
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {courses.map((course) => (
                <label
                  key={course.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(course.id)}
                    onChange={() => toggleCourse(course.id)}
                    className="h-4 w-4 shrink-0 rounded border-input"
                  />
                  <span className="truncate">{course.title}</span>
                </label>
              ))}
            </div>

            <Button size="sm" className="w-full" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {summary ? "Régénérer" : "Générer"}
            </Button>

            {summary && (
              <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border bg-muted/30 p-4">
                <article className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}>
                    {normalizeCallouts(summary.text)}
                  </ReactMarkdown>
                </article>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
