"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";

export function MoveToModuleDialog({
  open,
  onOpenChange,
  course,
  modules,
  onModuleChanged,
  onModuleCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: PublicCourseSummary;
  modules: ModuleSummary[];
  onModuleChanged: (moduleId: number) => void;
  onModuleCreated: (newModule: ModuleSummary) => void;
}) {
  const { toast } = useToast();
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [newModuleName, setNewModuleName] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  async function assignModule(moduleId: number) {
    const res = await fetch(`/api/courses/slug/${course.slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ module_id: moduleId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? "Le déplacement a échoué.");
    onModuleChanged(moduleId);
  }

  async function handleUseExisting() {
    if (!selectedModuleId) return;
    setIsMoving(true);
    try {
      await assignModule(Number(selectedModuleId));
      toast({ variant: "success", title: "Cours déplacé" });
      setSelectedModuleId("");
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "error", title: "Échec du déplacement", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsMoving(false);
    }
  }

  async function handleCreateNew() {
    const name = newModuleName.trim();
    if (!name) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La création du module a échoué.");
      onModuleCreated(data.module);
      await assignModule(data.module.id);
      toast({ variant: "success", title: "Module créé et cours déplacé" });
      setNewModuleName("");
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "error", title: "Échec de la création", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsCreating(false);
    }
  }

  const isBusy = isMoving || isCreating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter à un module</DialogTitle>
          <DialogDescription>
            Range « {course.title} » dans un module existant, ou crée-en un nouveau.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                label="Module existant"
                placeholder={modules.length ? "Choisis un module" : "Aucun module pour l'instant"}
                options={modules.map((m) => ({ value: String(m.id), label: m.name }))}
                value={selectedModuleId}
                onValueChange={setSelectedModuleId}
                disabled={modules.length === 0 || isBusy}
              />
            </div>
            <Button type="button" onClick={handleUseExisting} disabled={!selectedModuleId || isBusy} isLoading={isMoving}>
              Déplacer
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ou</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Créer un nouveau module"
                placeholder="Ex : Cardiologie"
                value={newModuleName}
                onChange={(e) => setNewModuleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateNew();
                }}
                disabled={isBusy}
              />
            </div>
            <Button type="button" onClick={handleCreateNew} disabled={!newModuleName.trim() || isBusy} isLoading={isCreating}>
              Créer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
