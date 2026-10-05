"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownAZ,
  BarChart3,
  BookOpen,
  BookOpenText,
  Brain,
  CalendarClock,
  FileQuestion,
  FolderOpen,
  Layers,
  LoaderCircle,
  MoreVertical,
  Search,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import dynamic from "next/dynamic";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import { getCartoonIllustration } from "@/lib/curriculum-illustrations";
import { tCockpit } from "@/lib/translations/cockpit";
import { tDiscovery } from "@/lib/translations/discovery";
import type { CurriculumModule, CurriculumYearData } from "@/types/academic";
import type { DashboardModuleStats } from "@/types/dashboard-overview";
import { Skeleton } from "./primitives";

// Opened on demand from one card's menu: fetched on first open, and only the
// open one is mounted — never one closed Dialog per module card in the grid.
const ModuleStatsModal = dynamic(() => import("@/components/dashboard/ModuleStatsModal").then((m) => m.ModuleStatsModal), { ssr: false });

type StatusFilter = "all" | "not-started" | "in-progress" | "mastered";
type SortKey = "priority" | "progress" | "alpha" | "recent";

/** Mean QCM mastery at or above this = "Maîtrisé". */
const MASTERED_PCT = 80;

interface ModuleEntry {
  module: CurriculumModule;
  unitId: number | null;
  unitTitle: string | null;
  stats: DashboardModuleStats | null;
  examPriority: boolean;
  status: Exclude<StatusFilter, "all">;
}

function statusOf(stats: DashboardModuleStats | null): ModuleEntry["status"] {
  if (!stats || stats.courseCount === 0) return "not-started";
  return stats.progressPct >= MASTERED_PCT ? "mastered" : "in-progress";
}

const STATUS_STYLE: Record<ModuleEntry["status"], string> = {
  "not-started": "bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300",
  "in-progress": "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  mastered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
};

const STATUS_KEY = { "not-started": "statusNotStarted", "in-progress": "statusInProgress", mastered: "statusMastered" } as const;

// ---------------------------------------------------------------------------

