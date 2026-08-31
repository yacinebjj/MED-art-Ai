"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardCheck, Loader2, ListChecks, Sparkles, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
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

const STEPS = [
  { key: "modules", labelKey: "stepModules", icon: ListChecks },
  { key: "config", labelKey: "stepConfig", icon: SlidersHorizontal },
  { key: "generate", labelKey: "stepGenerate", icon: Sparkles },
  { key: "execute", labelKey: "stepExecute", icon: ClipboardCheck },
] as const;

/**
 * "To-Do List & AI Study Planner" — a 4-step tunnel: sélection des modules
 * (chips) -> configuration + upload -> génération IA + chat d'affinement ->
 * exécution (to-do quotidienne). Resumes automatically on revisit: an
 * `active` plan jumps straight to execution, a `draft` plan that already
 * reached generation jumps back there — anything earlier just restarts the
 * tunnel rather than trying to reconstruct a half-finished config.
 */
export default function TodoPage() {
  const { language } = useLanguage();
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
          setStep({ name: "generate", planId: target.id, coachMessage: tTodo("resumedCoachMessage", language), days: target.generatedPlan });
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
    // Runs once on mount to resume an in-progress plan — `language` is read
    // for its value at that moment only, not a reason to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePlanSaved(planId: number, status: "draft" | "active") {
    if (status !== "active") return;
    const res = await fetch(`/api/study-planner/plans/${planId}`);
    const data = await res.json();
    if (res.ok && data.success) {
      setStep({ name: "execute", planId, tasks: data.tasks ?? [] });
    }
  }

  const currentIndex = step.name === "loading" ? -1 : STEPS.findIndex((s) => s.key === step.name);

  return (
    <div className="mx-auto max-w-3xl lg:max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">To-Do List &amp; AI Study Planner</h1>
        <p className="mt-1 text-sm text-muted-foreground">{tTodo("pageSubtitle", language)}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 sm:mt-6"
      >
        <TodoStepper currentIndex={currentIndex} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="glass-card mt-4 overflow-hidden rounded-2xl p-4 shadow-glass dark:shadow-glass-dark sm:mt-6 sm:rounded-3xl sm:p-6 lg:p-8"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={step.name}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {step.name === "loading" && (
              <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tTodo("loading", language)}
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
                onReset={() => setStep({ name: "modules" })}
              />
            )}

            {step.name === "execute" && (
              <PlanExecutionView planId={step.planId} initialTasks={step.tasks} onReset={() => setStep({ name: "modules" })} />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/**
 * The tunnel's step indicator — brief explicitly calls for a strong visual
 * continuity between steps, and none existed before. A connecting line
 * fills as steps complete; the active node gets a slow breathing pulse so
 * it reads as "in progress" rather than static. Labels hide below `sm`
 * (icons + fill bar carry the state on narrow phones) to avoid the 4-label
 * row wrapping or squeezing at ~360px.
 */
function TodoStepper({ currentIndex }: { currentIndex: number }) {
  const { language } = useLanguage();
  const current = currentIndex >= 0 ? STEPS[currentIndex] : null;
  const next = currentIndex >= 0 && currentIndex < STEPS.length - 1 ? STEPS[currentIndex + 1] : null;

  return (
    <div className="glass-card rounded-2xl px-3 py-3 shadow-glass dark:shadow-glass-dark sm:rounded-3xl sm:px-6 sm:py-4">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const isDone = currentIndex > i;
          const isActive = i === currentIndex;
          const Icon = s.icon;
          return (
            <div key={s.key} className={cn("flex items-center", i < STEPS.length - 1 ? "flex-1" : "flex-none")}>
              <div className="flex flex-col items-center gap-1.5">
                <motion.span
                  animate={isActive ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 1.8, repeat: isActive ? Infinity : 0, ease: "easeInOut" }}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-300 sm:h-10 sm:w-10",
                    isDone
                      ? "border-primary bg-primary text-primary-foreground shadow-glow"
                      : isActive
                        ? "border-primary bg-primary/10 text-primary shadow-glow"
                        : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                </motion.span>
                <span
                  className={cn(
                    "hidden text-[11px] font-medium sm:block",
                    isActive ? "text-primary" : isDone ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {tTodo(s.labelKey, language)}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-border sm:mx-3">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={false}
                    animate={{ width: isDone ? "100%" : "0%" }}
                    transition={{ duration: 0.45, ease: "easeOut" }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/*
        Labels above hide below `sm` to keep the 4-icon row from wrapping on
        narrow phones — but that left mobile with zero text context beyond a
        fill bar. This caption is the phone-sized substitute: it always names
        the current step and previews the next one, so "where am I / what's
        next" stays answered without needing the `sm:` labels.
      */}
      {current && (
        <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[11px] leading-relaxed sm:hidden">
          <span className="font-semibold text-primary">
            {tTodo("stepWord", language)} {currentIndex + 1}/{STEPS.length} · {tTodo(current.labelKey, language)}
          </span>
          {next && <span className="text-muted-foreground">{tTodo("nextWord", language)} {tTodo(next.labelKey, language)}</span>}
        </p>
      )}
    </div>
  );
}
