"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, BookOpenText, FileSpreadsheet, History, Layers, Library, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { PROSE_CLASSES, DARK_PROSE_CLASSES, MARKDOWN_COMPONENTS, DARK_MARKDOWN_COMPONENTS, normalizeCallouts } from "@/lib/markdown";
import { PomodoroStudyBanner } from "@/components/layout/PomodoroStudyBanner";
import { createClient } from "@/lib/supabase/client";
import type { StudioCourseSummary } from "@/types/studio-course";
import { useLanguage } from "@/providers/LanguageProvider";
import { tWorkspaceSynthesis } from "@/lib/translations/workspaceSynthesis";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SourcesResultsTabs, type SourcesResultsTab } from "@/components/course/workspace/SourcesResultsTabs";
import { FullscreenToggleButton } from "@/components/ui/FullscreenToggleButton";

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
type WorkspaceGenerationType = "global_summary" | "keywords_table" | "medical_dictionary";

// No per-student Supabase table exists yet for "this student's last
// Workspace output" — course_workspace_cache (see schema.sql) is a GLOBAL,
// cross-student, service-role-only dedup cache keyed by content hash, not a
// per-user history, so it can't answer "what was on this student's screen
// last time". localStorage fills that gap until a real table exists.
//
// SECURITY FIX: this key was previously scoped ONLY by moduleId, with no
// user component at all — since localStorage is scoped to the BROWSER
// ORIGIN, not per-account, this meant Student A generating a Résumé/Table
// on a shared computer (a lab computer, a shared household device) and
// Student B later logging into the SAME browser and opening the SAME
// module would see Student A's own generated content (a real synthesis of
// Student A's own uploaded courses) with zero backend check — a genuine
// cross-account data leak. Found during a security audit. Now namespaced
// by the current user's id (resolved client-side below) — both the restore
// and persist effects are gated on it being resolved first, so neither
// effect ever touches storage before it's known WHOSE slot to use.
const WORKSPACE_HISTORY_STORAGE_PREFIX = "medart_workspace_history_";

