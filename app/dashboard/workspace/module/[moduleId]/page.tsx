"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, BookOpenText, Brain, Check, ChevronRight, Copy, Download, FileSpreadsheet, History, Layers, Library, ListChecks, Loader2, Search, Sparkles, Target, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkspaceTopbar } from "@/components/course/workspace/WorkspaceTopbar";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { useToast } from "@/components/ui/Toast";
import { SynthesisExplorer } from "@/components/dashboard/synthesis/SynthesisExplorer";
import { AiRunGovernor, classifyUpstreamStatus } from "@/lib/ai-run-governor";
import { PomodoroStudyBanner } from "@/components/layout/PomodoroStudyBanner";
import { createClient } from "@/lib/supabase/client";
import type { StudioCourseSummary } from "@/types/studio-course";
import { useLanguage } from "@/providers/LanguageProvider";
import { tWorkspaceSynthesis } from "@/lib/translations/workspaceSynthesis";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { SourcesResultsTabs, type SourcesResultsTab } from "@/components/course/workspace/SourcesResultsTabs";
import { FullscreenToggleButton } from "@/components/ui/FullscreenToggleButton";
import { FullscreenViewerModal } from "@/components/ui/FullscreenViewerModal";
import { NeonRing, SegmentedControl } from "@/components/cyber/primitives";
import { GenerationAura, TelemetryChip } from "@/components/cyber/GenerationAura";
import { useStoredPreference } from "@/components/cyber/hooks";
import { SUMMARY_DEPTHS, SUMMARY_DEPTH_LABELS, needsSynthesisTransform, type SummaryDepth, type SynthesisOptions } from "@/lib/synthesis-options";

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

/**
 * Writes a freshly generated entry straight to storage, independently of
 * React state — so a result that arrives after the student left the page
 * (phone locked, app switched, route changed mid-generation) is still there
 * on return instead of being lost with the unmounted component.
 */
function persistEntryNow(userId: string, moduleId: number, entry: HistoryEntry): void {
  try {
    const key = workspaceHistoryStorageKey(userId, moduleId);
    const raw = localStorage.getItem(key);
    const saved = raw ? (JSON.parse(raw) as { history?: HistoryEntry[] }) : {};
    const history = [entry, ...(Array.isArray(saved.history) ? saved.history.filter((h) => h.id !== entry.id) : [])].slice(0, 30);
    localStorage.setItem(key, JSON.stringify({ history, activeHistoryId: entry.id }));
  } catch {
    // Storage full / blocked: the in-memory state still shows it this session.
  }
}

/** JSON body of /api/workspace/module-synthesis (direct call or batched-run assemble step). */
interface SynthesisResponseBody {
  success?: boolean;
  error?: string;
  content?: string;
  personalized?: boolean;
  personalizationSkipped?: boolean;
  fullyCached?: boolean;
  coursesFromCache?: number;
  coursesGenerated?: number;
  coursesUsingRawTextFallback?: unknown;
  coursesFailedToGenerate?: unknown;
}

