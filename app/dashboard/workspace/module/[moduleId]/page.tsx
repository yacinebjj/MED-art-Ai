"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "next-themes";
import { AlertTriangle, BookOpenText, FileSpreadsheet, History, Layers, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { PROSE_CLASSES, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, DARK_MARKDOWN_COMPONENTS, normalizeCallouts } from "@/lib/markdown";
import type { StudioCourseSummary } from "@/types/studio-course";

/**
 * PHASE 2 — real generation calls wired to
 * app/api/workspace/module-synthesis/route.ts.
 *
 * ── TOKEN-LIMIT ARCHITECTURE (implemented server-side, see that route) ────
 * The route prefers each selected course's already-generated Explication
 * over raw_text (falling back to a bounded raw_text slice only when no
 * Explication exists yet — surfaced below via `fallbackNotice`), enforces a
 * combined character ceiling across every selected course regardless of
 * count, caches the OUTPUT cross-student keyed by the selected courses'
 * combined content_hash + generation type, and reserves against courseCap
 * via reserveGeneration()/refundGeneration() only on a genuine cache miss.
 *
 * ── NOTE ON THE EXISTING "Résumé global du module" MODAL ──────────────────
 * components/dashboard/GlobalSummaryModal.tsx already does a simpler version
 * of source-selection + single-summary generation, via the same
 * GET /api/studio/courses?moduleId= endpoint this page reuses below. This
 * Workspace is a superset (adds the keyword table, a dedicated full-screen
 * layout, richer output styling) — the two are left coexisting for now (see
 * the kebab-menu comment in CurriculumView.tsx); worth revisiting whether
 * the modal becomes redundant once this ships for real.
 */

type SelectAllState = "checked" | "unchecked" | "indeterminate";
type WorkspaceGenerationType = "global_summary" | "keywords_table";

interface HistoryEntry {
  id: string;
  type: WorkspaceGenerationType;
  /** 1-indexed count among entries of the SAME type this session — what "Résumé 1"/"Tableau 2" actually numbers. */
  ordinal: number;
  timestamp: number;
  content: string;
}

/**
 * ADDITIVE border overrides layered on top of the shared PROSE_CLASSES/
 * DARK_PROSE_CLASSES (lib/markdown.tsx) — deliberately NOT edited into that
 * shared file, since it's also used by the chat reader, the demo workspace,
 * and InteractiveQuiz; changing it there would restyle tables everywhere in
 * the app, not just here. PROSE_CLASSES already sets `prose-td:border-t
 * prose-td:border-slate-200` (top-only) plus a blue-600 `prose-th`
 * background and alternating row tint — this only ADDS the missing sides
 * and collapses the border model, reusing the SAME slate-200 color already
 * in play (not the gray-300 first suggested) so it doesn't create a real
 * two-different-colors conflict on the same border. Dark mode gets the
 * equivalent addition against DARK_PROSE_CLASSES' own white/10 border tint.
 */
const TABLE_BORDER_OVERRIDES_LIGHT = "prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-td:border prose-th:text-center";
const TABLE_BORDER_OVERRIDES_DARK = "prose-table:border-collapse prose-th:border prose-th:border-white/10 prose-td:border prose-th:text-center";

export default function ModuleWorkspacePage() {
  const params = useParams<{ moduleId: string }>();
  const moduleId = Number(params.moduleId);
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  const [moduleTitle, setModuleTitle] = useState<string>("");

  const [courses, setCourses] = useState<StudioCourseSummary[] | null>(null);
  const [coursesError, setCoursesError] = useState(false);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [retryToken, setRetryToken] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingKeywords, setIsGeneratingKeywords] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  /** Set when the API reports some selected courses had no Explication generated yet, so their raw source text was used instead — see the route's own comment. Cleared on every new generation attempt. */
  const [fallbackNotice, setFallbackNotice] = useState<string[] | null>(null);

  /** Session-only (not persisted) — generating a keyword table no longer discards the summary that was on screen a moment ago. Newest first. */
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(moduleId)) return;
    let cancelled = false;

    fetch(`/api/curriculum/modules/${moduleId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { module?: { title?: string } }) => {
        if (!cancelled && body.module?.title) setModuleTitle(body.module.title);
      })
      .catch(() => {
        /* Non-fatal — the page still works with an empty header title, same
           tolerance as every other secondary-detail fetch this session. */
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId]);

  useEffect(() => {
    if (!Number.isInteger(moduleId)) return;
    let cancelled = false;
    setCoursesLoading(true);
    setCoursesError(false);

    fetch(`/api/studio/courses?moduleId=${moduleId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body: { success: boolean; courses?: StudioCourseSummary[] }) => {
        if (cancelled) return;
        if (!body.success || !Array.isArray(body.courses)) throw new Error("Réponse invalide.");
        setCourses(body.courses);
        // A fresh course list can drop a previously-selected id (e.g. deleted
        // elsewhere in another tab) — prune rather than carry a dangling
        // selection forward.
        setSelectedIds((prev) => new Set(body.courses!.filter((c) => prev.has(c.id)).map((c) => c.id)));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[ModuleWorkspacePage] Échec du chargement des cours:", error);
        setCoursesError(true);
      })
      .finally(() => {
        if (!cancelled) setCoursesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [moduleId, retryToken]);

  const selectAllState: SelectAllState = useMemo(() => {
    if (!courses || courses.length === 0) return "unchecked";
    if (selectedIds.size === 0) return "unchecked";
    if (selectedIds.size === courses.length) return "checked";
    return "indeterminate";
  }, [courses, selectedIds]);

  function toggleAll() {
    if (!courses) return;
    // Indeterminate or fully-unchecked -> select everything; fully-checked -> clear.
    setSelectedIds(selectAllState === "checked" ? new Set() : new Set(courses.map((c) => c.id)));
  }

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasSelection = selectedIds.size > 0;
  const isGenerating = isGeneratingSummary || isGeneratingKeywords;

  async function generate(type: WorkspaceGenerationType) {
    const setLoading = type === "global_summary" ? setIsGeneratingSummary : setIsGeneratingKeywords;
    setLoading(true);
    setFallbackNotice(null);
    try {
      const res = await fetch("/api/workspace/module-synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId, courseIds: Array.from(selectedIds), type }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) {
        toast({ variant: "error", title: "Échec de la génération", description: body?.error ?? "Réessaie." });
        return;
      }
      const content = body.content as string;
      setOutput(content);

      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        ordinal: history.filter((h) => h.type === type).length + 1,
        timestamp: Date.now(),
        content,
      };
      setHistory((prev) => [entry, ...prev]);
      setActiveHistoryId(entry.id);

      if (Array.isArray(body.coursesUsingRawTextFallback) && body.coursesUsingRawTextFallback.length > 0) {
        setFallbackNotice(body.coursesUsingRawTextFallback as string[]);
      }
      // Per-course cache reporting (course_workspace_cache) — a request
      // almost never used to be a clean "all cached" vs "all generated"
      // before the modular-chunk pivot; now it's normal for most requests
      // to be a mix, which is exactly the point.
      if (body.fullyCached) {
        toast({ variant: "success", title: "Entièrement en cache", description: "Résultat instantané, aucun coût de génération." });
      } else if (typeof body.coursesFromCache === "number" && body.coursesFromCache > 0) {
        toast({
          variant: "success",
          title: "Génération partielle",
          description: `${body.coursesFromCache} cours déjà en cache, ${body.coursesGenerated} générés à l'instant.`,
        });
      }
    } catch {
      toast({ variant: "error", title: "Échec de la génération", description: "Impossible de contacter le serveur." });
    } finally {
      setLoading(false);
    }
  }

  const handleGenerateGlobalSummary = () => generate("global_summary");
  const handleGenerateKeywordTable = () => generate("keywords_table");

  /** Instant, no network call — just swaps which already-fetched result is on screen. */
  function viewHistoryEntry(entry: HistoryEntry) {
    setOutput(entry.content);
    setActiveHistoryId(entry.id);
    setFallbackNotice(null);
  }

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 dark:bg-neutral-950">
      <WorkspaceTopbar title={moduleTitle || "Résumé du module"} />

      <div className="flex min-h-0 flex-1">
        {/* ── Sources sidebar ─────────────────────────────────────────── */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-4 dark:border-neutral-800">
            <Layers className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Sources du module</h2>
          </div>

          {courses && courses.length > 0 && (
            <label className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3 transition-colors hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60">
              <Checkbox
                checked={selectAllState === "indeterminate" ? "indeterminate" : selectAllState === "checked"}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                Sélectionner tout {selectedIds.size > 0 && `(${selectedIds.size}/${courses.length})`}
              </span>
            </label>
          )}

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {coursesLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-11 animate-pulse rounded-xl bg-gray-100 dark:bg-neutral-800" />
                ))}
              </div>
            ) : coursesError ? (
              <div className="p-2">
                <ErrorState message="Échec du chargement des cours de ce module." onRetry={() => setRetryToken((t) => t + 1)} />
              </div>
            ) : !courses || courses.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BookOpenText className="h-7 w-7 text-gray-300 dark:text-neutral-700" />
                <p className="text-sm text-gray-500 dark:text-gray-400">Aucun cours généré dans ce module pour l'instant.</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {courses.map((course) => (
                  <li key={course.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800/60",
                        selectedIds.has(course.id) && "bg-teal-50 dark:bg-teal-500/10"
                      )}
                    >
                      <Checkbox checked={selectedIds.has(course.id)} onCheckedChange={() => toggleOne(course.id)} className="mt-0.5" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700 dark:text-gray-200">{course.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {history.length > 0 && (
            <>
              <hr className="mx-4 my-2 border-gray-200 dark:border-neutral-800" />
              <div className="flex items-center gap-2 px-4 py-2">
                <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Résultats</h2>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto px-2 pb-3">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => viewHistoryEntry(entry)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-gray-50 dark:hover:bg-neutral-800/60",
                        activeHistoryId === entry.id
                          ? "bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                          : "text-gray-600 dark:text-gray-300"
                      )}
                    >
                      {entry.type === "global_summary" ? <Sparkles className="h-3.5 w-3.5 shrink-0" /> : <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />}
                      {entry.type === "global_summary" ? "Résumé" : "Tableau"} {entry.ordinal}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        {/* ── Generation main area ────────────────────────────────────── */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900">
            <Button onClick={handleGenerateGlobalSummary} disabled={!hasSelection || isGenerating} size="lg">
              {isGeneratingSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Générer un Résumé Global
            </Button>
            <Button onClick={handleGenerateKeywordTable} disabled={!hasSelection || isGenerating} variant="secondary" size="lg">
              {isGeneratingKeywords ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Générer Tableau des Mots-Clés
            </Button>
            {!hasSelection && (
              <span className="text-xs text-gray-400 dark:text-gray-500">Sélectionne au moins un cours dans la barre latérale.</span>
            )}
          </div>

          <div className="flex-1 px-6 py-8 md:px-10">
            {fallbackNotice && fallbackNotice.length > 0 && (
              <div className="not-prose mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {fallbackNotice.length} cours sans Explication générée ont utilisé leur texte source brut à la place, pour une
                  qualité de synthèse potentiellement moindre : <strong>{fallbackNotice.join(", ")}</strong>.
                </span>
              </div>
            )}

            {isGenerating ? (
              <div className="flex flex-col items-center gap-4 py-24 text-center">
                <div className="relative flex h-16 w-16 items-center justify-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-teal-400/30" />
                  <Sparkles className="relative h-8 w-8 text-teal-600 dark:text-teal-400" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  {isGeneratingSummary ? "Synthèse des cours en cours..." : "Extraction des mots-clés en cours..."}
                </p>
                <p className="max-w-xs text-xs text-gray-400 dark:text-gray-500">
                  Un instant — l'IA analyse tes sources sélectionnées pour produire une révision de qualité.
                </p>
              </div>
            ) : output ? (
              // Was previously rendered with NO prose wrapper at all — every
              // heading/table/blockquote style this whole page exists to
              // showcase was silently inert. Fixed alongside the requested
              // border overrides (TABLE_BORDER_OVERRIDES_*) rather than as a
              // separate change, since both land on this same element.
              <div className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, isDark ? TABLE_BORDER_OVERRIDES_DARK : TABLE_BORDER_OVERRIDES_LIGHT)}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    ...(isDark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS),
                    // Wraps ONLY the <table> in a horizontal-scroll container —
                    // now that column count is dynamic (per selected courses),
                    // a wide table must scroll internally instead of forcing
                    // the whole page to overflow. Scoped here, not added to
                    // the shared MARKDOWN_COMPONENTS in lib/markdown.tsx,
                    // which every other Markdown surface in the app (chat,
                    // demo pages, quizzes) also renders through.
                    table: ({ ...props }) => (
                      <div className="overflow-x-auto">
                        <table {...props} />
                      </div>
                    ),
                  }}
                >
                  {normalizeCallouts(output)}
                </ReactMarkdown>
              </div>
            ) : (
              <div className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "flex flex-col items-center gap-3 py-24 text-center opacity-60")}>
                <Sparkles className="h-10 w-10 text-teal-500" />
                <p className="!my-0 text-base font-medium not-prose text-gray-500 dark:text-gray-400">
                  Choisis tes sources puis lance une génération pour voir le résultat ici.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
