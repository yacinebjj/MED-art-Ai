"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { parseCombination, questionFormat, type ExamFormat, type ExamPolarity } from "@/lib/exam-formats";

/**
 * Display pieces for the three exam question formats (lib/exam-formats.ts):
 * the type badge a student reads before answering (one answer or several?),
 * the numbered propositions of a combination question, and its "1 + 3"
 * option chips. A question saved before the formats existed has no
 * `format`: it shows as a plain QCS, exactly as it did before.
 */

export interface ExamProposition {
  text: string;
  isTrue: boolean;
  explanation: string;
}

export interface ExamQuestionKind {
  format: ExamFormat;
  polarity: ExamPolarity | null;
  /** Several options can be ticked (QCM). */
  multiple: boolean;
  /** The five numbered propositions of a combination question — null otherwise, or when the saved data is malformed. */
  propositions: ExamProposition[] | null;
}

function isProposition(value: unknown): value is ExamProposition {
  if (!value || typeof value !== "object") return false;
  const { text, isTrue, explanation } = value as Record<string, unknown>;
  return typeof text === "string" && typeof isTrue === "boolean" && typeof explanation === "string";
}

export function getQuestionKind(question: { format?: unknown; polarity?: unknown; propositions?: unknown; options?: unknown }): ExamQuestionKind {
  const format = questionFormat(question);
  const polarity = question.polarity === "rj" || question.polarity === "rf" ? question.polarity : null;
  const propositions =
    format === "combinaison" && Array.isArray(question.propositions) && question.propositions.length === 5 && question.propositions.every(isProposition)
      ? (question.propositions as ExamProposition[])
      : null;
  return { format, polarity, multiple: format === "qcm", propositions };
}

const FORMAT_STYLES: Record<ExamFormat, string> = {
  qcs: "border-cyan-400/40 bg-cyan-400/10 text-cyan-700 dark:text-cyan-200",
  qcm: "border-violet-400/40 bg-violet-400/10 text-violet-700 dark:text-violet-200",
  combinaison: "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-200",
};

function formatLabel(kind: ExamQuestionKind): string {
  if (kind.format === "qcm") return "QCM - Choix multiples";
  if (kind.format === "combinaison") return "Combinaison";
  return kind.polarity ? `QCS - ${kind.polarity.toUpperCase()}` : "QCS";
}

/** "QCS - RJ", "QCS - RF", "QCM - Choix multiples" + RJ/RF, "Combinaison" + RJ/RF. */
export function ExamFormatBadges({ kind, className }: { kind: ExamQuestionKind; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <Badge variant="outline" className={cn("font-bold", FORMAT_STYLES[kind.format])}>
        {formatLabel(kind)}
      </Badge>
      {kind.format !== "qcs" && kind.polarity && (
        <Badge variant="outline" className="font-bold" title={kind.polarity === "rj" ? "Réponses justes" : "Réponses fausses"}>
          {kind.polarity.toUpperCase()}
        </Badge>
      )}
    </span>
  );
}

/** What the student must do, in one line — shown under the question while answering. */
export function examFormatHint(kind: ExamQuestionKind): string {
  const rf = kind.polarity === "rf";
  if (kind.format === "qcm") {
    if (!kind.polarity) return "Plusieurs réponses possibles : coche toutes celles qui conviennent.";
    return rf ? "Plusieurs réponses fausses : coche-les toutes." : "Plusieurs réponses justes : coche-les toutes.";
  }
  if (kind.format === "combinaison") {
    return rf
      ? "Une seule lettre : la combinaison qui réunit toutes les propositions fausses, et seulement elles."
      : "Une seule lettre : la combinaison qui réunit toutes les propositions justes, et seulement elles.";
  }
  if (!kind.polarity) return "Une seule réponse à cocher.";
  return rf ? "Une seule réponse fausse à cocher." : "Une seule réponse juste à cocher.";
}

/**
 * The numbered propositions (1–5) of a combination question. `reveal` (the
 * correction) adds whether each one is exact, and why.
 */
export function ExamPropositionsList({ propositions, reveal = false, className }: { propositions: ExamProposition[]; reveal?: boolean; className?: string }) {
  return (
    <ol className={cn("space-y-2", className)} aria-label="Propositions numérotées">
      {propositions.map((proposition, index) => (
        <li
          key={index}
          className={cn(
            "flex min-w-0 gap-3 rounded-xl border p-3 text-sm",
            reveal ? (proposition.isTrue ? "border-emerald-400/30 bg-emerald-500/[0.06]" : "border-rose-400/30 bg-rose-500/[0.06]") : "border-white/[0.08] bg-slate-950/40"
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-xs font-black text-amber-700 dark:text-amber-200">{index + 1}</span>
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
            <span className="text-slate-100">{proposition.text}</span>
            {reveal && (
              <span className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-300">
                {proposition.isTrue ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                )}
                <span>
                  <span className="font-bold">{proposition.isTrue ? "Exacte" : "Inexacte"}</span> — {proposition.explanation}
                </span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "1+3" → (1 + 3) as number chips; any other text is shown as written. */
export function ExamCombinationText({ text }: { text: string }) {
  const numbers = parseCombination(text);
  if (!numbers) return <>{text}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" aria-label={`Propositions ${numbers.join(" et ")}`}>
      {numbers.map((number, index) => (
        <span key={number} className="inline-flex items-center gap-1">
          {index > 0 && <span className="text-xs font-bold text-slate-500">+</span>}
          <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 text-xs font-black text-amber-700 dark:text-amber-200">
            {number}
          </span>
        </span>
      ))}
    </span>
  );
}
