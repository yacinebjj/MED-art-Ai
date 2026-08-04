"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ListChecks, CheckCircle2, XCircle, PenLine, GraduationCap, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GastriteQcmsData } from "@/lib/course-slug-content";
import { useToast } from "@/components/ui/Toast";

/* ----------------------------------------------------------------------- */
/* Data structure — identical shape to the appendicite ExamQcmStudio.tsx,   */
/* redefined locally so this file has zero dependency on it.               */
/* ----------------------------------------------------------------------- */

interface ExplicationQCM {
  globale: string;
  A: string;
  B: string;
  C: string;
  D: string;
  E: string;
}

interface QCM {
  id: number;
  question: string;
  options: { label: string; text: string }[];
  reponsesCorrectes: string[];
  explication: ExplicationQCM;
}

interface QROC {
  id: number;
  question: string;
  reponseOfficielle: string;
}

/* ----------------------------------------------------------------------- */
/* Spaced repetition hook: once a student reveals an answer, they self-     */
/* grade it — this is the only place in the app that writes to             */
/* `qcm_attempts`, which powers the Leitner scheduler (lib/srs.ts) and the  */
/* Weakness Radar (app/api/srs/weakness-radar). `qcmId` is prefixed by kind */
/* ("qcm-"/"qroc-") since the qcms[] and qrocs[] arrays each restart their   */
/* ids at 1 — without the prefix a QCM and a QROC sharing id=1 would        */
/* collide into the same qcm_attempts row.                                  */
/* ----------------------------------------------------------------------- */

function GradeButtons({
  grading,
  graded,
  onGrade,
}: {
  grading: boolean;
  graded: boolean | null;
  onGrade: (isCorrect: boolean) => void;
}) {
  if (graded !== null) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold",
          graded ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
        )}
      >
        {graded ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
        {graded ? "Réussi — programmé pour une prochaine révision" : "Raté — reprogrammé pour bientôt"}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="mr-1 text-xs text-slate-400 dark:text-slate-500">Sois honnête, ça t'aide à réviser :</span>
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

/* ----------------------------------------------------------------------- */
/* Interactive UI — identical shell to the appendicite ExamQcmStudio.tsx.   */
/* ----------------------------------------------------------------------- */

function QcmCard({
  qcm,
  revealed,
  onReveal,
  grading,
  graded,
  onGrade,
}: {
  qcm: QCM;
  revealed: boolean;
  onReveal: () => void;
  grading: boolean;
  graded: boolean | null;
  onGrade: (isCorrect: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 md:p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center font-black text-sm">{qcm.id}</span>
        <p className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">{qcm.question}</p>
      </div>

      <div className="space-y-2">
        {qcm.options.map((opt) => {
          const isCorrect = qcm.reponsesCorrectes.includes(opt.label);
          return (
            <div
              key={opt.label}
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors duration-300",
                !revealed && "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300",
                revealed &&
                  isCorrect &&
                  "border-emerald-500 bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-200",
                revealed &&
                  !isCorrect &&
                  "border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20 text-slate-500 dark:text-slate-500"
              )}
            >
              <span className="font-black shrink-0">{opt.label}.</span>
              <span className="flex-1">{opt.text}</span>
              {revealed && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
              {revealed && !isCorrect && <XCircle className="w-4 h-4 text-rose-300 dark:text-rose-800 shrink-0 mt-0.5" />}
            </div>
          );
        })}
      </div>

      {!revealed && (
        <button
          onClick={onReveal}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
        >
          Vérifier la réponse
        </button>
      )}

      {revealed && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-r-xl border-l-4 border-teal-500 bg-teal-50 dark:bg-teal-950/30 p-4 space-y-2"
        >
          <p className="text-sm font-bold text-teal-900 dark:text-teal-200 leading-relaxed">{qcm.explication.globale}</p>
          <ul className="space-y-1.5 text-sm text-teal-800 dark:text-teal-300 leading-relaxed">
            <li>
              <strong className="text-teal-900 dark:text-teal-100">A.</strong> {qcm.explication.A}
            </li>
            <li>
              <strong className="text-teal-900 dark:text-teal-100">B.</strong> {qcm.explication.B}
            </li>
            <li>
              <strong className="text-teal-900 dark:text-teal-100">C.</strong> {qcm.explication.C}
            </li>
            <li>
              <strong className="text-teal-900 dark:text-teal-100">D.</strong> {qcm.explication.D}
            </li>
            <li>
              <strong className="text-teal-900 dark:text-teal-100">E.</strong> {qcm.explication.E}
            </li>
          </ul>
          <div className="border-t border-teal-200 dark:border-teal-900/40 pt-3">
            <GradeButtons grading={grading} graded={graded} onGrade={onGrade} />
          </div>
        </motion.div>
      )}
    </div>
  );
}

