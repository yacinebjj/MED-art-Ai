"use client";

import { Clock3, Gauge, Hourglass, ListChecks, MessageSquareText, Stethoscope, Timer, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/cyber/primitives";
import { TelemetryChip } from "@/components/cyber/GenerationAura";
import {
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

/**
 * Pre-generation controls: difficulty, question focus, explanation depth
 * (real prompt directives server-side) and the timer mode (client clock),
 * with a telemetry strip of what the selection will produce.
 */
export function ExamConfigurator({
  preferences,
  onPreferencesChange,
  timerMode,
  onTimerModeChange,
  selectedCount,
  totalCourses,
  hasStyleProfile,
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
  disabled?: boolean;
  className?: string;
}) {
  const personalized = hasStyleProfile || !isDefaultExamPreferences(preferences);
  const row = "space-y-2";
  const label = "flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <div className={cn("space-y-4", disabled && "pointer-events-none opacity-60", className)}>
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
        <TelemetryChip icon={Zap}>{personalized ? "Personnalisé · généré sur mesure" : "Standard · basé sur tes cours"}</TelemetryChip>
      </div>
    </div>
  );
}
