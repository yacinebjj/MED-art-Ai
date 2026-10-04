"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ClipboardCheck, ListChecks, ListTodo, Loader2, Sparkles, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import { CyberHeader, CyberPanel, CyberStage } from "@/components/cyber/primitives";
import type { GeneratedPlanDay, StudyPlan, StudyPlanTask } from "@/types/study-planner";

// Each wizard step is its own chunk — only the one on screen is downloaded.
const stepLoading = () => (
  <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
    <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
  </div>
);
const ModuleChipSelector = dynamic(() => import("@/components/todo/ModuleChipSelector").then((m) => m.ModuleChipSelector), { ssr: false, loading: stepLoading });
const PlanConfigForm = dynamic(() => import("@/components/todo/PlanConfigForm").then((m) => m.PlanConfigForm), { ssr: false, loading: stepLoading });
const PlanGenerationView = dynamic(() => import("@/components/todo/PlanGenerationView").then((m) => m.PlanGenerationView), { ssr: false, loading: stepLoading });
const PlanExecutionView = dynamic(() => import("@/components/todo/PlanExecutionView").then((m) => m.PlanExecutionView), { ssr: false, loading: stepLoading });

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
 * "To-Do List & AI Study Planner" — a 4-step tunnel: modules (chips) ->
 * configuration + upload -> AI generation + refinement chat -> execution.
 * Resumes on revisit: an `active` plan jumps straight to execution, a
 * `draft` that already reached generation jumps back there.
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
    // Runs once on mount to resume an in-progress plan.
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
    <CyberStage accent="emerald" className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8">
      <CyberHeader
        icon={ListTodo}
        kicker={language === "fr" ? "Planificateur IA" : "AI planner"}
        title="To-Do List & AI Study Planner"
        subtitle={tTodo("pageSubtitle", language)}
      />

      <div className="mt-5 sm:mt-6">
        <TodoStepper currentIndex={currentIndex} />
      </div>

      <CyberPanel className="mt-4 overflow-hidden p-4 sm:mt-5 sm:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.name}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {step.name === "loading" && (
              <div className="flex items-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
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

            {step.name === "execute" && <PlanExecutionView planId={step.planId} initialTasks={step.tasks} onReset={() => setStep({ name: "modules" })} />}
          </motion.div>
        </AnimatePresence>
      </CyberPanel>
    </CyberStage>
  );
}

/**
 * The tunnel's step indicator: neon nodes linked by a filling laser line;
 * the active node breathes. Labels hide below `sm` (a caption names the
 * current / next step there instead).
 */
function TodoStepper({ currentIndex }: { currentIndex: number }) {
  const { language } = useLanguage();
  const current = currentIndex >= 0 ? STEPS[currentIndex] : null;
  const next = currentIndex >= 0 && currentIndex < STEPS.length - 1 ? STEPS[currentIndex + 1] : null;

  return (
    <CyberPanel className="px-3 py-3 sm:px-6 sm:py-4">
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
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-colors duration-300 sm:h-11 sm:w-11",
                    isDone
                      ? "border-emerald-300 bg-gradient-to-br from-emerald-300 to-cyan-400 text-slate-950 shadow-[0_0_18px_rgba(52,211,153,0.55)]"
                      : isActive
                        ? "border-cyan-300 bg-cyan-400/15 text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.55)]"
                        : "border-white/10 bg-white/[0.03] text-slate-500"
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </motion.span>
                <span className={cn("hidden text-[11px] font-bold sm:block", isActive ? "text-cyan-200" : isDone ? "text-white" : "text-slate-500")}>
                  {tTodo(s.labelKey, language)}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-white/[0.08] sm:mx-3">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]"
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

      {current && (
        <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[11px] leading-relaxed sm:hidden">
          <span className="font-bold text-cyan-200">
            {tTodo("stepWord", language)} {currentIndex + 1}/{STEPS.length} · {tTodo(current.labelKey, language)}
          </span>
          {next && (
            <span className="text-slate-500">
              {tTodo("nextWord", language)} {tTodo(next.labelKey, language)}
            </span>
          )}
        </p>
      )}
    </CyberPanel>
  );
}
