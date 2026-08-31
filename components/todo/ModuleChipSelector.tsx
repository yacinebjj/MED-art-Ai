"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import { Button } from "@/components/ui/Button";
import type { CurriculumYearData } from "@/types/academic";

const GROUP_LIST_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const GROUP_ITEM_VARIANTS = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

interface ModuleChipSelectorProps {
  selectedModuleIds: Set<number>;
  onChange: (next: Set<number>) => void;
  onNext: () => void;
}

interface ChipGroup {
  label: string;
  modules: { id: number; title: string }[];
}

/**
 * Étape 1 — multi-select module/unit chips, no dashboard-style big cards
 * (explicitly forbidden by the brief). Deliberately compact: `rounded-full`
 * pills in a `flex-wrap` row, grouped under a small label per teaching unit
 * so "quelles unités/modules" both read at a glance without an accordion.
 */
export function ModuleChipSelector({ selectedModuleIds, onChange, onNext }: ModuleChipSelectorProps) {
  const { language } = useLanguage();
  const [groups, setGroups] = useState<ChipGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const profileRes = await fetch("/api/profile");
        const profileBody = await profileRes.json();
        if (cancelled) return;

        const specialtyName: string | undefined = profileBody?.profile?.specialty?.name;
        const level: number | undefined = profileBody?.profile?.academicYear?.level;

        if (!specialtyName || !level) {
          setError(tTodo("missingSpecialtyError", language));
          return;
        }

        const curriculumRes = await fetch(`/api/curriculum?specialty=${encodeURIComponent(specialtyName)}&level=${level}`);
        const curriculum: CurriculumYearData = await curriculumRes.json();
        if (cancelled) return;
        if (!curriculumRes.ok) {
          setError(tTodo("modulesLoadError", language));
          return;
        }

        const nextGroups: ChipGroup[] = curriculum.teachingUnits
          .filter((unit) => unit.modules.length > 0)
          .map((unit) => ({ label: unit.title, modules: unit.modules.map((m) => ({ id: m.id, title: m.title })) }));

        if (curriculum.independentModules.length > 0) {
          nextGroups.push({
            label: tTodo("independentModulesGroup", language),
            modules: curriculum.independentModules.map((m) => ({ id: m.id, title: m.title })),
          });
        }

        setGroups(nextGroups);
      } catch {
        if (!cancelled) setError(tTodo("modulesLoadError", language));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Runs once on mount to fetch modules — `language` is read for its value
    // at that moment only, not a reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: number) {
    const next = new Set(selectedModuleIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">{tTodo("moduleSelectorTitle", language)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tTodo("moduleSelectorSubtitle", language)}</p>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {!groups && !error && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {tTodo("modulesLoading", language)}
        </div>
      )}

      {groups?.length === 0 && <p className="text-sm text-muted-foreground">{tTodo("modulesEmpty", language)}</p>}

      <motion.div className="space-y-5" variants={GROUP_LIST_VARIANTS} initial="hidden" animate="show">
        {groups?.map((group) => (
          <motion.div key={group.label} variants={GROUP_ITEM_VARIANTS}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
            <div className="flex flex-wrap gap-2">
              {group.modules.map((mod) => {
                const isSelected = selectedModuleIds.has(mod.id);
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => toggle(mod.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-200 active:scale-95 sm:py-2",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary shadow-glow"
                        : "border-input bg-card text-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-soft"
                    )}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                    {mod.title}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        {/*
          A disabled "Suivant" with no explanation forces the student to guess
          why — this names the reason directly, and doubles as a live count so
          a long multi-group selection stays legible at a glance.
        */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 self-center rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 sm:self-auto",
            selectedModuleIds.size > 0
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-muted/50 text-muted-foreground"
          )}
        >
          {selectedModuleIds.size > 0 && <Check className="h-3.5 w-3.5" />}
          {selectedModuleIds.size > 0
            ? tTodo(selectedModuleIds.size > 1 ? "selectedCountPlural" : "selectedCountSingular", language).replace(
                "{n}",
                String(selectedModuleIds.size)
              )
            : tTodo("selectAtLeastOne", language)}
        </span>
        <Button type="button" size="lg" onClick={onNext} disabled={selectedModuleIds.size === 0} className="w-full sm:w-auto">
          {tTodo("next", language)}
        </Button>
      </div>
    </div>
  );
}
