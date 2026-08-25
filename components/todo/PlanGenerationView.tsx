"use client";

import { FormEvent, useMemo, useState } from "react";
import { Clock, PlayCircle, Save, Send, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import type { GeneratedPlanDay, StudyPlanChatMessage } from "@/types/study-planner";

interface PlanGenerationViewProps {
  planId: number;
  initialCoachMessage: string;
  initialDays: GeneratedPlanDay[];
  onSaved: (status: "draft" | "active") => void;
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
export function PlanGenerationView({ planId, initialCoachMessage, initialDays, onSaved }: PlanGenerationViewProps) {
  const { toast } = useToast();
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

      toast({ variant: "success", title: status === "active" ? "Ton planning est lancé !" : "Plan sauvegardé." });
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
        <h2 className="text-lg font-bold tracking-tight text-foreground">Ton planning de révision</h2>
        <p className="mt-1 text-sm text-muted-foreground">Demande des ajustements dans le chat ci-dessous, puis sauvegarde ou lance l'exécution.</p>
      </div>

      {error && <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="max-h-[420px] space-y-5 overflow-y-auto rounded-2xl border border-border bg-card/60 p-4">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Semaine {weekIndex + 1}</p>
            <div className="space-y-2">
              {week.map((day) => (
                <div key={day.date} className="rounded-xl border border-border bg-card p-3">
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
        <div className="max-h-64 space-y-3 overflow-y-auto p-4">
          {chatMessages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                    : "flex max-w-[80%] items-start gap-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground"
                }
              >
                {m.role === "assistant" && <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />}
                <span className="whitespace-pre-wrap">{m.content}</span>
              </div>
            </div>
          ))}
          {isRefining && <p className="text-xs text-muted-foreground">Coach MedArt ajuste ton planning...</p>}
        </div>
        <form onSubmit={handleRefine} className="flex items-center gap-2 border-t border-border p-3">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Ex : Ajoute plus de temps pour la cardiologie"
            disabled={isRefining}
            className="flex-1 rounded-xl border border-input bg-transparent px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" size="icon" isLoading={isRefining} disabled={!chatInput.trim()}>
            {!isRefining && <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={() => persist("draft")} isLoading={isSaving === "draft"} disabled={isSaving !== null}>
          {isSaving !== "draft" && <Save className="h-4 w-4" />}
          Sauvegarder
        </Button>
        <Button type="button" size="lg" onClick={() => persist("active")} isLoading={isSaving === "active"} disabled={isSaving !== null}>
          {isSaving !== "active" && <PlayCircle className="h-4 w-4" />}
          START
        </Button>
      </div>
    </div>
  );
}
