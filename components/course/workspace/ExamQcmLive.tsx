"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ListChecks, PenLine, RefreshCw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { QCM_BATCHES, QROC_SUB_UNIT_ID } from "@/lib/sub-units";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import type { QcmItem, QrocItem } from "@/lib/types";

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

type BatchState =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "ready"; items: QcmItem[] };

type QrocState =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "ready"; items: QrocItem[] };

function QcmSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800/60" />
      <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800/60" />
      <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800/60" />
    </div>
  );
}

function QcmCard({ qcm, revealed, onReveal }: { qcm: QcmItem; revealed: boolean; onReveal: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 md:p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-sm">
          {qcm.id}
        </span>
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

      {!revealed ? (
        <button
          onClick={onReveal}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
        >
          Vérifier la réponse
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-r-xl border-l-4 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 p-4 space-y-2"
        >
          <p className="text-sm font-bold text-indigo-900 dark:text-indigo-200 leading-relaxed">{qcm.explication.globale}</p>
          <ul className="space-y-1.5 text-sm text-indigo-800 dark:text-indigo-300 leading-relaxed">
            {(["A", "B", "C", "D", "E"] as const).map((letter) => (
              <li key={letter}>
                <strong className="text-indigo-900 dark:text-indigo-100">{letter}.</strong> {qcm.explication[letter]}
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </div>
  );
}

function QrocCard({ qroc, revealed, onReveal }: { qroc: QrocItem; revealed: boolean; onReveal: () => void }) {
  return (
    <div className="rounded-2xl border border-purple-200 dark:border-purple-900/40 bg-white dark:bg-slate-900 p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-black text-sm">
          {qroc.id}
        </span>
        <p className="text-sm md:text-base font-semibold text-slate-800 dark:text-slate-100 leading-relaxed pt-0.5">{qroc.question}</p>
      </div>
      {!revealed ? (
        <button
          onClick={onReveal}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold shadow-sm transition-colors duration-200"
        >
          Voir le corrigé (Mots-clés)
        </button>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border-2 border-dashed border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20 p-4"
        >
          <p className="text-[10px] font-black uppercase tracking-wide text-purple-600 dark:text-purple-400 mb-1.5">Barème — Mots-clés attendus</p>
          <p className="text-sm font-medium text-purple-900 dark:text-purple-200 leading-relaxed">{qroc.reponseOfficielle}</p>
        </motion.div>
      )}
    </div>
  );
}

/**
 * Live version of the "Examen QCMs" tab: opens the NDJSON stream once on
 * mount, and renders each QCM batch (and the QROC set) the moment its own
 * line arrives, while the remaining batches show skeleton placeholders.
 */
export function ExamQcmLive({ courseId }: { courseId: string }) {
  const [batches, setBatches] = useState<Record<string, BatchState>>({});
  const [qroc, setQroc] = useState<QrocState>({ status: "pending" });
  const [revealedQcms, setRevealedQcms] = useState<Record<number, boolean>>({});
  const [revealedQrocs, setRevealedQrocs] = useState<Record<number, boolean>>({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStreamError(null);
    setBatches(Object.fromEntries(QCM_BATCHES.map((b) => [b.subUnitId, { status: "pending" as const }])));
    setQroc({ status: "pending" });

    async function run() {
      try {
        const res = await fetch(`/api/courses/${courseId}/generate-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: "qcm" }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "La génération a échoué.");
        }

        await readNdjsonStream(res, (line) => {
          if (cancelled) return;
          const { subUnitId, data, error } = line as { subUnitId: string; data: unknown; error: string | null };

          if (subUnitId === QROC_SUB_UNIT_ID) {
            setQroc(error ? { status: "error", message: error } : { status: "ready", items: data as QrocItem[] });
          } else {
            setBatches((prev) => ({
              ...prev,
              [subUnitId]: error ? { status: "error", message: error } : { status: "ready", items: data as QcmItem[] },
            }));
          }
        });
      } catch (error) {
        if (!cancelled) {
          setStreamError(error instanceof Error ? error.message : "Impossible de contacter le serveur.");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [courseId, attempt]);

  if (streamError) {
    return (
      <div className="rounded-2xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {streamError}
        </div>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Réessayer
        </button>
      </div>
    );
  }

  return (
    <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-indigo-200 dark:border-indigo-900/40 pb-2">
          <ListChecks className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-400">Épreuve QCM</h2>
        </div>
        <div className="space-y-4">
          {QCM_BATCHES.map((b) => {
            const batch = batches[b.subUnitId] ?? { status: "pending" as const };
            if (batch.status === "pending") {
              return (
                <div key={b.subUnitId} className="space-y-4">
                  <QcmSkeleton />
                  <QcmSkeleton />
                </div>
              );
            }
            if (batch.status === "error") {
              return (
                <div
                  key={b.subUnitId}
                  className="rounded-2xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-5 text-sm text-rose-800 dark:text-rose-300"
                >
                  {batch.message}
                </div>
              );
            }
            return (
              <div key={b.subUnitId} className="space-y-4">
                {batch.items.map((qcm) => (
                  <QcmCard
                    key={qcm.id}
                    qcm={qcm}
                    revealed={!!revealedQcms[qcm.id]}
                    onReveal={() => setRevealedQcms((prev) => ({ ...prev, [qcm.id]: true }))}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b-2 border-purple-200 dark:border-purple-900/40 pb-2">
          <PenLine className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <h2 className="text-lg font-black uppercase tracking-wide text-purple-700 dark:text-purple-400">Épreuve QROC</h2>
        </div>
        {qroc.status === "pending" && (
          <div className="space-y-4">
            <QcmSkeleton />
            <QcmSkeleton />
          </div>
        )}
        {qroc.status === "error" && (
          <div className="rounded-2xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-5 text-sm text-rose-800 dark:text-rose-300">
            {qroc.message}
          </div>
        )}
        {qroc.status === "ready" && (
          <div className="space-y-4">
            {qroc.items.map((item) => (
              <QrocCard
                key={item.id}
                qroc={item}
                revealed={!!revealedQrocs[item.id]}
                onReveal={() => setRevealedQrocs((prev) => ({ ...prev, [item.id]: true }))}
              />
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}
