"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModuleChipSelector } from "@/components/todo/ModuleChipSelector";
import { PlanConfigForm } from "@/components/todo/PlanConfigForm";
import { PlanGenerationView } from "@/components/todo/PlanGenerationView";
import { PlanExecutionView } from "@/components/todo/PlanExecutionView";
import type { GeneratedPlanDay, StudyPlan, StudyPlanTask } from "@/types/study-planner";

type WizardStep =
  | { name: "loading" }
  | { name: "modules" }
  | { name: "config" }
  | { name: "generate"; planId: number; coachMessage: string; days: GeneratedPlanDay[] }
  | { name: "execute"; planId: number; tasks: StudyPlanTask[] };

/**
 * "To-Do List & AI Study Planner" — a 4-step tunnel: sélection des modules
 * (chips) -> configuration + upload -> génération IA + chat d'affinement ->
 * exécution (to-do quotidienne). Resumes automatically on revisit: an
 * `active` plan jumps straight to execution, a `draft` plan that already
 * reached generation jumps back there — anything earlier just restarts the
 * tunnel rather than trying to reconstruct a half-finished config.
 */
export default function TodoPage() {
  const [step, setStep] = useState<WizardStep>({ name: "loading" });
  const [selectedModuleIds, setSelectedModuleIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const res = await fetch("/api/study-planner/plans");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setStep({ name: "modules" });
          return;
        }

        const plans: StudyPlan[] = data.plans ?? [];
        const activePlan = plans.find((p) => p.status === "active");
        const resumableDraft = plans.find((p) => p.status === "draft" && p.generatedPlan);

        const target = activePlan ?? resumableDraft;
        if (!target) {
          setStep({ name: "modules" });
          return;
        }

        setSelectedModuleIds(new Set(target.moduleIds));

        const detailRes = await fetch(`/api/study-planner/plans/${target.id}`);
        const detailData = await detailRes.json();
        if (cancelled) return;
        if (!detailRes.ok || !detailData.success) {
          setStep({ name: "modules" });
          return;
        }

        if (activePlan) {
          setStep({ name: "execute", planId: target.id, tasks: detailData.tasks ?? [] });
        } else if (target.generatedPlan) {
          setStep({ name: "generate", planId: target.id, coachMessage: "Te revoilà — voici où tu en étais.", days: target.generatedPlan });
        } else {
          setStep({ name: "modules" });
        }
      } catch {
        if (!cancelled) setStep({ name: "modules" });
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePlanSaved(planId: number, status: "draft" | "active") {
    if (status !== "active") return;
    const res = await fetch(`/api/study-planner/plans/${planId}`);
    const data = await res.json();
    if (res.ok && data.success) {
      setStep({ name: "execute", planId, tasks: data.tasks ?? [] });
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">To-Do List &amp; AI Study Planner</h1>
      <p className="mt-1 text-sm text-muted-foreground">Construis un planning de révision réaliste, généré et affiné par l'IA, puis exécute-le jour après jour.</p>

      <div className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-soft">
        {step.name === "loading" && (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement...
          </div>
        )}

        {step.name === "modules" && (
          <ModuleChipSelector selectedModuleIds={selectedModuleIds} onChange={setSelectedModuleIds} onNext={() => setStep({ name: "config" })} />
        )}

        {step.name === "config" && (
          <PlanConfigForm
            selectedModuleIds={selectedModuleIds}
            onBack={() => setStep({ name: "modules" })}
            onGenerated={(result) => setStep({ name: "generate", ...result })}
          />
        )}

        {step.name === "generate" && (
          <PlanGenerationView
            planId={step.planId}
            initialCoachMessage={step.coachMessage}
            initialDays={step.days}
            onSaved={(status) => handlePlanSaved(step.planId, status)}
          />
        )}

        {step.name === "execute" && <PlanExecutionView planId={step.planId} initialTasks={step.tasks} />}
      </div>
    </div>
  );
}
