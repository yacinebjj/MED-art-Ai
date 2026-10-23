"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Clock3, Database, Gauge, GraduationCap, Hourglass, Layers, ListChecks, MessageSquareText, RotateCcw, SlidersHorizontal, Stethoscope, Timer, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/cyber/primitives";
import { TelemetryChip } from "@/components/cyber/GenerationAura";
import {
  DEFAULT_EXAM_PREFERENCES,
  EXAM_PREFERENCE_LABELS,
  isDefaultExamPreferences,
  type ExamDifficulty,
  type ExamExplanationDepth,
  type ExamPreferences,
  type ExamQuestionFocus,
} from "@/lib/exam-preferences";
import { SECONDS_PER_QUESTION, type ExamTimerMode } from "./ExamTimer";

/** Exams are generated with 40 to 60 questions (enforced server-side). */
const MIN_QUESTIONS = 40;
const MAX_QUESTIONS = 60;

function minutes(questions: number): number {
  return Math.round((questions * SECONDS_PER_QUESTION) / 60);
}

/** « Explications … » in the sur-mesure summary, agreed in number. */
const EXPLANATIONS_SUMMARY: Record<ExamExplanationDepth, string> = {
  concise: "Explications concises",
  standard: "Explications standard",
  approfondie: "Explications approfondies",
};

/**
 * What one click on « Générer l'examen » produces with these settings — the
 * same three cases the server routes (lib/exam-bank-profiles.ts):
 *  - "standard": the canonical exam, built from the shared question bank;
 *  - "style": a reference-exam run, built from its archetype's bank;
 *  - "custom": sur-mesure preferences, generated from scratch.
 */
export function examRunKind(preferences: ExamPreferences, hasStyleProfile: boolean): "standard" | "style" | "custom" {
  if (!isDefaultExamPreferences(preferences)) return "custom";
  return hasStyleProfile ? "style" : "standard";
}

/** One line for the launch button: what the click will do (non-breaking spaces where French typography keeps words together). */
export function examRunCaption(kind: "standard" | "style" | "custom", styleArchetypeLabel?: string | null): string {
  if (kind === "custom") return "Sur-mesure · généré de zéro (≈ 30–40 s)";
  if (kind === "style") return `Style de référence${styleArchetypeLabel ? ` « ${styleArchetypeLabel} »` : ""} · banque partagée de ce style`;
  return "Examen standard · banque de questions partagée";
}

/**
 * Pre-generation controls. One click generates the STANDARD exam (Examen
 * facultaire · Équilibré · Correction approfondie), the one served from the
 * shared question bank. Difficulty, question focus and explanation depth (real
 * prompt directives server-side) live under « Options avancées · Sur-mesure »:
 * changing them makes a tailor-made exam generated from scratch. The timer is
 * display-only — it never changes the questions.
 */
