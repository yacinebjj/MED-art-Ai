"use client";

import { memo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCartoonIllustration } from "@/lib/curriculum-illustrations";
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

const BENTO_CARD_CLASSES = cn(
  "group relative min-h-[180px] w-full overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6",
  "flex flex-col items-center justify-center",
  "shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl cursor-pointer",
  "dark:border-slate-700 dark:from-slate-800 dark:to-slate-900"
);

const ILLUSTRATION_CONTAINER_CLASSES =
  "mb-4 flex h-24 w-24 shrink-0 transform items-center justify-center rounded-full bg-indigo-50/50 text-[4rem] shadow-inner drop-shadow-md transition-transform duration-300 group-hover:scale-110 dark:bg-indigo-900/20";

const TITLE_CLASSES = "line-clamp-2 px-2 text-center text-lg font-bold text-slate-900 dark:text-gray-100";

const BENTO_GRID_CLASSES = "grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4";

function SubModulePill({ module: mod }: { module: CurriculumModule }) {
  const router = useRouter();

  function handleClick(e: MouseEvent) {
    // The pill lives inside an accordion card that toggles on click — stop
    // the click from also bubbling up and collapsing the UE it just
    // navigated away from.
    e.stopPropagation();
    router.push(`/dashboard/module/${mod.id}`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-full bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
    >
      {mod.title}
    </button>
  );
}

const IndependentModuleCard = memo(function IndependentModuleCard({ module: mod }: { module: CurriculumModule }) {
  const router = useRouter();
  const illustration = getCartoonIllustration(mod.title);

  function handleClick() {
    router.push(`/dashboard/module/${mod.id}`);
  }

  return (
    <button type="button" onClick={handleClick} className={BENTO_CARD_CLASSES}>
      {/* TODO: Remplacer le bloc div ci-dessous par
          <img src={`/illustrations/${mod.id}.png`} className="w-24 h-24 object-contain mb-4" alt={mod.title} />
          une fois les vraies illustrations dessinées disponibles côté client. */}
      <div className={ILLUSTRATION_CONTAINER_CLASSES}>{illustration}</div>
      <p className={TITLE_CLASSES}>{mod.title}</p>
    </button>
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
    <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={handleKeyDown} className={BENTO_CARD_CLASSES}>
      <ChevronDown
        className={cn(
          "absolute right-4 top-4 h-5 w-5 text-slate-300 transition-transform duration-300 dark:text-slate-600",
          expanded && "rotate-180"
        )}
      />

      {/* TODO: Remplacer le bloc div ci-dessous par
          <img src={`/illustrations/unit-${unit.id}.png`} className="w-24 h-24 object-contain mb-4" alt={unit.title} />
          une fois les vraies illustrations dessinées disponibles côté client. */}
      <div className={ILLUSTRATION_CONTAINER_CLASSES}>{illustration}</div>
      <p className={TITLE_CLASSES}>{unit.title}</p>
      <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
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
            <div className="flex flex-wrap justify-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              {unit.modules.map((mod) => (
                <SubModulePill key={mod.id} module={mod} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
        <div className="mb-4 h-3 w-40 animate-pulse rounded bg-slate-200 dark:bg-neutral-800" />
        <div className={BENTO_GRID_CLASSES}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="min-h-[180px] animate-pulse rounded-3xl bg-slate-100 dark:bg-neutral-900" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function CurriculumView({ data }: { data: CurriculumYearData }) {
  const [expandedUnitId, setExpandedUnitId] = useState<number | null>(null);
  const hasTeachingUnits = data.teachingUnits.length > 0;

  return (
    <div className="space-y-10">
      {hasTeachingUnits && (
        <div>
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
            Unités d&apos;Enseignement
          </h2>
          <div className={BENTO_GRID_CLASSES}>
            {data.teachingUnits.map((unit) => (
              <TeachingUnitCard
                key={unit.id}
                unit={unit}
                expanded={expandedUnitId === unit.id}
                onToggle={() => setExpandedUnitId((prev) => (prev === unit.id ? null : unit.id))}
              />
            ))}
          </div>
        </div>
      )}

      {data.independentModules.length > 0 && (
        <div>
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
            {hasTeachingUnits ? "Modules Indépendants" : "Modules"}
          </h2>
          <div className={BENTO_GRID_CLASSES}>
            {data.independentModules.map((mod) => (
              <IndependentModuleCard key={mod.id} module={mod} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
