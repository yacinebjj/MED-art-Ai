"use client";

import { memo, useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpenText, Brain, ChevronDown, FileQuestion, FolderOpen, MoreVertical, Sparkles, Target, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCartoonIllustration } from "@/lib/curriculum-illustrations";
import { useToast } from "@/components/ui/Toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { ModuleStatsModal } from "@/components/dashboard/ModuleStatsModal";
import { GlobalSummaryModal } from "@/components/dashboard/GlobalSummaryModal";
import type { CurriculumModule, CurriculumYearData, TeachingUnitWithModules } from "@/types/academic";

/**
 * Hybrid Bento Grid — the rendering rule is strict and asymmetric on purpose:
 *
 *  - Independent modules (teachingUnitId === null) AND Unités
 *    d'Enseignement render as the SAME large Bento card (same size, same
 *    gradient, same hover lift). A UE card's click never navigates — it
 *    toggles an in-place accordion revealing its sous-modules.
 *  - Sous-modules (inside an expanded UE) are small pill buttons, never
 *    large cards. Only a pill's own click navigates.
 *
 * A year with zero UE (1ère, 4ème, 5ème, 6ème) therefore renders as a pure
 * grid of large independent-module cards — which is exactly the "visually
 * perfect" fallback the brief asks for, with no extra branching needed here
 * beyond the existing hasTeachingUnits check.
 */

/**
 * Aceternity-style Bento card, built as two nested layers rather than one
 * div — the OUTER layer is a 1.5px gradient-filled "border" (transparent by
 * default, blooming into an emerald/cyan/violet gradient on hover) and the
 * INNER layer is the real glass surface. This is the standard CSS technique
 * for an animatable gradient border: a real `border` property can't
 * transition to/from a gradient, but padding around a gradient background
 * can. `group`/hover/lift live on the OUTER layer so the whole card moves
 * as one rigid unit instead of the glass panel sliding independently inside
 * a static frame.
 *
 * The inner layer reuses `.glass-card` (globals.css) rather than a literal
 * `bg-white/5` — 5% white opacity is nearly invisible against this app's
 * LIGHT theme (the actual default — see providers/ThemeProvider's
 * `defaultTheme="light"`), which only reads as "glass" against a dark
 * background. `.glass-card` already has real light+dark variants tuned for
 * exactly this, matching every other glass surface in the app (Dashboard
 * hero, quick actions, Topbar).
 */
const BENTO_CARD_WRAPPER_CLASSES = cn(
  "group relative w-full rounded-3xl bg-gradient-to-br from-white/20 via-white/5 to-white/20 p-[1.5px]",
  "transition-all duration-300 ease-out hover:-translate-y-1",
  "hover:from-emerald-400/70 hover:via-cyan-400/50 hover:to-violet-400/70",
  "hover:shadow-xl hover:shadow-emerald-500/20 dark:hover:shadow-emerald-500/10",
  "cursor-pointer"
);

const BENTO_CARD_CLASSES = cn(
  "glass-card relative flex min-h-[140px] w-full flex-col items-center justify-center overflow-hidden rounded-[calc(1.5rem-1.5px)] p-4",
  "shadow-glass dark:shadow-glass-dark",
  "sm:min-h-[180px] sm:p-6"
);

const ILLUSTRATION_CONTAINER_CLASSES =
  "mb-3 flex h-14 w-14 shrink-0 transform items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-white/20 to-white/5 text-3xl shadow-inner backdrop-blur-sm transition-transform duration-300 group-hover:scale-110 dark:border-white/10 sm:mb-4 sm:h-20 sm:w-20 sm:text-5xl";

// Cascade entrance for both Bento grids below — same stagger language as the
// Dashboard's "Mes cours indépendants" grid.
const BENTO_GRID_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const BENTO_ITEM_VARIANTS = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

const TITLE_CLASSES = "line-clamp-2 px-1 text-center text-sm font-bold text-foreground sm:px-2 sm:text-lg";

// grid-cols-2 on mobile (not 1) — same "fit more above the fold, native-app
// feel" compaction already applied to the Dashboard's other grids and the
// Studio workspace; gap/columns scale up from there.
const BENTO_GRID_CLASSES = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:gap-6 xl:grid-cols-4";

