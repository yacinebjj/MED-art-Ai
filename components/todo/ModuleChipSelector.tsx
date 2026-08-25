"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import type { CurriculumYearData } from "@/types/academic";

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
          setError("Renseigne d'abord ta spécialité et ton année dans Paramètres pour voir tes modules.");
          return;
        }

        const curriculumRes = await fetch(`/api/curriculum?specialty=${encodeURIComponent(specialtyName)}&level=${level}`);
        const curriculum: CurriculumYearData = await curriculumRes.json();
        if (cancelled) return;
        if (!curriculumRes.ok) {
          setError("Impossible de charger tes modules pour le moment.");
          return;
        }

        const nextGroups: ChipGroup[] = curriculum.teachingUnits
          .filter((unit) => unit.modules.length > 0)
          .map((unit) => ({ label: unit.title, modules: unit.modules.map((m) => ({ id: m.id, title: m.title })) }));

        if (curriculum.independentModules.length > 0) {
          nextGroups.push({
            label: "Modules indépendants",
            modules: curriculum.independentModules.map((m) => ({ id: m.id, title: m.title })),
          });
        }

        setGroups(nextGroups);
      } catch {
        if (!cancelled) setError("Impossible de charger tes modules pour le moment.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
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
        <h2 className="text-lg font-bold tracking-tight text-foreground">Quels modules veux-tu réviser ?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sélectionne un ou plusieurs modules — tu pourras ajouter des cours manuels à l'étape suivante.</p>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {!groups && !error && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement de tes modules...
        </div>
      )}

      {groups?.length === 0 && <p className="text-sm text-muted-foreground">Aucun module trouvé pour ton année académique.</p>}

      <div className="space-y-5">
        {groups?.map((group) => (
          <div key={group.label}>
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
                      "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary shadow-[0_0_0_1px_rgba(20,184,166,0.25)]"
                        : "border-input bg-card text-foreground hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-soft"
                    )}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" />}
                    {mod.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="button" onClick={onNext} disabled={selectedModuleIds.size === 0}>
          Suivant
        </Button>
      </div>
    </div>
  );
}