export function ExamConfigurator({
  preferences,
  onPreferencesChange,
  timerMode,
  onTimerModeChange,
  selectedCount,
  totalCourses,
  hasStyleProfile,
  styleArchetypeLabel,
  disabled,
  className,
}: {
  preferences: ExamPreferences;
  onPreferencesChange: (next: ExamPreferences) => void;
  timerMode: ExamTimerMode;
  onTimerModeChange: (next: ExamTimerMode) => void;
  selectedCount: number;
  totalCourses: number;
  hasStyleProfile: boolean;
  /** Archetype of the attached reference exam (lib/exam-bank-profiles.ts), shown to the student. */
  styleArchetypeLabel?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const kind = examRunKind(preferences, hasStyleProfile);
  const custom = kind === "custom";
  // Opened for a student whose saved settings are sur-mesure (read after mount), so it never hides what is active.
  const [advancedOpen, setAdvancedOpen] = useState(custom);
  useEffect(() => {
    if (custom) setAdvancedOpen(true);
  }, [custom]);

  const row = "space-y-2";
  const label = "flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <div className={cn("space-y-4", disabled && "pointer-events-none opacity-60", className)}>
      <div className={cn("rounded-2xl border p-4", custom ? "border-amber-400/30 bg-amber-500/[0.06]" : "border-cyan-400/25 bg-cyan-500/[0.06]")}>
        <p className={label}>
          <GraduationCap className="h-3.5 w-3.5 text-cyan-400" />
          {custom ? "Examen sur-mesure" : kind === "style" ? "Examen au style de référence" : "Examen standard"}
        </p>
        {custom ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm text-foreground">
              {EXAM_PREFERENCE_LABELS.difficulty[preferences.difficulty]}&nbsp;· {EXAM_PREFERENCE_LABELS.questionFocus[preferences.questionFocus]}&nbsp;·{" "}
              {EXPLANATIONS_SUMMARY[preferences.explanationDepth]}
            </p>
            <p className="text-xs text-muted-foreground">Généré de zéro pour toi (≈&nbsp;30–40&nbsp;s)&nbsp;— il ne puise pas dans la banque partagée.</p>
            <button
              type="button"
              onClick={() => onPreferencesChange(DEFAULT_EXAM_PREFERENCES)}
              className="inline-flex min-h-9 items-center gap-1.5 text-xs font-bold text-cyan-300 underline-offset-4 hover:underline"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Revenir à l&apos;examen standard
            </button>
          </div>
        ) : kind === "style" ? (
          // The professor's style drives this exam, not the standard profile's settings.
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              <TelemetryChip icon={Layers}>{styleArchetypeLabel ? `Style « ${styleArchetypeLabel} »` : "Style de ton professeur"}</TelemetryChip>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
              Suit le style de l&apos;examen de référence&nbsp;; puise d&apos;abord dans la banque partagée de ce style, seules les questions manquantes sont générées.
            </p>
          </>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              <TelemetryChip icon={GraduationCap}>Examen facultaire</TelemetryChip>
              <TelemetryChip icon={Layers}>Équilibré&nbsp;· QCS, QCM, combinaisons</TelemetryChip>
              <TelemetryChip icon={MessageSquareText}>Correction approfondie</TelemetryChip>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
              Puise d&apos;abord dans la banque de questions partagée&nbsp;: instantané quand tes cours y sont déjà, seules les questions manquantes sont générées.
            </p>
          </>
        )}
      </div>

      <div className={row}>
        <p className={label}>
          <Clock3 className="h-3.5 w-3.5 text-cyan-400" />
          Minuteur
        </p>
        <SegmentedControl<ExamTimerMode>
          size="sm"
          ariaLabel="Mode du minuteur"
          value={timerMode}
          onChange={onTimerModeChange}
          options={[
            { value: "chrono", label: "Chronomètre", icon: Timer },
            { value: "countdown", label: "Conditions d'examen", icon: Hourglass },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">Affichage seulement&nbsp;: le minuteur ne change pas les questions.</p>
      </div>

      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        // Named group: inside the mobile « Réglages » <details> (itself a `group`), a plain `group-open` would follow the outer one.
        className="group/adv rounded-2xl border border-white/[0.08] bg-white/[0.02] [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-sm font-bold text-foreground">
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
            <span>
              Options avancées&nbsp;· <span className="whitespace-nowrap">Sur-mesure</span>
            </span>
            {custom && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-200">Actif</span>}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open/adv:rotate-90" />
        </summary>
        <div className="space-y-4 px-3.5 pb-3.5">
          <p className="text-xs text-muted-foreground">
            {hasStyleProfile
              ? "Avec un examen de référence, c'est le style de ton professeur qui s'applique : seuls les réglages que tu modifies ici s'y ajoutent, et l'examen est alors généré de zéro (≈ 30–40 s)."
              : "Modifier ces réglages crée un examen sur-mesure, généré de zéro (≈ 30–40 s). L'examen standard, lui, puise directement dans la banque de questions partagée."}
          </p>

          <div className={row}>
            <p className={label}>
              <Gauge className="h-3.5 w-3.5 text-cyan-400" />
              Difficulté
            </p>
            <SegmentedControl<ExamDifficulty>
              size="sm"
              ariaLabel="Difficulté"
              value={preferences.difficulty}
              onChange={(difficulty) => onPreferencesChange({ ...preferences, difficulty })}
              options={(["debutant", "intermediaire", "examen_blanc"] as const).map((value) => ({ value, label: EXAM_PREFERENCE_LABELS.difficulty[value] }))}
            />
          </div>

          <div className={row}>
            <p className={label}>
              <Stethoscope className="h-3.5 w-3.5 text-cyan-400" />
              Type de questions
            </p>
            <SegmentedControl<ExamQuestionFocus>
              size="sm"
              ariaLabel="Type de questions"
              value={preferences.questionFocus}
              onChange={(questionFocus) => onPreferencesChange({ ...preferences, questionFocus })}
              options={(["equilibre", "cas_cliniques", "connaissances"] as const).map((value) => ({ value, label: EXAM_PREFERENCE_LABELS.questionFocus[value] }))}
            />
          </div>

          <div className={row}>
            <p className={label}>
              <MessageSquareText className="h-3.5 w-3.5 text-cyan-400" />
              Explications
            </p>
            <SegmentedControl<ExamExplanationDepth>
              size="sm"
              ariaLabel="Profondeur des explications"
              value={preferences.explanationDepth}
              onChange={(explanationDepth) => onPreferencesChange({ ...preferences, explanationDepth })}
              options={(["concise", "standard", "approfondie"] as const).map((value) => ({ value, label: EXAM_PREFERENCE_LABELS.explanationDepth[value] }))}
            />
          </div>
        </div>
      </details>

      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
        <TelemetryChip icon={ListChecks}>
          {selectedCount} / {totalCourses} cours
        </TelemetryChip>
        <TelemetryChip icon={Stethoscope}>
          {MIN_QUESTIONS} à {MAX_QUESTIONS} QCM
        </TelemetryChip>
        <TelemetryChip icon={Hourglass}>
          ≈ {minutes(MIN_QUESTIONS)}–{minutes(MAX_QUESTIONS)} min
        </TelemetryChip>
        <TelemetryChip icon={Zap}>{examRunCaption(kind, styleArchetypeLabel)}</TelemetryChip>
      </div>
    </div>
  );
}
