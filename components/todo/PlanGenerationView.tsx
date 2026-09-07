"use client";

import { FormEvent, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, PlayCircle, RotateCcw, Save, Send, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/providers/LanguageProvider";
import { tTodo } from "@/lib/translations/todo";
import type { GeneratedPlanDay, StudyPlanChatMessage } from "@/types/study-planner";

interface PlanGenerationViewProps {
  planId: number;
  initialCoachMessage: string;
  initialDays: GeneratedPlanDay[];
  onSaved: (status: "draft" | "active") => void;
  onReset: () => void;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function groupByWeek(days: GeneratedPlanDay[]): GeneratedPlanDay[][] {
  const weeks: GeneratedPlanDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

/** Étape 3 — Timeline du planning généré + chat d'affinement en dessous. */
export function PlanGenerationView({ planId, initialCoachMessage, initialDays, onSaved, onReset }: PlanGenerationViewProps) {
  const { toast } = useToast();
  const { language } = useLanguage();
  const [days, setDays] = useState<GeneratedPlanDay[]>(initialDays);
  const [chatMessages, setChatMessages] = useState<StudyPlanChatMessage[]>([{ role: "assistant", content: initialCoachMessage }]);
  const [chatInput, setChatInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [isSaving, setIsSaving] = useState<"draft" | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const weeks = useMemo(() => groupByWeek(days), [days]);

  async function handleRefine(e: FormEvent) {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message || isRefining) return;

    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsRefining(true);
    setError(null);

    try {
      const res = await fetch("/api/study-planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, message }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'affinement a échoué.");

      setDays(data.days);
      setChatMessages(data.refinementChat);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${err instanceof Error ? err.message : "L'affinement a échoué."}` }]);
    } finally {
      setIsRefining(false);
    }
  }

  async function persist(status: "draft" | "active") {
    setIsSaving(status);
    setError(null);
    try {
      const res = await fetch(`/api/study-planner/plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generatedPlan: days, refinementChat: chatMessages, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La sauvegarde a échoué.");

      toast({ variant: "success", title: status === "active" ? tTodo("toastPlanLaunched", language) : tTodo("toastPlanSaved", language) });
      onSaved(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "La sauvegarde a échoué.");
    } finally {
      setIsSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">{tTodo("planTitle", language)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tTodo("planSubtitle", language)}</p>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="max-h-[340px] space-y-5 overflow-y-auto rounded-2xl border border-border bg-card/60 p-3 backdrop-blur-sm sm:max-h-[420px] sm:p-4">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{tTodo("weekLabel", language)} {weekIndex + 1}</p>
            <div className="space-y-2">
              {week.map((day) => (
                <div
                  key={day.date}
                  className="rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-soft"
                >
                  <p className="mb-1.5 text-sm font-semibold capitalize text-foreground">{WEEKDAY_FORMAT.format(new Date(`${day.date}T12:00:00`))}</p>
                  <ul className="space-y-1">
                    {day.items.map((item, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 text-sm">
                        <span className="text-foreground">{item.title}</span>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {item.hours}h
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="max-h-56 space-y-3 overflow-y-auto p-4 sm:max-h-64">
          <AnimatePresence initial={false}>
            {chatMessages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground sm:max-w-[80%]"
                      : "flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground sm:max-w-[80%]"
                  }
                >
                  {m.role === "assistant" && <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isRefining && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3 animate-pulse text-primary" />
              {tTodo("coachAdjusting", language)}
            </p>
          )}
        </div>
        <form onSubmit={handleRefine} className="flex items-center gap-2 border-t border-border p-3">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={tTodo("chatInputPlaceholder", language)}
            disabled={isRefining}
            className="flex-1 rounded-xl border border-input bg-transparent px-3.5 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm"
          />
          <Button type="submit" size="icon" className="h-11 w-11" isLoading={isRefining} disabled={!chatInput.trim()}>
            {!isRefining && <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        {/*
          Both CTAs read fine on their own (outline vs. glowing primary makes
          the primary action obvious), but nothing said what saving actually
          *does* — a student could easily read "Sauvegarder" as the safe
          default and miss that only START turns this into a live plan.
        */}
        <p className="text-xs text-muted-foreground sm:max-w-[15rem]">
          <span className="font-semibold text-foreground">{tTodo("saveLabel", language)}</span> {tTodo("ctaSaveExplain", language)} <span className="font-semibold text-foreground">{tTodo("startLabel", language)}</span> {tTodo("ctaStartExplain", language)}
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" size="lg" onClick={onReset} disabled={isSaving !== null} className="w-full sm:w-auto">
            <RotateCcw className="h-4 w-4" />
            {tTodo("backRestart", language)}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => persist("draft")} isLoading={isSaving === "draft"} disabled={isSaving !== null} className="w-full sm:w-auto">
            {isSaving !== "draft" && <Save className="h-4 w-4" />}
            {tTodo("saveLabel", language)}
          </Button>
          <Button type="button" size="lg" onClick={() => persist("active")} isLoading={isSaving === "active"} disabled={isSaving !== null} className="w-full shadow-glow sm:w-auto">
            {isSaving !== "active" && <PlayCircle className="h-4 w-4" />}
            {tTodo("startLabel", language)}
          </Button>
        </div>
      </div>
    </div>
  );
}