function SubModulePill({ module: mod }: { module: CurriculumModule }) {
  return (
    <Link
      href={`/dashboard/module/${mod.id}`}
      // The pill lives inside an accordion card that toggles on click — stop
      // the click from also bubbling up and collapsing the UE it just
      // navigated away from. A real <Link> (vs. the previous router.push)
      // also gets Next.js's automatic viewport prefetching, so the module
      // workspace's JS is often already cached by the time this is clicked.
      onClick={(e) => e.stopPropagation()}
      className="rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
    >
      {mod.title}
    </Link>
  );
}

const IndependentModuleCard = memo(function IndependentModuleCard({
  module: mod,
  isFlashcardsActive,
  onToggleFlashcards,
  isWeaknessesActive,
  onToggleWeaknesses,
}: {
  module: CurriculumModule;
  isFlashcardsActive: boolean;
  onToggleFlashcards: (moduleId: number, nextActive: boolean) => void;
  isWeaknessesActive: boolean;
  onToggleWeaknesses: (moduleId: number, nextActive: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const illustration = getCartoonIllustration(mod.title);
  const [statsOpen, setStatsOpen] = useState(false);
  const [globalSummaryOpen, setGlobalSummaryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  function handleClick() {
    router.push(`/dashboard/module/${mod.id}`);
  }

  async function handleConfirmDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/studio/courses?moduleId=${mod.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data?.error ?? "Erreur inconnue.");
      toast({ variant: "success", title: "Sources supprimées", description: `Toutes les sources de « ${mod.title} » ont été supprimées.` });
      setDeleteOpen(false);
    } catch (error) {
      toast({ variant: "error", title: "Échec de la suppression", description: error instanceof Error ? error.message : "Erreur inconnue." });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    // A <div role="button"> rather than a real <button> — it now contains its
    // own nested, independently-clickable ⋮ menu button, and a <button> can
    // never legally contain another <button>. Matches <TeachingUnitCard>'s
    // existing pattern below. The interactive role/handlers live on the
    // OUTER gradient-border layer so the whole card (border + glass panel)
    // is one hit-testable, one hover/lift unit — see BENTO_CARD_WRAPPER_CLASSES'
    // own comment for why this is two nested divs, not one.
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className={BENTO_CARD_WRAPPER_CLASSES}
    >
      <div className={BENTO_CARD_CLASSES}>
      <div className="absolute right-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700 dark:bg-slate-800/80 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-100"
            aria-label="Options du module"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
              <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Voir statistiques
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/workspace/module/${mod.id}`}>
                <BookOpenText className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                Générer un résumé
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/module/${mod.id}/exam`}>
                <FileQuestion className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                Générer un examen
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleFlashcards(mod.id, !isFlashcardsActive)}>
              <Brain className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              {isFlashcardsActive ? "Désactiver les Flashcards" : "Activer les Flashcards"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onToggleWeaknesses(mod.id, !isWeaknessesActive)}>
              <Target className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              {isWeaknessesActive ? "Désactiver les points faibles" : "Activer les points faibles"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Supprimer toutes les sources
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(isFlashcardsActive || isWeaknessesActive) && (
        <div className="absolute left-2 top-2 z-10 flex flex-col items-start gap-1">
          {isFlashcardsActive && (
            <span className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 shadow-sm dark:bg-violet-900/50 dark:text-violet-300">
              <Brain className="h-3 w-3" />
              Flashcards actives
            </span>
          )}
          {isWeaknessesActive && (
            <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 shadow-sm dark:bg-rose-900/50 dark:text-rose-300">
              <Target className="h-3 w-3" />
              Points faibles actifs
            </span>
          )}
        </div>
      )}

      {/* TODO: Remplacer le bloc div ci-dessous par
          <img src={`/illustrations/${mod.id}.png`} className="w-24 h-24 object-contain mb-4" alt={mod.title} />
          une fois les vraies illustrations dessinées disponibles côté client. */}
      <div className={ILLUSTRATION_CONTAINER_CLASSES}>{illustration}</div>
      <p className={TITLE_CLASSES}>{mod.title}</p>

      <Dialog open={deleteOpen} onOpenChange={(open) => !isDeleting && setDeleteOpen(open)}>
        <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Supprimer toutes les sources ?</DialogTitle>
            <DialogDescription>
              Tous les cours ajoutés dans « {mod.title} » et leur contenu généré seront supprimés définitivement.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
              Annuler
            </Button>
            <Button type="button" variant="danger" onClick={handleConfirmDelete} disabled={isDeleting}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div onClick={(e) => e.stopPropagation()}>
        <ModuleStatsModal open={statsOpen} onOpenChange={setStatsOpen} moduleTitle={mod.title} moduleId={mod.id} />
        <GlobalSummaryModal open={globalSummaryOpen} onOpenChange={setGlobalSummaryOpen} moduleTitle={mod.title} moduleId={mod.id} />
      </div>
      </div>
    </div>
  );
});

