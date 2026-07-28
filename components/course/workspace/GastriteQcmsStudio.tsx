"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ListChecks, CheckCircle2, XCircle, PenLine, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GastriteQcmsData } from "@/lib/course-slug-content";

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
/* Interactive UI — identical shell to the appendicite ExamQcmStudio.tsx.   */
/* ----------------------------------------------------------------------- */

function QcmCard({ qcm, revealed, onReveal }: { qcm: QCM; revealed: boolean; onReveal: () => void }) {
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
        </motion.div>
      )}
    </div>
  );
}

function QrocCard({ qroc, revealed, onReveal }: { qroc: QROC; revealed: boolean; onReveal: () => void }) {
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
        </motion.div>
      )}
    </div>
  );
}

export function GastriteQcmsStudio({ data }: { data: GastriteQcmsData }) {
  const [revealedQcms, setRevealedQcms] = useState<Record<number, boolean>>({});
  const [revealedQrocs, setRevealedQrocs] = useState<Record<number, boolean>>({});

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
            />
          ))}
        </div>
      </section>
    </div>
  );
}