function QrocCard({
  qroc,
  revealed,
  onReveal,
  grading,
  graded,
  onGrade,
}: {
  qroc: QROC;
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
        <p className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">{qroc.question}</p>
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

export function GastriteQcmsStudio({ data }: { data: GastriteQcmsData }) {
  const [revealedQcms, setRevealedQcms] = useState<Record<number, boolean>>({});
  const [revealedQrocs, setRevealedQrocs] = useState<Record<number, boolean>>({});
  const [gradedQcms, setGradedQcms] = useState<Record<number, boolean>>({});
  const [gradedQrocs, setGradedQrocs] = useState<Record<number, boolean>>({});
  const [gradingKey, setGradingKey] = useState<string | null>(null);
  const { toast } = useToast();

  async function recordAttempt(kind: "qcm" | "qroc", id: number, isCorrect: boolean) {
    const key = `${kind}-${id}`;
    setGradingKey(key);
    try {
      const res = await fetch("/api/srs/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseSlug: data.slug, qcmId: key, isCorrect }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Échec de l'enregistrement.");

      if (kind === "qcm") setGradedQcms((prev) => ({ ...prev, [id]: isCorrect }));
      else setGradedQrocs((prev) => ({ ...prev, [id]: isCorrect }));
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

  return (
    <div className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-700 to-cyan-900 dark:from-teal-950 dark:to-black p-8 shadow-xl border border-teal-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl text-white">
            <GraduationCap className="w-9 h-9" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              Niveau Faculté de Médecine — 4ème Année
            </span>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mt-2">{data.titre_section}</h1>
            <p className="text-sm text-teal-100 mt-1 max-w-2xl">
              {data.qcms.length} QCM et {data.qrocs.length} QROC à difficulté extrême — physiopathologie, histologie, complications évolutives, éradication et maladie de Biermer. Aucune complaisance.
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-teal-200 dark:border-teal-900/40 pb-2">
          <ListChecks className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-teal-700 dark:text-teal-400">Épreuve QCM ({data.qcms.length} questions)</h2>
        </div>
        <div className="space-y-4">
          {data.qcms.map((qcm) => (
            <QcmCard
              key={qcm.id}
              qcm={qcm}
              revealed={!!revealedQcms[qcm.id]}
              onReveal={() => setRevealedQcms((prev) => ({ ...prev, [qcm.id]: true }))}
              grading={gradingKey === `qcm-${qcm.id}`}
              graded={gradedQcms[qcm.id] ?? null}
              onGrade={(isCorrect) => recordAttempt("qcm", qcm.id, isCorrect)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-orange-200 dark:border-orange-900/40 pb-2">
          <PenLine className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-orange-700 dark:text-orange-400">Épreuve QROC ({data.qrocs.length} questions)</h2>
        </div>
        <div className="space-y-4">
          {data.qrocs.map((qroc) => (
            <QrocCard
              key={qroc.id}
              qroc={qroc}
              revealed={!!revealedQrocs[qroc.id]}
              onReveal={() => setRevealedQrocs((prev) => ({ ...prev, [qroc.id]: true }))}
              grading={gradingKey === `qroc-${qroc.id}`}
              graded={gradedQrocs[qroc.id] ?? null}
              onGrade={(isCorrect) => recordAttempt("qroc", qroc.id, isCorrect)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
