"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlarmClock, Crosshair, Dices, Gauge, HelpCircle, ShieldAlert, Target, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";

/**
 * "Mode Concours" for the workspace's QCM tile (InteractiveQuiz with
 * `concoursTools`): a per-question confidence rating stated BEFORE answering,
 * a calibration report once every question is answered (confidently wrong
 * answers are the real exam traps), and an optional countdown at concours
 * pace. Everything here is local to the quiz — no server round trip.
 */

export type Confidence = "sur" | "hesitant" | "hasard";
export type TimerMode = "libre" | "concours" | "sprint";

const CONFIDENCE_OPTIONS: { id: Confidence; label: string; icon: typeof Target; active: string }[] = [
  { id: "sur", label: "Sûr", icon: Target, active: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" },
  { id: "hesitant", label: "Hésitant", icon: HelpCircle, active: "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300" },
  { id: "hasard", label: "Au hasard", icon: Dices, active: "border-slate-400 bg-slate-100 text-slate-700 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200" },
];

/** Seconds per question for each timed mode — concours pace (~1 min 30) and a faster sprint. */
export const SECONDS_PER_QUESTION: Record<Exclude<TimerMode, "libre">, number> = { concours: 90, sprint: 60 };

export function ConfidencePicker({
  value,
  locked,
  onChange,
}: {
  value: Confidence | undefined;
  /** Once the question is answered the rating can't change — rating after seeing the correction would defeat the point. */
  locked: boolean;
  onChange: (value: Confidence) => void;
}) {
  if (locked && !value) {
    return <p className="px-1 text-[11px] text-muted-foreground">Certitude non renseignée pour cette question.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1" role="radiogroup" aria-label="Ton niveau de certitude avant de répondre">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{locked ? "Certitude" : "Avant de répondre :"}</span>
      {CONFIDENCE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = value === option.id;
        if (locked && !selected) return null;
        return (
          <motion.button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={locked}
            whileTap={locked ? undefined : { scale: 0.94 }}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-default",
              selected ? option.active : "border-border text-muted-foreground hover:border-primary-300 hover:text-foreground"
            )}
          >
            <Icon className="h-3 w-3" />
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
}

function formatClock(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.abs(totalSeconds);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Timer mode selector + the live countdown. Owns its own one-second tick,
 * so the (large) quiz around it never re-renders every second.
 */
export function ConcoursModeBar({
  mode,
  onModeChange,
  startedAt,
  questionCount,
  answeredCount,
  finished,
}: {
  mode: TimerMode;
  onModeChange: (mode: TimerMode) => void;
  /** Epoch ms when the current timed run started (null in "libre"). */
  startedAt: number | null;
  questionCount: number;
  answeredCount: number;
  finished: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [frozenAt, setFrozenAt] = useState<number | null>(null);

  useEffect(() => {
    if (mode === "libre" || startedAt === null || finished) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [mode, startedAt, finished]);

  // Freeze the clock the moment the last question is answered, so the
  // summary shows the real time used, not a still-running countdown.
  useEffect(() => {
    if (finished && frozenAt === null) setFrozenAt(Date.now());
    if (!finished && frozenAt !== null) setFrozenAt(null);
  }, [finished, frozenAt]);

  const budgetSeconds = mode === "libre" ? 0 : SECONDS_PER_QUESTION[mode] * questionCount;
  const elapsedSeconds = startedAt === null ? 0 : Math.max(0, Math.floor(((frozenAt ?? now) - startedAt) / 1000));
  const remaining = budgetSeconds - elapsedSeconds;
  const isOvertime = mode !== "libre" && remaining < 0;
  const ratio = mode === "libre" || budgetSeconds === 0 ? 0 : Math.min(1, elapsedSeconds / budgetSeconds);

  const modes: { id: TimerMode; label: string; hint: string }[] = [
    { id: "libre", label: "Libre", hint: "Sans chronomètre" },
    { id: "concours", label: "Concours", hint: `${SECONDS_PER_QUESTION.concours} s par question` },
    { id: "sprint", label: "Sprint", hint: `${SECONDS_PER_QUESTION.sprint} s par question` },
  ];

  return (
    <div className="sticky top-0 z-10 space-y-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">
          <Gauge className="h-4 w-4" />
          Mode Concours
        </span>
        <div className="flex items-center rounded-xl border border-border p-0.5" role="radiogroup" aria-label="Mode chronométré">
          {modes.map((m) => (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => onModeChange(m.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                    mode === m.id ? "bg-teal-600 text-white dark:bg-teal-500" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>{m.hint}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        {mode !== "libre" && (
          <span
            role="timer"
            aria-live="off"
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-xl px-2.5 py-1 font-mono text-sm font-black tabular-nums",
              isOvertime ? "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
            )}
          >
            {isOvertime ? <AlarmClock className="h-4 w-4 animate-pulse" /> : <Timer className="h-4 w-4" />}
            {formatClock(remaining)}
          </span>
        )}
      </div>
      {mode !== "libre" && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <motion.div
              className={cn("h-full rounded-full", isOvertime ? "bg-rose-500" : ratio > 0.8 ? "bg-amber-500" : "bg-teal-500")}
              animate={{ width: `${Math.max(2, ratio * 100)}%` }}
              transition={{ ease: "linear", duration: 0.9 }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {finished
              ? `Terminé en ${formatClock(elapsedSeconds)} pour un temps alloué de ${formatClock(budgetSeconds)}.`
              : isOvertime
                ? "Temps écoulé — au concours, la copie serait ramassée. Termine quand même pour voir ta correction."
                : `${answeredCount}/${questionCount} répondues · rythme cible ${SECONDS_PER_QUESTION[mode]} s par question.`}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Confidence × correctness report shown once every question is answered.
 * "Sûr mais faux" is the category that actually costs points on exam day,
 * so it's listed first, by question number.
 */
export function CalibrationReport({
  items,
}: {
  items: { questionNumber: number; confidence: Confidence | undefined; isCorrect: boolean }[];
}) {
  const rated = items.filter((item) => item.confidence);
  if (rated.length === 0) return null;
  const sureWrong = rated.filter((item) => item.confidence === "sur" && !item.isCorrect);
  const sureRight = rated.filter((item) => item.confidence === "sur" && item.isCorrect);
  const unsureRight = rated.filter((item) => item.confidence !== "sur" && item.isCorrect);
  const unsureWrong = rated.filter((item) => item.confidence !== "sur" && !item.isCorrect);
  // Calibrated = confident answers were right, unconfident ones were not.
  const calibration = Math.round(((sureRight.length + unsureWrong.length) / rated.length) * 100);

  const cells = [
    { label: "Sûr et juste", items: sureRight, tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200", hint: "Acquis solides." },
    { label: "Sûr mais faux", items: sureWrong, tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200", hint: "Tes vrais pièges : à retravailler en priorité." },
    { label: "Hésitant mais juste", items: unsureRight, tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200", hint: "Connaissances fragiles : à consolider." },
    { label: "Hésitant et faux", items: unsureWrong, tone: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300", hint: "Lacunes identifiées : à apprendre." },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
      aria-label="Calibration de ta certitude"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Crosshair className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        <h3 className="text-sm font-bold text-foreground">Calibration de ta certitude</h3>
        <span className="ml-auto rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-black tabular-nums text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">{calibration}% calibré</span>
      </div>
      {sureWrong.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {sureWrong.length} réponse{sureWrong.length > 1 ? "s" : ""} donnée{sureWrong.length > 1 ? "s" : ""} avec certitude mais fausse{sureWrong.length > 1 ? "s" : ""} — ce sont exactement les questions qui coûtent des points le jour J.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {cells.map((cell) => (
          <div key={cell.label} className={cn("rounded-xl border p-3", cell.tone)}>
            <p className="flex items-baseline justify-between text-xs font-bold">
              {cell.label}
              <span className="text-lg font-black tabular-nums">{cell.items.length}</span>
            </p>
            <p className="mt-0.5 text-[11px] opacity-80">{cell.hint}</p>
            {cell.items.length > 0 && (
              <p className="mt-1.5 text-[11px] font-semibold">Questions {cell.items.map((item) => item.questionNumber).join(", ")}</p>
            )}
          </div>
        ))}
      </div>
      {rated.length < items.length && (
        <p className="text-[11px] text-muted-foreground">
          {items.length - rated.length} question{items.length - rated.length > 1 ? "s" : ""} sans certitude renseignée — non comptée{items.length - rated.length > 1 ? "s" : ""} dans la calibration.
        </p>
      )}
    </motion.section>
  );
}
