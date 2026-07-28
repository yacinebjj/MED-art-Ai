"use client";

/**
 * Gamification & Study Timer — UI-first prototype.
 *
 * ZERO backend: everything here is local React state + mock data, per spec.
 * The 6 action trackers below map 1:1 to the 6 study features that actually
 * exist in this codebase today (verified against lib/types.ts's
 * STUDIO_CONTENT_TYPES/STUDIO_CHUNKED_CONTENT_TYPES and lib/demo-content.ts's
 * DEMO_SECTIONS before writing any of this):
 *   - Cours Oral            (components/course/workspace/CenterReader.tsx content)
 *   - Explication Ultra-Détaillée
 *   - Mode Visuel
 *   - Résumé
 *   - Cas Clinique          (CasCliniqueStudio.tsx / CasCliniqueLive.tsx)
 *   - Examen QCMs           (ExamQcmStudio.tsx / ExamQcmLive.tsx)
 * No flashcards, no other invented feature — those are the only 6 that exist.
 * Icons below match the ones already used for each feature elsewhere in the
 * app (StudioSidebar.tsx's Mic for Cours Oral; lib/demo-content.ts's
 * BookOpenText/Workflow/ScrollText/Stethoscope/ListChecks for the rest).
 */

import { useEffect, useRef, useState } from "react";
import {
  Trophy,
  Award,
  Flame,
  Play,
  Pause,
  Square,
  Plus,
  Minus,
  Clock,
  Sparkles,
  Mic,
  BookOpenText,
  Workflow,
  ScrollText,
  Stethoscope,
  ListChecks,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------------- */
/* Mock header stats — static "lifetime" numbers, independent of the live   */
/* session below (per spec: section 1 is a mock display, section 4 is the  */
/* separate live per-session counter).                                     */
/* ----------------------------------------------------------------------- */

const MOCK_TOTAL_XP = 2450;
const MOCK_LEVEL_NUMBER = 4;
const MOCK_LEVEL_TITLE = "Clinical Clerk";
const MOCK_STREAK_DAYS = 7;

/* ----------------------------------------------------------------------- */
/* Action trackers — one per real study feature, with its own XP weight.   */
/* Literal per-action Tailwind classes (not string-interpolated) so the    */
/* JIT scanner picks every one of them up.                                 */
/* ----------------------------------------------------------------------- */

type ActionId = "cours_oral" | "explication" | "mode_visuel" | "resume" | "cas_clinique" | "qcm";

interface ActionConfig {
  id: ActionId;
  label: string;
  icon: LucideIcon;
  xpPerAction: number;
  chip: string;
  ring: string;
  button: string;
}

const ACTIONS: ActionConfig[] = [
  {
    id: "cours_oral",
    label: "Cours Oral Écoutés",
    icon: Mic,
    xpPerAction: 4,
    chip: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
    ring: "border-blue-100 dark:border-blue-900/40",
    button: "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60",
  },
  {
    id: "explication",
    label: "Explications Lues",
    icon: BookOpenText,
    xpPerAction: 6,
    chip: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
    ring: "border-indigo-100 dark:border-indigo-900/40",
    button: "bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60",
  },
  {
    id: "mode_visuel",
    label: "Modes Visuels Consultés",
    icon: Workflow,
    xpPerAction: 4,
    chip: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-400",
    ring: "border-cyan-100 dark:border-cyan-900/40",
    button: "bg-cyan-100 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-900/40 dark:text-cyan-300 dark:hover:bg-cyan-900/60",
  },
  {
    id: "resume",
    label: "Fiches Résumé Révisées",
    icon: ScrollText,
    xpPerAction: 8,
    chip: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400",
    ring: "border-teal-100 dark:border-teal-900/40",
    button: "bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:hover:bg-teal-900/60",
  },
  {
    id: "cas_clinique",
    label: "Cas Cliniques Complétés",
    icon: Stethoscope,
    xpPerAction: 15,
    chip: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
    ring: "border-rose-100 dark:border-rose-900/40",
    button: "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60",
  },
  {
    id: "qcm",
    label: "QCM Répondus",
    icon: ListChecks,
    xpPerAction: 5,
    chip: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    ring: "border-amber-100 dark:border-amber-900/40",
    button: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60",
  },
];

const XP_PER_MINUTE = 2;

type SessionStatus = "idle" | "running" | "paused" | "ended";

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const EMPTY_COUNTS: Record<ActionId, number> = {
  cours_oral: 0,
  explication: 0,
  mode_visuel: 0,
  resume: 0,
  cas_clinique: 0,
  qcm: 0,
};

export function StudyDashboard() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [counts, setCounts] = useState<Record<ActionId, number>>(EMPTY_COUNTS);
  const [showSummary, setShowSummary] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ticks once per second only while "running" — cleared on every status
  // change and on unmount, so no interval ever outlives this effect.
  useEffect(() => {
    if (status !== "running") return;

    intervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [status]);

  const minutesActive = elapsedSeconds / 60;
  const xpFromTime = Math.floor(minutesActive * XP_PER_MINUTE);
  const xpFromActions = ACTIONS.reduce((sum, action) => sum + counts[action.id] * action.xpPerAction, 0);
  const sessionXp = xpFromTime + xpFromActions;

  function adjustCount(id: ActionId, delta: number) {
    setCounts((prev) => ({ ...prev, [id]: Math.max(0, prev[id] + delta) }));
  }

  function handleStart() {
    setStatus("running");
  }

  function handlePause() {
    setStatus("paused");
  }

  function handleEndSession() {
    setStatus("ended");
    setShowSummary(true);
  }

  function handleSaveAndReset() {
    setShowSummary(false);
    setStatus("idle");
    setElapsedSeconds(0);
    setCounts(EMPTY_COUNTS);
  }

  const hasProgress = elapsedSeconds > 0 || Object.values(counts).some((c) => c > 0);

  return (
    <div className="w-full mx-auto space-y-6 font-sans text-slate-800 dark:text-slate-200">
      {/* 1. Header Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-soft">
          <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
            <Trophy className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Total XP</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{MOCK_TOTAL_XP.toLocaleString("fr-FR")} XP</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-soft">
          <div className="w-11 h-11 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
            <Award className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Niveau</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">
              Niveau {MOCK_LEVEL_NUMBER}: {MOCK_LEVEL_TITLE}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-soft">
          <div className="w-11 h-11 rounded-xl bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center shrink-0">
            <Flame className="w-5 h-5 text-rose-600 dark:text-rose-400" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Série</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{MOCK_STREAK_DAYS} jours d&apos;affilée</p>
          </div>
        </div>
      </div>

      {/* 2. Smart Study Timer */}
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-soft text-center space-y-6">
        <div className="flex items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
          <Clock className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-widest">Session de révision</span>
        </div>

        <p className="text-5xl md:text-6xl font-black tracking-tight tabular-nums text-slate-900 dark:text-white">
          {formatClock(elapsedSeconds)}
        </p>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={handleStart}
            disabled={status === "running"}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all duration-200",
              "bg-teal-600 text-white hover:bg-teal-700 active:scale-95",
              "disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed disabled:active:scale-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
            )}
          >
            <Play className="w-4 h-4" />
            {status === "paused" ? "Reprendre" : "Start"}
          </button>

          <button
            onClick={handlePause}
            disabled={status !== "running"}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all duration-200",
              "bg-amber-500 text-white hover:bg-amber-600 active:scale-95",
              "disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed disabled:active:scale-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
            )}
          >
            <Pause className="w-4 h-4" />
            Pause
          </button>

          <button
            onClick={handleEndSession}
            disabled={!hasProgress}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition-all duration-200",
              "bg-rose-600 text-white hover:bg-rose-700 active:scale-95",
              "disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed disabled:active:scale-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
            )}
          >
            <Square className="w-4 h-4" />
            End Session
          </button>
        </div>
      </div>

      {/* 3. Dynamic Action Trackers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const count = counts[action.id];
          return (
            <div
              key={action.id}
              className={cn("rounded-2xl border bg-white dark:bg-slate-900 p-5 shadow-soft space-y-3", action.ring)}
            >
              <div className="flex items-center gap-2">
                <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", action.chip)}>
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{action.label}</p>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">{count}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => adjustCount(action.id, -1)}
                    disabled={count === 0}
                    aria-label={`Diminuer ${action.label}`}
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150",
                      "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => adjustCount(action.id, 1)}
                    aria-label={`Augmenter ${action.label}`}
                    className={cn("w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150", action.button)}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">+{action.xpPerAction} XP par action</p>
            </div>
          );
        })}
      </div>

      {/* 4. Real-Time XP Engine */}
      <div className="rounded-2xl border border-teal-200 dark:border-teal-900/40 bg-gradient-to-br from-teal-50 to-blue-50 dark:from-teal-950/30 dark:to-blue-950/30 p-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 flex items-center justify-center shadow-sm shrink-0">
            <Sparkles className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">XP Gagnés Cette Session</p>
            <p className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">{sessionXp} XP</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs text-right">
          {Math.floor(minutesActive)} min × {XP_PER_MINUTE} XP + actions trackées ci-dessus
        </p>
      </div>

      {/* 5. End Session Summary Modal */}
      {showSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/50">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 p-7 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Session Terminée</p>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Bravo pour cette session !</h3>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">Temps de concentration total</span>
              <span className="text-lg font-black text-slate-900 dark:text-white tabular-nums">{formatClock(elapsedSeconds)}</span>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Actions de révision
              </p>
              <ul className="space-y-1.5">
                {ACTIONS.map((action) => (
                  <li key={action.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <action.icon className="w-3.5 h-3.5 text-slate-400" />
                      {action.label}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-100 tabular-nums">
                      {counts[action.id]} × {action.xpPerAction} XP
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border-2 border-teal-300 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 p-4 flex items-center justify-between">
              <span className="text-sm font-black uppercase tracking-wide text-teal-700 dark:text-teal-400">XP Total Gagné</span>
              <span className="text-2xl font-black text-teal-700 dark:text-teal-300 tabular-nums">+{sessionXp} XP</span>
            </div>

            <button
              onClick={handleSaveAndReset}
              className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
            >
              Save &amp; Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