const ModuleCard = memo(function ModuleCard({
  entry,
  language,
  flashcardsActive,
  onToggleFlashcards,
  onLaunchFlashcards,
  launching,
}: {
  entry: ModuleEntry;
  language: Language;
  flashcardsActive: boolean;
  onToggleFlashcards: (moduleId: number, next: boolean) => void;
  onLaunchFlashcards: (moduleId: number) => void;
  launching: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { module: mod, stats } = entry;
  const [statsOpen, setStatsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const refresh = useCockpitStore((state) => state.refresh);
  const title = translateCurriculumName(mod.title, language);
  const progress = stats?.progressPct ?? 0;
  const href = `/dashboard/module/${mod.id}`;

  async function handleConfirmDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/studio/courses?moduleId=${mod.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "Erreur inconnue.");
      toast({ variant: "success", title: tDiscovery("sourcesDeleted", language), description: `« ${mod.title} »` });
      setDeleteOpen(false);
      void refresh({ force: true });
    } catch (error) {
      toast({ variant: "error", title: tDiscovery("deleteSourcesFailed", language), description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25 }}
      className="group relative rounded-3xl bg-gradient-to-br from-white/25 via-white/5 to-white/25 p-[1.5px] transition-all duration-300 hover:-translate-y-1 hover:from-emerald-400/70 hover:via-cyan-400/50 hover:to-violet-400/70 hover:shadow-xl hover:shadow-emerald-500/15 dark:from-white/10 dark:to-white/10"
    >
      <div
        role="link"
        tabIndex={0}
        onClick={() => router.push(href)}
        // The card itself navigates programmatically: warm the route on intent so the click switches instantly.
        onPointerEnter={() => router.prefetch(href)}
        onFocus={() => router.prefetch(href)}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(href);
        }}
        className="glass-card relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[calc(1.5rem-1.5px)] p-4 shadow-glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-glass-dark"
      >
        {/* Badges + ⋮ */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_STYLE[entry.status])}>{tCockpit(STATUS_KEY[entry.status], language)}</span>
            {entry.examPriority && (
              <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                <CalendarClock className="h-3 w-3" />
                {tCockpit("examPriority", language)}
              </span>
            )}
            {flashcardsActive && (
              <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                <Brain className="h-3 w-3" />
                {tCockpit("flashActiveBadge", language)}
              </span>
            )}
          </div>
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={tCockpit("moduleOptions", language)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/70 text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700 dark:bg-slate-800/80 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-100"
              >
                <MoreVertical className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
                  <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  {tCockpit("menuStats", language)}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/workspace/module/${mod.id}`}>
                    <BookOpenText className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                    {tCockpit("menuSummary", language)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggleFlashcards(mod.id, !flashcardsActive)}>
                  <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  {flashcardsActive ? tCockpit("menuFlashOff", language) : tCockpit("menuFlashOn", language)}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4" />
                  {tCockpit("menuDeleteSources", language)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Identity */}
        <div className="mt-3 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/30 bg-gradient-to-br from-white/40 to-white/5 text-2xl shadow-inner transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-4deg] dark:border-white/10">
            {getCartoonIllustration(mod.title)}
          </span>
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-bold leading-tight text-foreground">{title}</p>
            {entry.unitTitle && <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{translateCurriculumName(entry.unitTitle, language)}</p>}
          </div>
        </div>

        {/* Progress */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
            <span>{tCockpit("moduleProgress", language)}</span>
            <span className="tabular-nums text-foreground">{stats && stats.courseCount > 0 ? `${progress}%` : "—"}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn("h-full rounded-full bg-gradient-to-r", progress >= MASTERED_PCT ? "from-emerald-500 to-teal-400" : "from-primary-500 to-violet-500")}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <div className="rounded-lg bg-white/40 px-1 py-1.5 dark:bg-white/[0.04]">
            <p className="text-sm font-bold tabular-nums text-foreground">{stats?.courseCount ?? 0}</p>
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{tCockpit("metaCourses", language)}</p>
          </div>
          <div className="rounded-lg bg-white/40 px-1 py-1.5 dark:bg-white/[0.04]">
            <p className="text-sm font-bold tabular-nums text-foreground">
              {stats?.trainedCourses ?? 0}/{stats?.courseCount ?? 0}
            </p>
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{tCockpit("metaTrained", language)}</p>
          </div>
          <div className="rounded-lg bg-white/40 px-1 py-1.5 dark:bg-white/[0.04]">
            <p className="text-sm font-bold tabular-nums text-foreground">{stats?.qcmAccuracyPct === null || stats?.qcmAccuracyPct === undefined ? "—" : `${stats.qcmAccuracyPct}%`}</p>
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{tCockpit("metaAccuracy", language)}</p>
          </div>
        </div>

        {/* Quick actions — always visible on touch screens, revealed on hover/focus on desktop */}
        <div
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="mt-3 grid grid-cols-3 gap-1.5 transition-all duration-300 lg:pointer-events-none lg:translate-y-2 lg:opacity-0 lg:group-focus-within:pointer-events-auto lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100 lg:group-hover:pointer-events-auto lg:group-hover:translate-y-0 lg:group-hover:opacity-100"
        >
          <Link href={href} className="flex flex-col items-center gap-0.5 rounded-xl bg-primary-500/10 px-1 py-1.5 text-[10px] font-bold text-primary-700 transition-colors hover:bg-primary-500/20 dark:text-primary-300">
            <BookOpen className="h-3.5 w-3.5" />
            {tCockpit("actionCourses", language)}
          </Link>
          <button
            type="button"
            disabled={launching}
            onClick={() => onLaunchFlashcards(mod.id)}
            className="flex flex-col items-center gap-0.5 rounded-xl bg-violet-500/10 px-1 py-1.5 text-[10px] font-bold text-violet-700 transition-colors hover:bg-violet-500/20 disabled:opacity-60 dark:text-violet-300"
          >
            {launching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            {tCockpit("actionFlash", language)}
          </button>
          <Link href={`/dashboard/module/${mod.id}/exam`} className="flex flex-col items-center gap-0.5 rounded-xl bg-rose-500/10 px-1 py-1.5 text-[10px] font-bold text-rose-700 transition-colors hover:bg-rose-500/20 dark:text-rose-300">
            <FileQuestion className="h-3.5 w-3.5" />
            {tCockpit("actionQcm", language)}
          </Link>
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {statsOpen && <ModuleStatsModal open={statsOpen} onOpenChange={setStatsOpen} moduleTitle={mod.title} moduleId={mod.id} />}
        <Dialog open={deleteOpen} onOpenChange={(open) => !isDeleting && setDeleteOpen(open)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{tCockpit("deleteTitle", language)}</DialogTitle>
              <DialogDescription>{tCockpit("deleteBody", language).replace("{module}", mod.title)}</DialogDescription>
            </DialogHeader>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
                {tCockpit("cancel", language)}
              </Button>
              <Button type="button" variant="danger" onClick={handleConfirmDelete} disabled={isDeleting}>
                {tCockpit("delete", language)}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </motion.div>
  );
});

// ---------------------------------------------------------------------------

export function CurriculumHubSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-11 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="glass-card h-[250px] animate-pulse rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Curriculum 3.0 — every module of the student's year as one card with real
 * progress (mean QCM mastery of its courses, /api/dashboard/overview), course
 * and QCM metadata, exam-priority flag (modules of the study plan with the
 * nearest exam), hover quick actions, and a search / UE / status / sort toolbar.
 */
export function CurriculumHub({ data }: { data: CurriculumYearData }) {
  const router = useRouter();
  const { toast } = useToast();
  const { language } = useLanguage();
  const overview = useCockpitStore((state) => state.overview);
  const refresh = useCockpitStore((state) => state.refresh);

  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [activeFlashcardModuleIds, setActiveFlashcardModuleIds] = useState<Set<number>>(new Set());
  const [launchingId, setLaunchingId] = useState<number | null>(null);
  const [unitStatsOpen, setUnitStatsOpen] = useState(false);

  // Seeded from the overview, then owned locally (optimistic toggles below).
  useEffect(() => {
    if (overview) setActiveFlashcardModuleIds(new Set(overview.flashcardActiveModuleIds));
  }, [overview]);

  const entries = useMemo<ModuleEntry[]>(() => {
    const statsById = new Map((overview?.modules ?? []).map((m) => [m.moduleId, m]));
    const examModules = new Set(overview?.nextExam?.moduleIds ?? []);
    const make = (mod: CurriculumModule, unitId: number | null, unitTitle: string | null): ModuleEntry => {
      const stats = statsById.get(mod.id) ?? null;
      return { module: mod, unitId, unitTitle, stats, examPriority: examModules.has(mod.id), status: statusOf(stats) };
    };
    return [
      ...data.teachingUnits.flatMap((unit) => unit.modules.map((mod) => make(mod, unit.id, unit.title))),
      ...data.independentModules.map((mod) => make(mod, null, null)),
    ];
  }, [data, overview]);

  const counts = useMemo(() => {
    const c = { all: entries.length, "not-started": 0, "in-progress": 0, mastered: 0 };
    entries.forEach((e) => (c[e.status] += 1));
    return c;
  }, [entries]);

  const visible = useMemo(() => {
    const COMBINING = new RegExp("[\\u0300-\\u036f]", "g");
    const norm = (s: string) => s.normalize("NFD").replace(COMBINING, "").toLowerCase();
    const q = norm(query.trim());
    const filtered = entries.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (unitFilter === "independent" && e.unitId !== null) return false;
      if (unitFilter !== "all" && unitFilter !== "independent" && String(e.unitId) !== unitFilter) return false;
      if (q) {
        const haystack = norm(`${e.module.title} ${translateCurriculumName(e.module.title, language)} ${e.unitTitle ?? ""}`);
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const byTitle = (a: ModuleEntry, b: ModuleEntry) => translateCurriculumName(a.module.title, language).localeCompare(translateCurriculumName(b.module.title, language), language);
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "alpha":
          return byTitle(a, b);
        case "progress":
          return (b.stats?.progressPct ?? -1) - (a.stats?.progressPct ?? -1) || byTitle(a, b);
        case "recent":
          return (b.stats?.lastActivityAt ?? "").localeCompare(a.stats?.lastActivityAt ?? "") || byTitle(a, b);
        default:
          // Priority: modules of the upcoming exam first, then those with courses but the lowest mastery (most work left), then untouched ones.
          return (
            Number(b.examPriority) - Number(a.examPriority) ||
            Number((b.stats?.courseCount ?? 0) > 0) - Number((a.stats?.courseCount ?? 0) > 0) ||
            (a.stats?.progressPct ?? 0) - (b.stats?.progressPct ?? 0) ||
            a.module.displayOrder - b.module.displayOrder
          );
      }
    });
  }, [entries, query, statusFilter, unitFilter, sort, language]);

  /** Optimistic toggle — reverted with a toast if the PATCH fails. */
  const toggleFlashcards = useCallback(
    async (moduleIds: number[], next: boolean) => {
      setActiveFlashcardModuleIds((prev) => {
        const copy = new Set(prev);
        moduleIds.forEach((id) => (next ? copy.add(id) : copy.delete(id)));
        return copy;
      });
      const results = await Promise.allSettled(
        moduleIds.map((id) =>
          fetch(`/api/modules/${id}/flashcards`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: next }) }).then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok || !body?.success) throw new Error(body?.error ?? "Erreur inconnue.");
          })
        )
      );
      const failed = moduleIds.filter((_, i) => results[i].status === "rejected");
      if (failed.length > 0) {
        setActiveFlashcardModuleIds((prev) => {
          const copy = new Set(prev);
          failed.forEach((id) => (next ? copy.delete(id) : copy.add(id)));
          return copy;
        });
        toast({ variant: "error", title: tDiscovery("updateFailed", language), description: `${failed.length}/${moduleIds.length}` });
      } else {
        void refresh({ force: true });
      }
    },
    [toast, language, refresh]
  );

  const toggleOne = useCallback((moduleId: number, next: boolean) => void toggleFlashcards([moduleId], next), [toggleFlashcards]);

  const launchFlashcards = useCallback(
    async (moduleId: number) => {
      setLaunchingId(moduleId);
      try {
        const res = await fetch("/api/flashcards/focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moduleId }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.success) throw new Error(body?.error ?? "Erreur inconnue.");
        router.push("/dashboard/study?tab=flashcards");
      } catch (error) {
        toast({ variant: "error", title: tCockpit("flashLaunchFailed", language), description: error instanceof Error ? error.message : undefined });
        setLaunchingId(null);
      }
    },
    [router, toast, language]
  );

  const selectedUnit = data.teachingUnits.find((unit) => String(unit.id) === unitFilter) ?? null;
  const selectedUnitIds = selectedUnit?.modules.map((m) => m.id) ?? [];
  const unitAllActive = selectedUnitIds.length > 0 && selectedUnitIds.every((id) => activeFlashcardModuleIds.has(id));

  const unitOptions = [
    { value: "all", label: tCockpit("filterAllUnits", language) },
    ...data.teachingUnits.map((unit) => ({ value: String(unit.id), label: translateCurriculumName(unit.title, language) })),
    ...(data.independentModules.length > 0 && data.teachingUnits.length > 0 ? [{ value: "independent", label: tCockpit("filterIndependent", language) }] : []),
  ];
  const sortOptions = [
    { value: "priority", label: tCockpit("sortPriority", language) },
    { value: "progress", label: tCockpit("sortProgress", language) },
    { value: "recent", label: tCockpit("sortRecent", language) },
    { value: "alpha", label: tCockpit("sortAlpha", language) },
  ];
  const statusChips: { value: StatusFilter; key: "statusAll" | "statusNotStarted" | "statusInProgress" | "statusMastered" }[] = [
    { value: "all", key: "statusAll" },
    { value: "not-started", key: "statusNotStarted" },
    { value: "in-progress", key: "statusInProgress" },
    { value: "mastered", key: "statusMastered" },
  ];

  if (entries.length === 0) {
    return (
      <div className="glass-card flex flex-col items-center gap-3 rounded-3xl border-dashed px-4 py-12 text-center">
        <FolderOpen className="h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm font-semibold text-foreground">{tCockpit("noModulesTitle", language)}</p>
        <p className="max-w-sm text-xs text-muted-foreground">{tCockpit("noModulesBody", language)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="glass-card flex flex-col gap-2.5 rounded-2xl border border-white/30 p-2.5 shadow-glass dark:border-white/[0.06] dark:shadow-glass-dark lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tCockpit("searchModules", language)}
            className="h-10 w-full rounded-xl border border-border/60 bg-background/60 pl-9 pr-8 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={tCockpit("clearSearch", language)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.teachingUnits.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Select value={unitFilter} onValueChange={setUnitFilter} options={unitOptions} className="h-10 w-[11rem] rounded-xl text-xs sm:w-[13rem]" />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <ArrowDownAZ className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)} options={sortOptions} className="h-10 w-[10.5rem] rounded-xl text-xs" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {statusChips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() => setStatusFilter(chip.value)}
            aria-pressed={statusFilter === chip.value}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-200",
              statusFilter === chip.value
                ? "border-transparent bg-gradient-to-r from-primary-600 to-violet-600 text-white shadow-md shadow-primary-500/20"
                : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground"
            )}
          >
            {tCockpit(chip.key, language)}
            <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", statusFilter === chip.value ? "bg-white/20" : "bg-muted")}>{counts[chip.value]}</span>
          </button>
        ))}
        {selectedUnit && (
          <span className="ml-auto flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void toggleFlashcards(selectedUnitIds, !unitAllActive)}
              className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300"
            >
              <Brain className="h-3.5 w-3.5" />
              {unitAllActive ? tCockpit("unitFlashOff", language) : tCockpit("unitFlashOn", language)}
            </button>
            <button
              type="button"
              onClick={() => setUnitStatsOpen(true)}
              className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-3 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              {tCockpit("unitStats", language)}
            </button>
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-2 rounded-3xl border-dashed px-4 py-10 text-center">
          <Target className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{tCockpit("noModuleMatch", language)}</p>
        </div>
      ) : (
        <motion.div layout className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          <AnimatePresence initial={false}>
            {visible.map((entry) => (
              <ModuleCard
                key={entry.module.id}
                entry={entry}
                language={language}
                flashcardsActive={activeFlashcardModuleIds.has(entry.module.id)}
                onToggleFlashcards={toggleOne}
                onLaunchFlashcards={launchFlashcards}
                launching={launchingId === entry.module.id}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {selectedUnit && unitStatsOpen && (
        <ModuleStatsModal open={unitStatsOpen} onOpenChange={setUnitStatsOpen} moduleTitle={selectedUnit.title} moduleIds={selectedUnitIds} />
      )}
    </div>
  );
}
