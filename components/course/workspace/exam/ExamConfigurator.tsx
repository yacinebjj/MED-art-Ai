"use client";

import { Clock3, GraduationCap, Hourglass, Layers, ListChecks, MessageSquareText, Stethoscope, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/cyber/primitives";
import { TelemetryChip } from "@/components/cyber/GenerationAura";
import { SECONDS_PER_QUESTION, type ExamTimerMode } from "./ExamTimer";

/** Exams are generated with 40 to 60 questions (enforced server-side). */
const MIN_QUESTIONS = 40;
const MAX_QUESTIONS = 60;

function minutes(questions: number): number {
  return Math.round((questions * SECONDS_PER_QUESTION) / 60);
}

/**
 * Pre-generation panel. Every exam is the standard one (Examen facultaire ·
 * Équilibré · Correction approfondie — lib/exam-preferences.ts, the only
 * profile the server generates) or follows the attached reference exam's
 * style: students have no generation settings. The one control is the timer,
 * display-only — it never changes the questions.
 */
export function ExamConfigurator({
  timerMode,
  onTimerModeChange,
  selectedCount,
  totalCourses,
  hasStyleProfile,
  styleArchetypeLabel,
  disabled,
  className,
}: {
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
  const label = "flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <div className={cn("space-y-4", disabled && "pointer-events-none opacity-60", className)}>
      <div className="rounded-2xl border border-cyan-400/25 bg-cyan-500/[0.06] p-4">
        <p className={label}>
          <GraduationCap className="h-3.5 w-3.5 text-cyan-400" />
          {hasStyleProfile ? "Examen au style de référence" : "Examen standard"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {hasStyleProfile ? (
            // The professor's style drives this exam, not the standard profile's settings.
            <TelemetryChip icon={Layers}>{styleArchetypeLabel ? `Style « ${styleArchetypeLabel} »` : "Style de ton professeur"}</TelemetryChip>
          ) : (
            <>
              <TelemetryChip icon={GraduationCap}>Examen facultaire</TelemetryChip>
              <TelemetryChip icon={Layers}>Équilibré&nbsp;· QCS, QCM, combinaisons</TelemetryChip>
              <TelemetryChip icon={MessageSquareText}>Correction approfondie</TelemetryChip>
            </>
          )}
        </div>
      </div>

      <div data-tour="exam-timer" className="space-y-2">
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
      </div>
    </div>
  );
}
