"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  ListChecks,
  PenLine,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Trophy,
  Square,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

/**
 * Shared interactive quiz engine — used by both GastriteQcmsStudio.tsx (the
 * generic, AI-generated pipeline) and ExamQcmStudio.tsx (the hardcoded
 * Appendicite legacy demo), which previously each hand-rolled an
 * near-identical, non-interactive "reveal the answer key" UI. This is a real
 * click-to-answer quiz: locking on submit, red/green per-option feedback,
 * live score tracking, and an end-of-quiz summary out of /20 — see the
 * multi-answer note on QcmCard below for why single- and multi-answer
 * questions need two different interaction models, not one simplified for
 * both.
 */

export interface ExplicationQCM {
  globale: string;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
}

export interface QcmOption {
  label: string;
  text: string;
}

export interface Qcm {
  id: number;
  question: string;
  options: QcmOption[];
  reponsesCorrectes: string[];
  explication: ExplicationQCM;
}

export interface Qroc {
  id: number;
  question: string;
  reponseOfficielle: string;
}

/** One QCM's answer state — deliberately shaped so a future "submit the whole session" endpoint could just serialize Object.values(this) per quiz; no such endpoint exists yet (out of scope for now). */
interface QcmAnswerState {
  selected: string[];
  isCorrect: boolean;
}

const EXPLICATION_LETTERS: (keyof ExplicationQCM)[] = ["A", "B", "C", "D", "E"];

/** True set-equality, order-independent — a multi-answer QCM is correct only if the student picked EXACTLY the right set, matching how these are graded on a real exam (no partial credit). */
function isExactMatch(selected: string[], correct: string[]): boolean {
  if (selected.length !== correct.length) return false;
  const correctSet = new Set(correct);
  return selected.every((label) => correctSet.has(label));
}

/**
 * One option's visual state, computed the same way for both interaction
 * modes: once answered, the true correct option(s) always light up green
 * (so a wrong guess still shows what the right answer was); a WRONG option
 * the student actually picked lights up red; a wrong option they didn't
 * pick stays muted — never a lie about what "wrong" means.
 */
function optionClasses(label: string, answered: boolean, selected: string[], correct: string[]) {
  const isCorrectOption = correct.includes(label);
  const wasSelected = selected.includes(label);

  if (!answered) {
    return "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300";
  }
  if (isCorrectOption) {
    return "border-emerald-500 bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200";
  }
  if (wasSelected) {
    return "border-rose-500 bg-rose-100 dark:border-rose-600 dark:bg-rose-900/30 text-rose-900 dark:text-rose-200";
  }
  return "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40 text-slate-400 dark:text-slate-600";
}