interface HistoryEntry {
  /** Personalized summary format ("Synthèse rapide"…), when not the full sheet. */
  variantLabel?: string;
  id: string;
  type: WorkspaceGenerationType;
  /** 1-indexed count among entries of the SAME type this session — what "Résumé 1"/"Tableau 2" actually numbers. */
  ordinal: number;
  timestamp: number;
  content: string;
}

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
  /** Live progress of a large (micro-batched) synthesis run: courses processed / to process, then assembly. */
  const [synthesisProgress, setSynthesisProgress] = useState<{ done: number; total: number; phase: "courses" | "assemble" } | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string[] | null>(null);
  // medical_dictionary ONLY — course titles whose sub-batch failed even after
  // lib/module-synthesis.ts's own per-batch isolation (a network hiccup, a
  // malformed OpenRouter response for that one sub-batch). The request still
  // succeeds overall with whatever DID generate; this just says honestly
  // what's missing instead of silently presenting an incomplete dictionary
  // as if it were complete — see ModuleSynthesisResult's own comment.
  const [dictionaryFailedNotice, setDictionaryFailedNotice] = useState<string[] | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Résumé Global customization (remembered on this device; focus is per session).
  const [summaryDepth, setSummaryDepth] = useStoredPreference<SummaryDepth>("medart:synthesis-depth", "fiche_complete", SUMMARY_DEPTHS);
  const [mnemonicsPref, setMnemonicsPref] = useStoredPreference<"on" | "off">("medart:synthesis-mnemonics", "off", ["on", "off"] as const);
  const [summaryFocus, setSummaryFocus] = useState("");
  const [courseQuery, setCourseQuery] = useState("");
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
  // Purely a local UI micro-interaction (Copy button's checkmark) — reset by
  // its own timeout, never persisted, never affects `output` itself.
  const [justCopied, setJustCopied] = useState(false);

  // Resolved once on mount — see workspaceHistoryStorageKey's own comment
  // for why every localStorage read/write below is gated on this being
  // non-null first (never touch storage before knowing WHOSE slot it is).
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled && data.session?.user) setUserId(data.session.user.id);
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
      // On phones only one panel shows: open "Résultats" so the restored result is actually visible.
      setMobileTab("results");
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
  /** Above this, a synthesis runs as plan → micro-batches → assemble (see runBatchedSynthesis). */
  const DIRECT_SYNTHESIS_MAX_COURSES = 6;
  const summaryOptions: SynthesisOptions = { depth: summaryDepth, focus: summaryFocus.trim(), mnemonics: mnemonicsPref === "on" };
  const summaryPersonalized = needsSynthesisTransform(summaryOptions);
  const hasSelection = selectedIds.size >= MIN_COURSES_REQUIRED;
  const isGenerating = isGeneratingSummary || isGeneratingKeywords || isGeneratingDictionary;

  /**
   * LARGE SELECTIONS (more than DIRECT_SYNTHESIS_MAX_COURSES): a single
   * request generating 10-50 courses outlives Vercel's 300 s limit. Instead:
   *  1. /plan — lists the courses not yet cached, reserves ONE unit, returns a run token;
   *  2. /batch — micro-batches of 3-4 courses, several in parallel under the
   *     adaptive run governor (429 → fewer in flight + pause, silent retry);
   *     every finished batch is cached server-side, progress shown live;
   *  3. assemble — the normal route with the run token: stitching + cross-course
   *     synthesis only, a few seconds.
   * Returns the parsed assemble response body (same shape as the direct call).
   */
  async function runBatchedSynthesis(type: WorkspaceGenerationType, courseIds: number[]): Promise<{ ok: boolean; body: SynthesisResponseBody }> {
    const planRes = await fetch("/api/workspace/module-synthesis/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId, courseIds, type }),
    });
    const plan = (await planRes.json().catch(() => ({}))) as { success?: boolean; error?: string; missingCourseIds?: number[]; runToken?: string | null };
    if (!planRes.ok || !plan.success) return { ok: false, body: plan };

    const missing = plan.missingCourseIds ?? [];
    const batchSize = type === "medical_dictionary" ? 3 : 4;
    const batches: number[][] = [];
    for (let i = 0; i < missing.length; i += batchSize) batches.push(missing.slice(i, i + batchSize));

    let done = 0;
    setSynthesisProgress({ done: 0, total: missing.length, phase: "courses" });
    const governor = new AiRunGovernor({
      deadlineMs: 40 * 60_000,
      stallMs: 8 * 60_000,
      maxConcurrency: type === "medical_dictionary" ? 6 : 4,
      breakerThreshold: 6,
      minAttemptWindowMs: 20_000,
    });
    const queue = [...batches];
    async function worker() {
      while (queue.length > 0) {
        const batch = queue.shift()!;
        for (let attempt = 1; attempt <= 3; attempt++) {
          if (!(await governor.acquire())) return;
          let status = 0;
          let retryAfter: number | null = null;
          try {
            const res = await fetch("/api/workspace/module-synthesis/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moduleId, courseIds: batch, type, runToken: plan.runToken }),
            });
            status = res.status;
            retryAfter = Number(res.headers.get("Retry-After")) || null;
            const data = (await res.json().catch(() => ({}))) as { success?: boolean };
            if (res.ok && data.success) {
              governor.reportSuccess();
              break;
            }
          } catch {
            status = 0;
          } finally {
            governor.release();
          }
          const upstream = classifyUpstreamStatus(status);
          if (upstream) governor.reportUpstreamFailure(upstream, retryAfter);
          if (status === 403 || status === 400) break; // expired token / invalid: retrying cannot help
          if (upstream !== "overload") await new Promise((r) => setTimeout(r, 2500 * attempt));
        }
        // Counted whether it succeeded or not: assembly reports any course still missing.
        done += batch.length;
        setSynthesisProgress({ done: Math.min(done, missing.length), total: missing.length, phase: "courses" });
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(6, batches.length)) }, worker));

    setSynthesisProgress({ done: missing.length, total: missing.length, phase: "assemble" });
    const res = await fetch("/api/workspace/module-synthesis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        moduleId,
        courseIds,
        type,
        ...(plan.runToken ? { runToken: plan.runToken } : {}),
        ...(type === "global_summary" ? { options: summaryOptions } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as SynthesisResponseBody;
    return { ok: res.ok && body.success === true, body };
  }

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
    setDictionaryFailedNotice(null);
    try {
      let ok: boolean;
      let body: SynthesisResponseBody;
      if (selectedIds.size > DIRECT_SYNTHESIS_MAX_COURSES) {
        ({ ok, body } = await runBatchedSynthesis(type, Array.from(selectedIds)));
      } else {
        const res = await fetch("/api/workspace/module-synthesis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId, courseIds: Array.from(selectedIds), type, ...(type === "global_summary" ? { options: summaryOptions } : {}) }),
        });
        body = (await res.json().catch(() => ({}))) as SynthesisResponseBody;
        ok = res.ok && Boolean(body.success);
      }
      if (!ok) {
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
        ...(type === "global_summary" && body.personalized ? { variantLabel: SUMMARY_DEPTH_LABELS[summaryOptions.depth].label } : {}),
      };
      if (type === "global_summary" && body.personalizationSkipped) {
        toast({ variant: "info", title: "Personnalisation indisponible pour l'instant", description: "Voici la fiche complète ; relance pour obtenir le format choisi." });
      }
      if (userId) persistEntryNow(userId, moduleId, entry);
      setHistory((prev) => [entry, ...prev]);
      setActiveHistoryId(entry.id);
      // Dès qu'un résultat est généré, on bascule automatiquement sur l'onglet
      // "Résultats" (mobile uniquement — no-op on desktop, both panels
      // already visible there) pour que l'étudiant le voie sans manipulation.
      setMobileTab("results");

      if (Array.isArray(body.coursesUsingRawTextFallback) && body.coursesUsingRawTextFallback.length > 0) {
        setFallbackNotice(body.coursesUsingRawTextFallback as string[]);
      }
      if (Array.isArray(body.coursesFailedToGenerate) && body.coursesFailedToGenerate.length > 0) {
        setDictionaryFailedNotice(body.coursesFailedToGenerate as string[]);
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
      setSynthesisProgress(null);
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

  const selectionRatio = Math.min(1, selectedIds.size / MIN_COURSES_REQUIRED);
  const sourcesHeader = (
    <div className="space-y-3 border-b border-white/[0.07] px-4 py-4">
      <div className="flex items-center gap-3">
        <NeonRing value={selectionRatio} size={46} stroke={4} from={hasSelection ? "#34d399" : "#22d3ee"} to="#8b5cf6" aria-label={`${selectedIds.size} cours sélectionnés sur ${MIN_COURSES_REQUIRED} minimum`}>
          <Layers className="h-4 w-4 text-cyan-400" />
        </NeonRing>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-foreground">{tWorkspaceSynthesis("sourcesHeading", language)}</h2>
          <p className="text-xs text-muted-foreground">
            {hasSelection ? `${selectedIds.size} cours prêts` : `${selectedIds.size} / ${MIN_COURSES_REQUIRED} minimum`} · {courses?.length ?? 0} disponibles
          </p>
        </div>
      </div>
      {courses && courses.length > 6 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={courseQuery}
            onChange={(e) => setCourseQuery(e.target.value)}
            placeholder="Filtrer les cours…"
            className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/50"
          />
        </div>
      )}
    </div>
  );

  const selectAllRow = courses && courses.length > 0 && (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent">
      <Checkbox
        checked={selectAllState === "indeterminate" ? "indeterminate" : selectAllState === "checked"}
        onCheckedChange={toggleAll}
      />
      <span className="text-sm font-semibold text-foreground">
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
            <div key={i} className="h-11 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : coursesError ? (
        <div className="p-2">
          <ErrorState message="Échec du chargement des cours de ce module." onRetry={() => setRetryToken((t) => t + 1)} />
        </div>
      ) : !courses || courses.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <BookOpenText className="h-7 w-7 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Aucun cours généré dans ce module pour l'instant.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {courses
            .filter((course) => !courseQuery.trim() || course.title.toLowerCase().includes(courseQuery.trim().toLowerCase()))
            .map((course) => {
            const isSelected = selectedIds.has(course.id);
            return (
              <li key={course.id}>
                {/* "Magnetic" selection card — a subtle lift + glow on the
                    checked state, matching the app's other recently-
                    redesigned card-selection surfaces (e.g. the Module
                    Workspace's own Sources panel), instead of a flat
                    checkbox row with no real affordance beyond its tint. */}
                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-[border-color,background-color,box-shadow,transform] duration-200",
                    isSelected
                      ? "border-cyan-400/50 bg-cyan-400/10 shadow-[0_0_20px_-8px_rgba(34,211,238,0.7)]"
                      : "border-transparent hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.03]"
                  )}
                >
                  <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(course.id)} className="mt-0.5" />
                  <span className={cn("min-w-0 flex-1 break-words text-sm font-medium [overflow-wrap:anywhere]", isSelected ? "text-cyan-700 dark:text-cyan-100" : "text-foreground")}>
                    {course.title}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const GENERATION_TILES = [
    { type: "global_summary" as const, icon: Sparkles, title: "Résumé Global", short: "Résumé", hint: summaryPersonalized ? SUMMARY_DEPTH_LABELS[summaryDepth].label : "Fiche complète par cours", tone: "from-cyan-300 to-sky-500", loading: isGeneratingSummary, onClick: handleGenerateGlobalSummary },
    { type: "keywords_table" as const, icon: FileSpreadsheet, title: "Tableau des Mots-Clés", short: "Mots-clés", hint: "Notions classées par catégorie", tone: "from-violet-400 to-fuchsia-500", loading: isGeneratingKeywords, onClick: handleGenerateKeywordTable },
    { type: "medical_dictionary" as const, icon: Library, title: "Dictionnaire Médical", short: "Dictionnaire", hint: "Termes expliqués FR / عربي", tone: "from-amber-300 to-orange-500", loading: isGeneratingDictionary, onClick: handleGenerateMedicalDictionary },
  ];

  // Desktop: open until a first result exists. Phones: collapsed (it would squeeze the course list).
  const renderSummaryOptions = (openByDefault: boolean) => (
    <details open={openByDefault} className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-bold text-foreground">
        <span className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-cyan-400" />
          Personnaliser le Résumé Global
          {summaryPersonalized && <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] font-black text-cyan-600 dark:text-cyan-200">Actif</span>}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-3 px-3.5 pb-3.5">
        <SegmentedControl<SummaryDepth>
          size="sm"
          ariaLabel="Format du résumé"
          value={summaryDepth}
          onChange={setSummaryDepth}
          options={SUMMARY_DEPTHS.map((value) => ({ value, label: SUMMARY_DEPTH_LABELS[value].label }))}
        />
        <p className="text-[11px] text-muted-foreground">{SUMMARY_DEPTH_LABELS[summaryDepth].hint}</p>
        <div className="relative">
          <Target className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={summaryFocus}
            onChange={(e) => setSummaryFocus(e.target.value.slice(0, 160))}
            placeholder="Cibler (optionnel) : ex. traitement, sémiologie, examens…"
            className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400/50"
          />
        </div>
        <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.08] px-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Brain className="h-4 w-4 text-violet-400" />
            Ajouter des moyens mnémotechniques
          </span>
          <input type="checkbox" checked={mnemonicsPref === "on"} onChange={(e) => setMnemonicsPref(e.target.checked ? "on" : "off")} className="h-4 w-4 accent-cyan-500" />
        </label>
      </div>
    </details>
  );

  const generateButtonsRow = (
    <div className="space-y-3 border-b border-white/[0.07] px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 md:bg-transparent md:pb-4">
      {isDesktopOrTablet && renderSummaryOptions(!output)}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {GENERATION_TILES.map(({ type, icon: Icon, title, short, hint, tone, loading, onClick }) => (
          <button
            key={type}
            type="button"
            onClick={onClick}
            disabled={!hasSelection || isGenerating}
            className="group relative flex min-h-[4.5rem] flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2 text-center transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-cyan-400/40 hover:shadow-[0_0_26px_-10px_rgba(34,211,238,0.8)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 sm:min-h-[5.5rem] sm:flex-row sm:justify-start sm:gap-3 sm:p-3.5 sm:text-left"
          >
            <span aria-hidden className="cyber-sheen" />
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-slate-950 sm:h-11 sm:w-11", tone)}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4 sm:h-5 sm:w-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black text-foreground sm:hidden">{short}</span>
              <span className="hidden text-sm font-black text-foreground sm:block">{title}</span>
              <span className="hidden truncate text-[11px] text-muted-foreground sm:block">{hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="hidden flex-wrap gap-2 sm:flex">
        <TelemetryChip icon={ListChecks}>
          {selectedIds.size} cours sélectionnés{!hasSelection ? ` · min. ${MIN_COURSES_REQUIRED}` : ""}
        </TelemetryChip>
        {hasSelection && <TelemetryChip icon={BookOpenText}>{selectedIds.size} chapitres à générer</TelemetryChip>}
        <TelemetryChip icon={Sparkles}>Chapitres déjà générés : servis instantanément</TelemetryChip>
      </div>
    </div>
  );

  const historySection = history.length > 0 && (
    <>
      <hr className="mx-4 my-2 border-border" />
      <div className="flex items-center gap-2 px-4 py-2">
        <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        <h2 className="text-sm font-bold text-foreground">{tWorkspaceSynthesis("resultsHeading", language)}</h2>
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto px-2 pb-3 md:max-h-56">
        {history.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => viewHistoryEntry(entry)}
              className={cn(
                "flex min-h-12 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all duration-300 hover:bg-accent active:scale-[0.98]",
                activeHistoryId === entry.id
                  ? "bg-teal-50 text-teal-700 shadow-soft dark:bg-teal-500/10 dark:text-teal-300"
                  : "text-muted-foreground"
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
              {entry.variantLabel && <span className="ml-1 truncate text-[11px] font-semibold opacity-70">· {entry.variantLabel}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  // Shared between the inline (non-fullscreen) panel and the portaled
  // FullscreenViewerModal below — same content, two different wrappers.
  const outputBody = (
    <>
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

      {dictionaryFailedNotice && dictionaryFailedNotice.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="not-prose mb-6 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {dictionaryFailedNotice.length} cours n&apos;ont pas pu être ajoutés au dictionnaire (erreur temporaire) et sont
            absents du résultat ci-dessous : <strong>{dictionaryFailedNotice.join(", ")}</strong>. Relance une génération pour
            réessayer — les cours déjà réussis resteront en cache.
          </span>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {isGenerating ? (
          <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GenerationAura
              accent={isGeneratingSummary ? "cyan" : isGeneratingKeywords ? "violet" : "amber"}
              title={
                synthesisProgress?.phase === "courses" && synthesisProgress.total > 0
                  ? `Traitement des cours ${synthesisProgress.done}/${synthesisProgress.total}…`
                  : synthesisProgress?.phase === "assemble"
                    ? isGeneratingDictionary
                      ? "Assemblage du dictionnaire…"
                      : "Assemblage et synthèse transversale…"
                    : isGeneratingSummary
                      ? "Synthèse de tes cours en cours…"
                      : isGeneratingKeywords
                        ? "Extraction des mots-clés…"
                        : "Construction du dictionnaire médical…"
              }
              steps={
                isGeneratingSummary
                  ? ["Lecture des cours sélectionnés", "Réutilisation des chapitres déjà générés", "Rédaction des chapitres manquants", summaryPersonalized ? "Mise au format choisi" : "Assemblage de la fiche complète"]
                  : isGeneratingKeywords
                    ? ["Lecture des cours sélectionnés", "Repérage des notions clés", "Classement par catégorie", "Assemblage du tableau"]
                    : ["Lecture des cours sélectionnés", "Sélection des termes techniques", "Rédaction des explications FR / عربي", "Assemblage du dictionnaire"]
              }
              chips={
                <>
                  <TelemetryChip icon={ListChecks}>{selectedIds.size} cours</TelemetryChip>
                  {isGeneratingSummary && <TelemetryChip icon={Wand2}>{SUMMARY_DEPTH_LABELS[summaryDepth].label}</TelemetryChip>}
                </>
              }
            />
          </motion.div>
        ) : output ? (
          // SynthesisExplorer: dedicated interactive view per output type —
          // collapsible per-course fiches (Résumé global), term cards with
          // FR/AR + listen (Dictionnaire), category boards (Mots-clés) — with
          // search, priority/course/category filters and exports. It only
          // reads the generated Markdown; the content itself is unchanged.
          <motion.div key="output" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <SynthesisExplorer
              markdown={output}
              kind={history.find((h) => h.id === activeHistoryId)?.type ?? null}
              title={moduleTitle || tWorkspaceSynthesis("defaultModuleTitle", language)}
            />
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 py-12 text-center sm:py-16">
            <span className="relative flex h-16 w-16 items-center justify-center">
              <span aria-hidden className="cyber-breathe absolute inset-0 rounded-3xl bg-cyan-400/20 blur-xl" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 via-sky-500 to-violet-600 text-white shadow-[0_0_30px_rgba(34,211,238,0.45)]">
                <Sparkles className="h-7 w-7" />
              </span>
            </span>
            <div>
              <p className="cyber-kicker">Atelier de synthèse</p>
              <p className="mt-1 text-lg font-black text-foreground">Transforme tes cours en fiches de révision</p>
            </div>
            <ol className="grid w-full max-w-2xl gap-3 text-left sm:grid-cols-3">
              {[
                { icon: ListChecks, title: "1. Sélectionne", text: `Au moins ${MIN_COURSES_REQUIRED} cours du module.` },
                { icon: Wand2, title: "2. Personnalise", text: "Format, ciblage, moyens mnémotechniques." },
                { icon: Sparkles, title: "3. Génère", text: "Résumé, mots-clés ou dictionnaire." },
              ].map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                  <Icon className="h-5 w-5 text-cyan-400" />
                  <p className="mt-2 text-sm font-black text-foreground">{title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  const activeHistoryType = history.find((h) => h.id === activeHistoryId)?.type;
  const outputTitle =
    activeHistoryType === "global_summary"
      ? tWorkspaceSynthesis("entryTypeSummary", language)
      : activeHistoryType === "keywords_table"
        ? tWorkspaceSynthesis("entryTypeTable", language)
        : activeHistoryType === "medical_dictionary"
          ? tWorkspaceSynthesis("entryTypeDictionary", language)
          : moduleTitle || tWorkspaceSynthesis("defaultModuleTitle", language);

  /** Real client-side export — no backend involved, the content is already sitting in `output`. */
  function handleCopyOutput() {
    if (!output) return;
    navigator.clipboard
      .writeText(output)
      .then(() => {
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 2000);
      })
      .catch(() => {
        toast({ variant: "error", title: tWorkspaceSynthesis("copyFailedTitle", language) });
      });
  }

  function handleDownloadOutput() {
    if (!output) return;
    const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${outputTitle.replace(/[^a-zA-Z0-9-_]+/g, "_")}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Inline (non-fullscreen) panel — the maximize button just OPENS the
  // separate, portaled FullscreenViewerModal below; it no longer toggles
  // this panel's own classes to `fixed inset-0` (that approach silently
  // failed: this panel sits inside a `.glass-card` ancestor, and
  // `backdrop-filter` makes that ancestor the CONTAINING BLOCK for any
  // `position: fixed` descendant per the CSS spec — the "fullscreen" div
  // was only ever filling that card's own box, not the true screen, which
  // is why the mobile tab bar and "Mes Examens"-style history list stayed
  // visible underneath it. A portal sidesteps this entirely.
  const outputPanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1.5 px-2 pt-2 sm:px-3">
        {output && (
          <>
            <button
              type="button"
              onClick={handleCopyOutput}
              aria-label={tWorkspaceSynthesis("copyOutputAriaLabel", language)}
              title={tWorkspaceSynthesis("copyOutputAriaLabel", language)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-muted-foreground shadow-soft backdrop-blur transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95"
            >
              {justCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleDownloadOutput}
              aria-label={tWorkspaceSynthesis("downloadOutputAriaLabel", language)}
              title={tWorkspaceSynthesis("downloadOutputAriaLabel", language)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-muted-foreground shadow-soft backdrop-blur transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-95"
            >
              <Download className="h-4 w-4" />
            </button>
          </>
        )}
        <FullscreenToggleButton isFullscreen={false} onToggle={() => setIsOutputFullscreen(true)} />
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pt-2 md:px-10">
        {outputBody}
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
    <div className="cyber-stage relative flex h-dvh w-full max-w-full flex-col overflow-hidden overflow-x-hidden rounded-none border-0 text-foreground [touch-action:manipulation]">
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
            <aside className="cyber-glass flex max-h-[40vh] w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-3xl md:h-auto md:max-h-none md:w-80">
              {sourcesHeader}
              {selectAllRow}
              {courseListPanel}
              {historySection}
            </aside>

            {/* ── Results / generation main area (desktop) ────────────── */}
            <main className="cyber-glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
              {generateButtonsRow}
              {outputPanel}
            </main>
          </>
        ) : mobileTab === "sources" ? (
          <div className="cyber-glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
            {sourcesHeader}
            <div className="shrink-0 px-3 pt-3">{renderSummaryOptions(false)}</div>
            {selectAllRow}
            {courseListPanel}
            {generateButtonsRow}
          </div>
        ) : (
          <div className="cyber-glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
            {history.length > 0 ? (
              historySection
            ) : isGenerating ? null : (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">{tWorkspaceSynthesis("noResultsYetHint", language)}</p>
            )}
            {outputPanel}
          </div>
        )}
      </div>

      <FullscreenViewerModal open={isOutputFullscreen} onClose={() => setIsOutputFullscreen(false)} title={outputTitle}>
        <div className="px-4 pt-4 sm:px-6 md:px-10">{outputBody}</div>
      </FullscreenViewerModal>
    </div>
  );
}