const TeachingUnitCard = memo(function TeachingUnitCard({
  unit,
  expanded,
  onToggle,
}: {
  unit: TeachingUnitWithModules;
  expanded: boolean;
  onToggle: () => void;
}) {
  const illustration = getCartoonIllustration(unit.title);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }

  return (
    // A <div role="button"> rather than a real <button> — it contains its
    // own nested, independently-clickable <button> pills once expanded, and
    // a <button> can never legally contain another <button>.
    <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={handleKeyDown} className={BENTO_CARD_WRAPPER_CLASSES}>
      <div className={BENTO_CARD_CLASSES}>
      <ChevronDown
        className={cn(
          "absolute right-3 top-3 h-4 w-4 text-muted-foreground transition-transform duration-300 sm:right-4 sm:top-4 sm:h-5 sm:w-5",
          expanded && "rotate-180"
        )}
      />

      {/* TODO: Remplacer le bloc div ci-dessous par
          <img src={`/illustrations/unit-${unit.id}.png`} className="w-24 h-24 object-contain mb-4" alt={unit.title} />
          une fois les vraies illustrations dessinées disponibles côté client. */}
      <div className={ILLUSTRATION_CONTAINER_CLASSES}>{illustration}</div>
      <p className={TITLE_CLASSES}>{unit.title}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {unit.modules.length} module{unit.modules.length > 1 ? "s" : ""}
      </p>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="mt-5 w-full overflow-hidden"
          >
            <div className="flex flex-wrap justify-center gap-2 border-t border-white/10 pt-4">
              {unit.modules.map((mod) => (
                <SubModulePill key={mod.id} module={mod} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
});

/**
 * Mimics the final layout (a grid of large Bento cards) at the same size, so
 * swapping in real data never produces a layout shift — just a
 * pulse-to-content transition. Deliberately a single generic grid rather
 * than guessing a UE/module split: the real composition (some years have no
 * UE at all) isn't known until the data actually arrives.
 */
export function CurriculumViewSkeleton() {
  return (
    <div className="space-y-10">
      <div>
        <div className="mb-4 h-3 w-40 animate-pulse rounded bg-white/10" />
        <div className={BENTO_GRID_CLASSES}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-card min-h-[140px] animate-pulse rounded-3xl sm:min-h-[180px]" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Wrapped in React.memo: `data` is a stable object reference held in the
 * dashboard page's own state (only replaced when the curriculum is actually
 * refetched) — without this, every unrelated re-render of that page (e.g.
 * each keystroke in its search box) re-rendered this entire Bento grid and
 * every card inside it for no reason.
 */
export const CurriculumView = memo(function CurriculumView({ data }: { data: CurriculumYearData }) {
  const { toast } = useToast();
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);
  // A Set, not a single id: several modules/courses can be active for
  // flashcards at once (see app/api/modules/[id]/flashcards/route.ts's
  // header comment) — the study deck pools and shuffles across all of them.
  const [activeFlashcardModuleIds, setActiveFlashcardModuleIds] = useState<Set<number>>(new Set());
  const [activeWeaknessModuleIds, setActiveWeaknessModuleIds] = useState<Set<number>>(new Set());
  const hasTeachingUnits = data.teachingUnits.length > 0;

  // One fetch for the whole grid, not one per card — GET /api/modules/flashcards
  // already returns every activated module id for this student in one shot.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/modules/flashcards")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.success) setActiveFlashcardModuleIds(new Set(body.activeModuleIds as number[]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Same one-fetch-for-the-whole-grid pattern as flashcards above, for
  // "Points Faibles & Plan de Remédiation" (GET /api/modules/weaknesses).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/modules/weaknesses")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.success) setActiveWeaknessModuleIds(new Set(body.activeModuleIds as number[]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Optimistic toggle — reverted with a toast if the PATCH actually fails, so the badge/menu label never silently lies about the saved state. */
  async function handleToggleFlashcards(moduleId: number, nextActive: boolean) {
    setActiveFlashcardModuleIds((prev) => {
      const next = new Set(prev);
      if (nextActive) next.add(moduleId);
      else next.delete(moduleId);
      return next;
    });

    try {
      const res = await fetch(`/api/modules/${moduleId}/flashcards`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.error ?? "Erreur inconnue.");
    } catch (error) {
      setActiveFlashcardModuleIds((prev) => {
        const reverted = new Set(prev);
        if (nextActive) reverted.delete(moduleId);
        else reverted.add(moduleId);
        return reverted;
      });
      toast({
        variant: "error",
        title: "Échec de la mise à jour",
        description: error instanceof Error ? error.message : "Impossible de contacter le serveur.",
      });
    }
  }

  /** Mirrors handleToggleFlashcards exactly, for the "points faibles" toggle. */
  async function handleToggleWeaknesses(moduleId: number, nextActive: boolean) {
    setActiveWeaknessModuleIds((prev) => {
      const next = new Set(prev);
      if (nextActive) next.add(moduleId);
      else next.delete(moduleId);
      return next;
    });

    try {
      const res = await fetch(`/api/modules/${moduleId}/weaknesses`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.error ?? "Erreur inconnue.");
    } catch (error) {
      setActiveWeaknessModuleIds((prev) => {
        const reverted = new Set(prev);
        if (nextActive) reverted.delete(moduleId);
        else reverted.add(moduleId);
        return reverted;
      });
      toast({
        variant: "error",
        title: "Échec de la mise à jour",
        description: error instanceof Error ? error.message : "Impossible de contacter le serveur.",
      });
    }
  }

  return (
    <div className="space-y-10">
      {hasTeachingUnits && (
        <div>
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Unités d&apos;Enseignement
          </h2>
          <motion.div className={BENTO_GRID_CLASSES} variants={BENTO_GRID_VARIANTS} initial="hidden" animate="show">
            {data.teachingUnits.map((unit) => (
              <motion.div key={unit.id} variants={BENTO_ITEM_VARIANTS}>
                <TeachingUnitCard
                  unit={unit}
                  expanded={expandedUnitId === unit.id}
                  onToggle={() => setExpandedUnitId((prev) => (prev === unit.id ? null : unit.id))}
                />
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {data.independentModules.length > 0 && (
        <div>
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {hasTeachingUnits ? "Modules Indépendants" : "Modules"}
          </h2>
          <motion.div className={BENTO_GRID_CLASSES} variants={BENTO_GRID_VARIANTS} initial="hidden" animate="show">
            {data.independentModules.map((mod) => (
              <motion.div key={mod.id} variants={BENTO_ITEM_VARIANTS}>
                <IndependentModuleCard
                  module={mod}
                  isFlashcardsActive={activeFlashcardModuleIds.has(mod.id)}
                  onToggleFlashcards={handleToggleFlashcards}
                  isWeaknessesActive={activeWeaknessModuleIds.has(mod.id)}
                  onToggleWeaknesses={handleToggleWeaknesses}
                />
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}

      {/* Neither branch above rendered anything — a chosen specialty/year
          combination the curriculum hasn't been seeded for yet. Previously
          this fell through to a silent, blank <div className="space-y-10">
          with nothing in it, right under the "Mon Programme" heading — this
          gives that dead end an actual message instead. */}
      {!hasTeachingUnits && data.independentModules.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-slate-300 bg-slate-50/60 py-16 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <FolderOpen className="h-10 w-10 text-slate-400 dark:text-slate-600" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Aucun module disponible pour le moment.</p>
          <p className="max-w-sm text-xs text-slate-500 dark:text-slate-500">
            Le programme officiel de ta spécialité/année n&apos;est pas encore disponible ici — tu peux en attendant
            ajouter un cours indépendant depuis le bouton ci-dessus.
          </p>
        </div>
      )}
    </div>
  );
});