function ExplicationBlock({ qcm }: { qcm: Qcm }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      dir="auto"
      className="rounded-r-xl border-l-4 border-teal-500 bg-teal-50 dark:bg-teal-950/30 p-4 space-y-2"
    >
      <p className="text-sm font-bold text-teal-900 dark:text-teal-200 leading-relaxed">{qcm.explication.globale}</p>
      <ul className="space-y-1.5 text-sm text-teal-800 dark:text-teal-300 leading-relaxed">
        {EXPLICATION_LETTERS.filter((letter) => qcm.options.some((opt) => opt.label === letter)).map((letter) => (
          <li key={letter}>
            <strong className="text-teal-900 dark:text-teal-100">{letter}.</strong> {qcm.explication[letter]}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

/**
 * A single QCM. Two interaction models depending on `reponsesCorrectes.length`:
 *  - Single answer: each option IS the submit action — click = answer,
 *    locks immediately (matches the spec's "au clic, verrouillage").
 *  - Multiple correct answers: options become checkboxes (toggle freely
 *    until submit), plus an explicit "Valider" button — a real QCM with
 *    several correct answers can't be graded off a single click without
 *    losing the actual skill being tested (picking ALL correct options).
 */
function QcmCard({ qcm, answer, onAnswer }: { qcm: Qcm; answer: QcmAnswerState | undefined; onAnswer: (selected: string[]) => void }) {
  const [pending, setPending] = useState<string[]>([]);
  const isMultiAnswer = qcm.reponsesCorrectes.length > 1;
  const answered = answer !== undefined;
  const selected = answer?.selected ?? pending;

  function toggleChoice(label: string) {
    setPending((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 md:p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center font-black text-sm">{qcm.id}</span>
        <p dir="auto" className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">
          {qcm.question}
        </p>
      </div>

      {isMultiAnswer && !answered && (
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Plusieurs réponses sont correctes — coche-les toutes, puis valide.</p>
      )}

      <div className="space-y-2">
        {qcm.options.map((opt) => {
          const classes = optionClasses(opt.label, answered, selected, qcm.reponsesCorrectes);
          const isCorrectOption = qcm.reponsesCorrectes.includes(opt.label);
          const wasSelected = selected.includes(opt.label);

          if (isMultiAnswer) {
            return (
              <button
                key={opt.label}
                type="button"
                dir="auto"
                disabled={answered}
                onClick={() => toggleChoice(opt.label)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-sm text-left transition-colors duration-300 disabled:cursor-not-allowed",
                  classes,
                  !answered && wasSelected && "border-teal-400 bg-teal-50 dark:border-teal-700 dark:bg-teal-950/30"
                )}
              >
                {!answered && (wasSelected ? <CheckSquare className="h-4 w-4 shrink-0 mt-0.5 text-teal-600 dark:text-teal-400" /> : <Square className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />)}
                <span className="font-black shrink-0">{opt.label}.</span>
                <span className="flex-1">{opt.text}</span>
                {answered && isCorrectOption && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
                {answered && !isCorrectOption && wasSelected && <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
              </button>
            );
          }

          return (
            <button
              key={opt.label}
              type="button"
              dir="auto"
              disabled={answered}
              onClick={() => onAnswer([opt.label])}
              className={cn(
                "flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-sm text-left transition-colors duration-300 disabled:cursor-not-allowed",
                classes
              )}
            >
              <span className="font-black shrink-0">{opt.label}.</span>
              <span className="flex-1">{opt.text}</span>
              {answered && isCorrectOption && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
              {answered && !isCorrectOption && wasSelected && <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>

      {isMultiAnswer && !answered && (
        <button
          type="button"
          disabled={pending.length === 0}
          onClick={() => onAnswer(pending)}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold shadow-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Valider mes réponses
        </button>
      )}

      <AnimatePresence>{answered && <ExplicationBlock qcm={qcm} />}</AnimatePresence>
    </div>
  );
}

/** Self-graded, since a free-text answer has no clickable "correct option" to detect automatically — identical mechanic to before. */
function GradeButtons({ grading, graded, onGrade }: { grading: boolean; graded: boolean | null; onGrade: (isCorrect: boolean) => void }) {
  if (graded !== null) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs font-semibold", graded ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
        {graded ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
        {graded ? "Réussi — programmé pour une prochaine révision" : "Raté — reprogrammé pour bientôt"}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="mr-1 text-xs text-slate-400 dark:text-slate-500">Sois honnête, ça t&apos;aide à réviser :</span>
      <button
        type="button"
        onClick={() => onGrade(true)}
        disabled={grading}
        className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
      >
        {grading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />}
        J&apos;ai réussi
      </button>
      <button
        type="button"
        onClick={() => onGrade(false)}
        disabled={grading}
        className="flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
      >
        {grading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsDown className="h-3.5 w-3.5" />}
        J&apos;ai raté
      </button>
    </div>
  );
}

function QrocCard({ qroc, revealed, onReveal, grading, graded, onGrade }: {
  qroc: Qroc;
  revealed: boolean;
  onReveal: () => void;
  grading: boolean;
  graded: boolean | null;
  onGrade: (isCorrect: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-orange-200 dark:border-orange-900/40 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-orange-600 text-white flex items-center justify-center font-black text-sm">{qroc.id}</span>
        <p dir="auto" className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">
          {qroc.question}
        </p>
      </div>

      {!revealed ? (
        <button
          onClick={onReveal}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
        >
          Voir le corrigé (Mots-clés)
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          dir="auto"
          className="rounded-xl border-2 border-dashed border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 p-4"
        >
          <p className="text-[10px] font-black uppercase tracking-wide text-orange-600 dark:text-orange-400 mb-1.5">Barème — Mots-clés attendus</p>
          <p className="text-sm font-medium text-orange-900 dark:text-orange-200 leading-relaxed">{qroc.reponseOfficielle}</p>
          <div className="mt-3 border-t border-orange-200 dark:border-orange-900/40 pt-3">
            <GradeButtons grading={grading} graded={graded} onGrade={onGrade} />
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** Score message tiers — thresholds match the user's own spec (>16 excellent, <10 needs review). */
function scoreMessage(score20: number): { emoji: string; text: string } {
  if (score20 >= 16) return { emoji: "🏆", text: "Excellent futur médecin ! Ce cours est maîtrisé." };
  if (score20 >= 10) return { emoji: "👍", text: "Pas mal ! Quelques révisions cibleraient tes points faibles." };
  return { emoji: "📚", text: "Il faut réviser ce cours avant l'examen !" };
}

function EndScreen({ score20, correctCount, total }: { score20: number; correctCount: number; total: number }) {
  const { emoji, text } = scoreMessage(score20);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="rounded-3xl border-2 border-teal-300 dark:border-teal-800 bg-gradient-to-br from-teal-50 to-emerald-50 dark:from-teal-950/40 dark:to-emerald-950/20 p-8 text-center space-y-3"
    >
      <Trophy className="mx-auto h-10 w-10 text-teal-600 dark:text-teal-400" />
      <p className="text-4xl font-black text-teal-800 dark:text-teal-200">
        {score20.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/20
      </p>
      <p className="text-sm text-teal-700 dark:text-teal-300">
        {correctCount} bonne{correctCount === 1 ? "" : "s"} réponse{correctCount === 1 ? "" : "s"} sur {total} QCM
      </p>
      <p className="text-base font-bold text-slate-700 dark:text-slate-200">
        {emoji} {text}
      </p>
    </motion.div>
  );
}

export function InteractiveQuiz({ qcms, qrocs, courseSlug }: { qcms: Qcm[]; qrocs: Qroc[]; courseSlug: string }) {
  const [qcmAnswers, setQcmAnswers] = useState<Record<number, QcmAnswerState>>({});
  const [revealedQrocs, setRevealedQrocs] = useState<Record<number, boolean>>({});
  const [gradedQrocs, setGradedQrocs] = useState<Record<number, boolean>>({});
  const [gradingKey, setGradingKey] = useState<string | null>(null);
  const { toast } = useToast();

  /** Fire-and-forget SRS write — a failed write never blocks the student from seeing their own result, it only means their Weakness Radar won't reflect this attempt. */
  async function recordAttempt(qcmId: string, isCorrect: boolean) {
    setGradingKey(qcmId);
    try {
      const res = await fetch("/api/srs/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSlug, qcmId, isCorrect }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Échec de l'enregistrement.");
    } catch (error) {
      toast({
        variant: "error",
        title: "Suivi de révision indisponible",
        description: error instanceof Error ? error.message : "Connecte-toi pour suivre ta progression.",
      });
    } finally {
      setGradingKey(null);
    }
  }

  function handleAnswer(qcm: Qcm, selected: string[]) {
    const isCorrect = isExactMatch(selected, qcm.reponsesCorrectes);
    setQcmAnswers((prev) => ({ ...prev, [qcm.id]: { selected, isCorrect } }));
    recordAttempt(`qcm-${qcm.id}`, isCorrect);
  }

  async function recordQrocAttempt(id: number, isCorrect: boolean) {
    const key = `qroc-${id}`;
    setGradingKey(key);
    try {
      const res = await fetch("/api/srs/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSlug, qcmId: key, isCorrect }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Échec de l'enregistrement.");
      setGradedQrocs((prev) => ({ ...prev, [id]: isCorrect }));
    } catch (error) {
      toast({
        variant: "error",
        title: "Suivi de révision indisponible",
        description: error instanceof Error ? error.message : "Connecte-toi pour suivre ta progression.",
      });
    } finally {
      setGradingKey(null);
    }
  }

  const answeredCount = Object.keys(qcmAnswers).length;
  const correctCount = useMemo(() => Object.values(qcmAnswers).filter((a) => a.isCorrect).length, [qcmAnswers]);
  const allAnswered = qcms.length > 0 && answeredCount === qcms.length;
  const score20 = qcms.length > 0 ? Math.round((correctCount / qcms.length) * 20 * 10) / 10 : 0;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2 border-b-2 border-teal-200 dark:border-teal-900/40 pb-2">
          <div className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            <h2 className="text-lg font-black uppercase tracking-wide text-teal-700 dark:text-teal-400">Épreuve QCM ({qcms.length} questions)</h2>
          </div>
          {answeredCount > 0 && !allAnswered && (
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
              {answeredCount}/{qcms.length} répondues · {correctCount} correcte{correctCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {allAnswered && <EndScreen score20={score20} correctCount={correctCount} total={qcms.length} />}

        <div className="space-y-4">
          {qcms.map((qcm) => (
            <QcmCard key={qcm.id} qcm={qcm} answer={qcmAnswers[qcm.id]} onAnswer={(selected) => handleAnswer(qcm, selected)} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-orange-200 dark:border-orange-900/40 pb-2">
          <PenLine className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-orange-700 dark:text-orange-400">Épreuve QROC ({qrocs.length} questions)</h2>
        </div>
        <div className="space-y-4">
          {qrocs.map((qroc) => (
            <QrocCard
              key={qroc.id}
              qroc={qroc}
              revealed={!!revealedQrocs[qroc.id]}
              onReveal={() => setRevealedQrocs((prev) => ({ ...prev, [qroc.id]: true }))}
              grading={gradingKey === `qroc-${qroc.id}`}
              graded={gradedQrocs[qroc.id] ?? null}
              onGrade={(isCorrect) => recordQrocAttempt(qroc.id, isCorrect)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
