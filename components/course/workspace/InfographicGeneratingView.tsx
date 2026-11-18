"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { useLanguage } from "@/providers/LanguageProvider";
import type { FichePlanView } from "@/lib/infographic-fiche-key";
import { cn } from "@/lib/utils";

/** While the course is read and its plan extracted (step 1). */
const PLAN_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Lecture du cours…", en: "Reading the course…" },
  { fr: "Choix des 6 notions clés…", en: "Picking the 6 key topics…" },
  { fr: "Préparation du plan de la fiche…", en: "Planning the sheet…" },
];

/** While the image model draws the sheet (step 2). */
const DRAWING_MESSAGES: { fr: string; en: string }[] = [
  { fr: "Dessin des illustrations médicales…", en: "Drawing the medical illustrations…" },
  { fr: "Mise en page des encadrés…", en: "Laying out the boxes…" },
  { fr: "Écriture des notions clés…", en: "Writing the key points…" },
  { fr: "Finalisation de la fiche de synthèse…", en: "Finishing the summary sheet…" },
];

/** Soft pastel boxes, like the sheet's own (no blue: the Studio's graphite identity). */
const BOX_TINTS = [
  "border-rose-200/80 bg-rose-50 dark:border-rose-300/15 dark:bg-rose-300/[0.06]",
  "border-amber-200/80 bg-amber-50 dark:border-amber-300/15 dark:bg-amber-300/[0.06]",
  "border-emerald-200/80 bg-emerald-50 dark:border-emerald-300/15 dark:bg-emerald-300/[0.06]",
  "border-violet-200/80 bg-violet-50 dark:border-violet-300/15 dark:bg-violet-300/[0.06]",
  "border-orange-200/80 bg-orange-50 dark:border-orange-300/15 dark:bg-orange-300/[0.06]",
  "border-fuchsia-200/80 bg-fuchsia-50 dark:border-fuchsia-300/15 dark:bg-fuchsia-300/[0.06]",
];

const SKELETON_BAR = "animate-pulse rounded-full bg-zinc-900/[0.07] dark:bg-white/[0.08]";

/** "1:07" — the time since the generation started. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The three stages, as the student sees them: the plan (step 1), the drawing (step 2), the sheet on screen. */
function StageTrack({ planReady, language }: { planReady: boolean; language: "fr" | "en" }) {
  const stages: { label: string; state: "done" | "active" | "pending" }[] = [
    { label: language === "fr" ? "Plan du cours" : "Course plan", state: planReady ? "done" : "active" },
    { label: "Illustration", state: planReady ? "active" : "pending" },
    { label: language === "fr" ? "Ta fiche" : "Your sheet", state: "pending" },
  ];
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2" aria-label={language === "fr" ? "Étapes de la fiche" : "Sheet steps"}>
      {stages.map((stage, i) => (
        <li key={stage.label} className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {i > 0 && <span aria-hidden className={cn("h-px w-3 shrink-0 sm:w-6", stage.state === "pending" ? "bg-border" : "bg-foreground/40")} />}
          <span
            className={cn(
              "inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              stage.state === "done" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              stage.state === "active" && "bg-foreground/[0.08] text-foreground",
              stage.state === "pending" && "text-muted-foreground"
            )}
            aria-current={stage.state === "active" ? "step" : undefined}
          >
            {stage.state === "done" ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : stage.state === "active" ? (
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
            ) : null}
            <span className="truncate">{stage.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The Studio's "Infographie / Fiche de Synthèse" while it is being made: a
 * live preview of the sheet. Before the plan arrives (step 1), six empty
 * pastel boxes; once it does, the real title and the six key topics the
 * image is being drawn from (step 2, which takes the longest) — readable in
 * full, so the wait is already revision. The stages and the time elapsed
 * show the work moving, and the student is told plainly that they can go on
 * revising: the sheet lands here, and a toast says so, when it's ready.
 */
export function InfographicGeneratingView({ plan, startedAt }: { plan: FichePlanView | null; startedAt?: number }) {
  const { language } = useLanguage();
  const messages = plan ? DRAWING_MESSAGES : PLAN_MESSAGES;
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  const since = startedAt ?? mountedAt;

  useEffect(() => {
    setIndex(0);
    const interval = setInterval(() => setIndex((i) => (i + 1) % messages.length), 3500);
    return () => clearInterval(interval);
  }, [messages]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 py-2 sm:py-4">
      <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-soft">
        <div className="flex items-center gap-3">
          <BrandLoader className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {language === "fr" ? "Ta fiche de synthèse illustrée est en préparation" : "Your illustrated summary sheet is on its way"}
            </p>
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {messages[index % messages.length][language]}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
            title={language === "fr" ? "Temps écoulé" : "Time elapsed"}
          >
            {formatElapsed(now - since)}
          </span>
        </div>
        <StageTrack planReady={Boolean(plan)} language={language} />
      </div>

      <div className="rounded-3xl border border-border bg-zinc-50 p-3 dark:bg-zinc-900/60 sm:p-4" aria-hidden={!plan}>
        {plan ? (
          <p key="title" className="animate-fade-in mb-3 text-balance text-center text-sm font-extrabold uppercase tracking-wide text-foreground sm:text-base">
            {plan.title}
          </p>
        ) : (
          <div className={cn("mx-auto mb-3 h-4 w-2/3", SKELETON_BAR)} />
        )}

        <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {BOX_TINTS.map((tint, i) => {
            const topic = plan?.topics[i];
            return (
              <li key={i} className={cn("flex min-h-[5.25rem] gap-3 rounded-2xl border p-3", tint)}>
                <div className="min-w-0 flex-1">
                  {topic ? (
                    <div key="topic" className="animate-fade-in">
                      <p className="text-xs font-bold leading-snug text-foreground">
                        <span className="tabular-nums">{i + 1}.</span> {topic.heading}
                      </p>
                      {topic.details ? (
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{topic.details}</p>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          <div className={cn("h-2 w-full", SKELETON_BAR)} />
                          <div className={cn("h-2 w-4/5", SKELETON_BAR)} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-0.5">
                      <div className={cn("h-2.5 w-1/2", SKELETON_BAR)} />
                      <div className={cn("h-2 w-full", SKELETON_BAR)} />
                      <div className={cn("h-2 w-4/5", SKELETON_BAR)} />
                    </div>
                  )}
                </div>
                {/* Where the box's drawing will go. */}
                <span
                  aria-hidden
                  className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/80 ring-1 ring-zinc-900/[0.06] dark:bg-white/[0.07] dark:ring-white/[0.08]"
                  style={{ animationDelay: `${i * 180}ms` }}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <p className="text-balance text-center text-[11px] leading-relaxed text-muted-foreground">
        {language === "fr"
          ? "Le plan vient de ton cours : tu peux déjà le réviser. Le dessin de la fiche prend un peu de temps — continue ailleurs si tu veux, elle s'affichera ici et on te prévient dès qu'elle est prête."
          : "The plan comes from your course: you can already revise it. Drawing the sheet takes a little while — carry on elsewhere if you like; it will appear here and we'll let you know as soon as it's ready."}
      </p>
    </div>
  );
}