function workspaceHistoryStorageKey(userId: string, moduleId: number): string {
  return `${WORKSPACE_HISTORY_STORAGE_PREFIX}${userId}_${moduleId}`;
}

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
  const { language } = useLanguage();
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
  const [isGeneratingDictionary, setIsGeneratingDictionary] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string[] | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // Mobile-first UX rework — below `md`, the aside (sources) and main
  // (results) panels never render side by side any more; a "Sources" /
  // "Résultats" tab switch (SourcesResultsTabs) decides which one shows.
  // Desktop keeps the original permanent split (both always visible),
  // driven off the same isDesktopOrTablet check the Notes page already
  // uses for its own analogous mobile/desktop branch.
  const isDesktopOrTablet = useMediaQuery("(min-width: 768px)");
  const [mobileTab, setMobileTab] = useState<SourcesResultsTab>("sources");
  // Lets any single generated result (Résumé/Tableau/Dictionnaire) expand to
  // fill the whole screen for comfortable reading — mirrors the note
  // editor's own proven `isFullscreen` pattern.
  const [isOutputFullscreen, setIsOutputFullscreen] = useState(false);

  // Resolved once on mount — see workspaceHistoryStorageKey's own comment
  // for why every localStorage read/write below is gated on this being
  // non-null first (never touch storage before knowing WHOSE slot it is).
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled && data.user) setUserId(data.user.id);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore whatever this student last generated for THIS module, once on
  // mount — fixes the reported bug where leaving and coming back lost the
  // summary/keyword table. Deliberately keyed only on `moduleId` and
  // `userId` (not a continuous sync): the save effect below is what keeps
  // localStorage current as new generations happen; this only ever needs
  // to run once, right when the page opens (and once `userId` resolves,
  // whichever happens later).
  useEffect(() => {
    if (!Number.isInteger(moduleId) || !userId) return;
    // One-time cleanup of the OLD, unscoped-by-user key format — if a
    // previous version of this page ever wrote one on this browser, it
    // must never be read by a DIFFERENT account on the same machine again.
    try {
      localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_PREFIX + moduleId);
    } catch {
      // Storage unavailable — nothing to clean up either way.
    }
    try {
      const raw = localStorage.getItem(workspaceHistoryStorageKey(userId, moduleId));
      if (!raw) return;
      const saved = JSON.parse(raw) as { history?: HistoryEntry[]; activeHistoryId?: string | null };
      if (!Array.isArray(saved.history) || saved.history.length === 0) return;
      setHistory(saved.history);
      const active = saved.history.find((h) => h.id === saved.activeHistoryId) ?? saved.history[0];
      setActiveHistoryId(active.id);
      setOutput(active.content);
    } catch {
      // Corrupted or foreign localStorage value — ignore, page just starts empty.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, userId]);

  // Persist after every new/selected entry so a later visit (or a mid-session
  // refresh) can restore it. `output` isn't a dependency here on purpose — it
  // always changes in lockstep with `history`/`activeHistoryId` (a new
  // generation prepends to history AND sets output together; viewHistoryEntry
  // sets both together too), so tracking those two is sufficient.
  useEffect(() => {
    if (!Number.isInteger(moduleId) || !userId || history.length === 0) return;
    try {
      localStorage.setItem(workspaceHistoryStorageKey(userId, moduleId), JSON.stringify({ history, activeHistoryId }));
    } catch {
      // Storage full or unavailable (private browsing) — non-fatal, generation
      // still works for the current session, it just won't survive a reload.
    }
  }, [moduleId, userId, history, activeHistoryId]);

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

  /** Mirrors lib/module-synthesis.ts's own MIN_COURSES_REQUIRED — duplicated as a plain constant rather than imported, since that module pulls in server-only dependencies (getSupabaseAdmin, OpenRouter calls) that have no place in a "use client" bundle. Enforced again server-side in that same route (never trust a client-only gate). */
  const MIN_COURSES_REQUIRED = 5;
  const hasSelection = selectedIds.size >= MIN_COURSES_REQUIRED;
  const isGenerating = isGeneratingSummary || isGeneratingKeywords || isGeneratingDictionary;

  async function generate(type: WorkspaceGenerationType) {
    if (selectedIds.size < MIN_COURSES_REQUIRED) {
      toast({
        variant: "info",
        title: tWorkspaceSynthesis("minSelectionToast", language).replace("{n}", String(MIN_COURSES_REQUIRED)),
      });
      return;
    }
    const setLoading =
      type === "global_summary" ? setIsGeneratingSummary : type === "keywords_table" ? setIsGeneratingKeywords : setIsGeneratingDictionary;
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
        toast({
          variant: "error",
          title: tWorkspaceSynthesis("generationFailedTitle", language),
          description: body?.error ?? tWorkspaceSynthesis("generationFailedRetryDescription", language),
        });
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
      // Dès qu'un résultat est généré, on bascule automatiquement sur l'onglet
      // "Résultats" (mobile uniquement — no-op on desktop, both panels
      // already visible there) pour que l'étudiant le voie sans manipulation.
      setMobileTab("results");

      if (Array.isArray(body.coursesUsingRawTextFallback) && body.coursesUsingRawTextFallback.length > 0) {
        setFallbackNotice(body.coursesUsingRawTextFallback as string[]);
      }
      // Per-course cache reporting (course_workspace_cache) — a request
      // almost never used to be a clean "all cached" vs "all generated"
      // before the modular-chunk pivot; now it's normal for most requests
      // to be a mix, which is exactly the point.
      if (body.fullyCached) {
        toast({
          variant: "success",
          title: tWorkspaceSynthesis("fullyCachedTitle", language),
          description: tWorkspaceSynthesis("fullyCachedDescription", language),
        });
      } else if (typeof body.coursesFromCache === "number" && body.coursesFromCache > 0) {
        toast({
          variant: "success",
          title: tWorkspaceSynthesis("partialGenerationTitle", language),
          description: tWorkspaceSynthesis("partialGenerationDescription", language)
            .replace("{cached}", String(body.coursesFromCache))
            .replace("{generated}", String(body.coursesGenerated)),
        });
      }
    } catch {
      toast({
        variant: "error",
        title: tWorkspaceSynthesis("generationFailedTitle", language),
        description: tWorkspaceSynthesis("generationFailedServerDescription", language),
      });
    } finally {
      setLoading(false);
    }
  }

  const handleGenerateGlobalSummary = () => generate("global_summary");
  const handleGenerateKeywordTable = () => generate("keywords_table");
  const handleGenerateMedicalDictionary = () => generate("medical_dictionary");

  /** Instant, no network call — just swaps which already-fetched result is on screen. */
  function viewHistoryEntry(entry: HistoryEntry) {
    setOutput(entry.content);
    setActiveHistoryId(entry.id);
    setFallbackNotice(null);
    setMobileTab("results");
  }

  // Escape closes the fullscreen result viewer — mirrors the note editor's
  // own identical Escape handler for its fullscreen Card.
  useEffect(() => {
    if (!isOutputFullscreen) return;
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setIsOutputFullscreen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOutputFullscreen]);

  const sourcesHeader = (
    <div className="flex items-center gap-2 border-b border-white/30 px-4 py-4 dark:border-white/10">
      <Layers className="h-4 w-4 text-teal-600 dark:text-teal-400" />
      <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{tWorkspaceSynthesis("sourcesHeading", language)}</h2>
    </div>
  );

  const selectAllRow = courses && courses.length > 0 && (
    <label className="flex cursor-pointer items-center gap-3 border-b border-white/30 px-4 py-3 transition-colors hover:bg-white/50 dark:border-white/10 dark:hover:bg-white/5">
      <Checkbox
        checked={selectAllState === "indeterminate" ? "indeterminate" : selectAllState === "checked"}
        onCheckedChange={toggleAll}
      />
      <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        Sélectionner tout {selectedIds.size > 0 && `(${selectedIds.size}/${courses.length})`}
      </span>
    </label>
  );

  // min-h-0 — a flex child with overflow-y-auto silently refuses to actually
  // clip/scroll without it (flex items default to min-height: auto, so they
  // grow to fit content instead of shrinking to the parent's bound and
  // letting overflow-y-auto do its job).
  const courseListPanel = (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
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
                  "flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-all duration-300 hover:bg-white/50 dark:hover:bg-white/5",
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
  );

  const generateButtonsRow = (
    <div className="flex flex-col gap-2 border-b border-white/30 px-4 py-4 dark:border-white/10 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:px-6">
      <Button onClick={handleGenerateGlobalSummary} disabled={!hasSelection || isGenerating} size="lg" className="w-full sm:w-auto">
        {isGeneratingSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Générer un Résumé Global
      </Button>
      <Button
        onClick={handleGenerateKeywordTable}
        disabled={!hasSelection || isGenerating}
        variant="secondary"
        size="lg"
        className="w-full sm:w-auto"
      >
        {isGeneratingKeywords ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Générer Tableau des Mots-Clés
      </Button>
      <Button
        onClick={handleGenerateMedicalDictionary}
        disabled={!hasSelection || isGenerating}
        variant="secondary"
        size="lg"
        className="w-full sm:w-auto"
      >
        {isGeneratingDictionary ? <Loader2 className="h-4 w-4 animate-spin" /> : <Library className="h-4 w-4" />}
        Générer Dictionnaire Médical
      </Button>
      {!hasSelection && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {tWorkspaceSynthesis("minSelectionHint", language).replace("{n}", String(MIN_COURSES_REQUIRED))} (
          {selectedIds.size}/{MIN_COURSES_REQUIRED}).
        </span>
      )}
    </div>
  );

  const historySection = history.length > 0 && (
    <>
      <hr className="mx-4 my-2 border-white/30 dark:border-white/10" />
      <div className="flex items-center gap-2 px-4 py-2">
        <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{tWorkspaceSynthesis("resultsHeading", language)}</h2>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto px-2 pb-3 md:max-h-56">
        {history.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => viewHistoryEntry(entry)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-300 active:scale-[0.98] hover:bg-white/50 dark:hover:bg-white/5",
                activeHistoryId === entry.id
                  ? "bg-teal-50 text-teal-700 shadow-soft dark:bg-teal-500/10 dark:text-teal-300"
                  : "text-gray-600 dark:text-gray-300"
              )}
            >
              {entry.type === "global_summary" ? (
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
              ) : entry.type === "keywords_table" ? (
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Library className="h-3.5 w-3.5 shrink-0" />
              )}
              {entry.type === "global_summary"
                ? tWorkspaceSynthesis("entryTypeSummary", language)
                : entry.type === "keywords_table"
                  ? tWorkspaceSynthesis("entryTypeTable", language)
                  : tWorkspaceSynthesis("entryTypeDictionary", language)}{" "}
              {entry.ordinal}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  // Point critique de l'UX mobile — un bouton plein écran sur CHAQUE contenu
  // affiché (Résumé, Tableau, Dictionnaire) : le petit bandeau shrink-0
  // ci-dessous (juste le bouton, aligné à droite) reste dans le flux normal
  // tant que isOutputFullscreen est false ; dès qu'il passe à true, TOUT ce
  // wrapper devient `fixed inset-0` et occupe 100% de l'écran, exactement le
  // même mécanisme déjà éprouvé sur l'éditeur de notes.
  const outputPanel = (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isOutputFullscreen && "fixed inset-0 z-50 h-dvh w-screen bg-background"
      )}
    >
      <div className="flex shrink-0 items-center justify-end px-2 pt-2 sm:px-3">
        <FullscreenToggleButton isFullscreen={isOutputFullscreen} onToggle={() => setIsOutputFullscreen((v) => !v)} />
      </div>

      {/* min-h-0 is the real fix here — WITHOUT it, this panel (the one
          actually holding the generated Résumé/Tableau/Dictionnaire) never
          shrinks to its parent's bounded box; it grows to its full content
          height instead, and the parent's own overflow-hidden hard-clips
          anything taller than the visible space with NO scrollbar and NO
          way to reach it — this is the real reason results were reported as
          invisible on mobile, not a missing bottom-nav offset. pb bumped to
          a safe-area-aware ~9rem (well above the previous py-6/py-8) so
          every result and its trailing content is reachable with room to
          spare, not just barely fit. */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 md:px-10",
          isOutputFullscreen ? "pt-0 pb-4 sm:pb-8" : "pt-2 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:pt-2"
        )}
      >
        {fallbackNotice && fallbackNotice.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="not-prose mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {fallbackNotice.length} cours sans Explication générée ont utilisé leur texte source brut à la place, pour une
              qualité de synthèse potentiellement moindre : <strong>{fallbackNotice.join(", ")}</strong>.
            </span>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {isGenerating ? (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-4 py-16 text-center sm:py-24"
            >
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-teal-400/30" />
                <Sparkles className="relative h-8 w-8 text-teal-600 dark:text-teal-400" />
              </div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                {isGeneratingSummary
                  ? "Synthèse des cours en cours..."
                  : isGeneratingKeywords
                    ? "Extraction des mots-clés en cours..."
                    : "Construction du dictionnaire médical en cours..."}
              </p>
              <p className="max-w-xs text-xs text-gray-400 dark:text-gray-500">
                Un instant — l'IA analyse tes sources sélectionnées pour produire une révision de qualité.
              </p>
            </motion.div>
          ) : output ? (
            // Was previously rendered with NO prose wrapper at all — every
            // heading/table/blockquote style this whole page exists to
            // showcase was silently inert. Fixed alongside the requested
            // border overrides (TABLE_BORDER_OVERRIDES_*) rather than as a
            // separate change, since both land on this same element.
            <motion.div
              key="output"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, isDark ? TABLE_BORDER_OVERRIDES_DARK : TABLE_BORDER_OVERRIDES_LIGHT)}
            >
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
                  // Dictionnaire Médical's 3rd column (الشرح بالعربية) is
                  // genuine Arabic text sitting in an otherwise LTR table —
                  // without an explicit direction, the browser's bidi
                  // algorithm can misorder punctuation/parentheses inside
                  // that cell. `dir="auto"` lets each cell resolve its own
                  // direction from its own content (French/term cells stay
                  // ltr, the Arabic cell renders rtl) — same technique
                  // already used for Arabic text elsewhere in the app (e.g.
                  // GastriteCasCliniqueStudio's dialogue bubbles). Harmless
                  // for the other two tabs' tables, which have no Arabic
                  // content to trigger it.
                  td: ({ ...props }) => <td dir="auto" {...props} />,
                  th: ({ ...props }) => <th dir="auto" {...props} />,
                }}
              >
                {normalizeCallouts(output)}
              </ReactMarkdown>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(isDark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "flex flex-col items-center gap-3 py-16 text-center opacity-60 sm:py-24")}
            >
              <span className="flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-teal-50 not-prose dark:bg-teal-500/10">
                <Sparkles className="h-7 w-7 text-teal-500" />
              </span>
              <p className="!my-0 text-base font-medium not-prose text-gray-500 dark:text-gray-400">
                Choisis tes sources puis lance une génération pour voir le résultat ici.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  return (
    // Point 2 fix — w-full max-w-full overflow-hidden on this root: without
    // it, any internal element that overflows horizontally (a wide table, a
    // long unbroken word) could widen this whole flex column past the
    // viewport, breaking the page's vertical layout on mobile instead of
    // staying contained to a horizontal scroll on the ONE element that
    // actually needs it (see the résumé view's own overflow-x-auto table
    // wrappers). Matches app/dashboard/module/[id]/exam/page.tsx's own
    // identical root treatment.
    <div className="aurora-canvas-bg relative flex h-dvh w-full max-w-full flex-col overflow-hidden">
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />
      <WorkspaceTopbar title={moduleTitle || tWorkspaceSynthesis("defaultModuleTitle", language)} />

      <PomodoroStudyBanner />

      {/* Mobile-first UX rework — below `md`, aside/main never render side
          by side any more (there was too little room for either once one
          held a real generated result). A "Sources" / "Résultats" tab
          switch decides which single panel shows: "Sources" groups course
          selection + the 3 generation buttons; "Résultats" groups the
          history list + whichever result is open (with its own fullscreen
          toggle). Desktop (md:+) keeps the original permanent side-by-side
          split, both panels always visible, completely unchanged. */}
      {!isDesktopOrTablet && (
        <div className="px-3 pt-3">
          <SourcesResultsTabs
            active={mobileTab}
            onChange={setMobileTab}
            sourcesLabel={tWorkspaceSynthesis("mobileSourcesTab", language)}
            resultsLabel={tWorkspaceSynthesis("mobileResultsTab", language)}
            resultsCount={history.length}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row md:gap-4 md:p-4">
        {isDesktopOrTablet ? (
          <>
            {/* ── Sources sidebar (desktop) ───────────────────────────── */}
            <aside className="glass-card flex max-h-[40vh] w-full shrink-0 flex-col overflow-hidden rounded-3xl shadow-glass dark:shadow-glass-dark md:h-auto md:max-h-none md:w-80">
              {sourcesHeader}
              {selectAllRow}
              {courseListPanel}
              {historySection}
            </aside>

            {/* ── Results / generation main area (desktop) ────────────── */}
            <main className="glass-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl shadow-glass dark:shadow-glass-dark">
              {generateButtonsRow}
              {outputPanel}
            </main>
          </>
        ) : mobileTab === "sources" ? (
          <div className="glass-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl shadow-glass dark:shadow-glass-dark">
            {sourcesHeader}
            {selectAllRow}
            {courseListPanel}
            {generateButtonsRow}
          </div>
        ) : (
          <div className="glass-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl shadow-glass dark:shadow-glass-dark">
            {history.length > 0 ? (
              historySection
            ) : (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">{tWorkspaceSynthesis("noResultsYetHint", language)}</p>
            )}
            {outputPanel}
          </div>
        )}
      </div>
    </div>
  );
}