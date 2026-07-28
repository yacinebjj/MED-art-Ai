"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  Microscope,
  RefreshCw,
  Stethoscope,
  Syringe,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CAS_CLINIQUE_CASES } from "@/lib/sub-units";
import { readNdjsonStream } from "@/lib/ndjson-stream";
import type { ClinicalCase } from "@/lib/types";

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const FADE_UP = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 16 } },
};

type UnitState =
  | { status: "pending" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ClinicalCase };

/** Skeleton shown for a case whose generation is still in flight. */
function CaseSkeleton({ numero, archetype }: { numero: number; archetype: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-black text-slate-400 shrink-0">
          {numero}
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{archetype}</p>
          <div className="h-4 w-48 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
      <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800/60" />
      <div className="h-3 w-5/6 rounded bg-slate-100 dark:bg-slate-800/60" />
      <p className="text-xs text-slate-400 dark:text-slate-600">Génération en cours par l&apos;IA…</p>
    </div>
  );
}

function CaseErrorCard({ numero, archetype, message }: { numero: number; archetype: string; message: string }) {
  return (
    <div className="rounded-2xl border-2 border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-6 space-y-2">
      <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-black text-sm uppercase">
        <AlertTriangle className="w-4 h-4" /> Cas {numero} — {archetype}
      </div>
      <p className="text-sm text-rose-800 dark:text-rose-300">{message}</p>
    </div>
  );
}

function WhyBox({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-1 rounded-r-lg border-l-4 border-indigo-400 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mb-1">🧠 {label}</p>
      <p className="text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">{children}</p>
    </div>
  );
}

function DialogueBubble({
  speaker,
  name,
  tone,
  children,
}: {
  speaker: "patient" | "medecin" | "autre";
  name: string;
  tone: string;
  children: string;
}) {
  const isPatient = speaker === "patient";
  const isAutre = speaker === "autre";
  return (
    <div className={cn("flex", isPatient ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[88%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm",
          isPatient && "bg-blue-100 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 rounded-tl-sm",
          isAutre && "bg-rose-100 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 rounded-tr-sm",
          !isPatient && !isAutre && "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tr-sm"
        )}
      >
        <p className="text-[10px] font-black uppercase tracking-wide mb-1 opacity-70">
          {name} <span className="font-medium normal-case opacity-80">({tone})</span>
        </p>
        <p className="text-sm leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

type ActeColor = "slate" | "amber" | "purple" | "indigo" | "emerald";
const ACTE_COLOR_CHIP: Record<ActeColor, string> = {
  slate: "bg-slate-800 text-white",
  amber: "bg-amber-500 text-white",
  purple: "bg-purple-600 text-white",
  indigo: "bg-indigo-600 text-white",
  emerald: "bg-emerald-600 text-white",
};

function Accordion({
  title,
  icon: Icon,
  color,
  defaultOpen,
  children,
}: {
  title: string;
  icon: typeof Users;
  color: ActeColor;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", ACTE_COLOR_CHIP[color])}>
            <Icon className="w-4 h-4" />
          </div>
          <h4 className="text-base font-black text-slate-900 dark:text-white">{title}</h4>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform duration-300 shrink-0", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function CaseCard({ data }: { data: ClinicalCase }) {
  return (
    <motion.div variants={FADE_UP} className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 shadow-sm">
      <div className="space-y-1">
        <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-slate-800 dark:bg-slate-700 text-white rounded-full">
          Cas {data.numero} — {data.archetype}
        </span>
        <h3 className="text-lg font-black text-slate-900 dark:text-white">{data.titre}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">{data.scene}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {data.vitals.map((v) => (
          <div
            key={v.label}
            className={cn(
              "rounded-lg border px-3 py-2 text-center",
              v.alert
                ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30"
                : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40"
            )}
          >
            <div className={cn("text-[10px] font-bold uppercase", v.alert ? "text-rose-600 dark:text-rose-400" : "text-slate-400")}>
              {v.label}
            </div>
            <div className={cn("text-sm font-black", v.alert ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-200")}>
              {v.value}
            </div>
          </div>
        ))}
      </div>

      <Accordion title="Acte 1 — L'Interrogatoire" icon={Users} color="slate" defaultOpen>
        <div className="space-y-3">
          {data.acte1.map((line, i) => (
            <div key={i} className="space-y-1">
              <DialogueBubble speaker={line.speaker} name={line.name} tone={line.tone}>
                {line.text}
              </DialogueBubble>
              {line.pourquoi && (
                <div className={cn("flex", line.speaker === "patient" ? "justify-start" : "justify-end")}>
                  <div className="max-w-[88%] sm:max-w-[75%] w-full">
                    <WhyBox label="Pourquoi cette question ?">{line.pourquoi}</WhyBox>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion title="Acte 2 — L'Examen Clinique" icon={Stethoscope} color="amber">
        <div className="space-y-3">
          {data.acte2.map((step, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2 items-start rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10 p-3">
                <Stethoscope className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{step.action}</p>
              </div>
              <WhyBox label="Physiopathologie du signe">{step.pourquoi}</WhyBox>
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion title="Acte 3 — La Paraclinique" icon={Microscope} color="purple">
        <div className="space-y-3">
          {data.acte3.map((item, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2 items-start rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/10 p-3">
                <Microscope className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  <strong className="text-purple-700 dark:text-purple-400">{item.label} : </strong>
                  {item.result}
                </p>
              </div>
              <WhyBox label="Analyse du Bilan">{item.pourquoi}</WhyBox>
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion title="Acte 4 — Raisonnement & Diagnostics Différentiels" icon={Brain} color="indigo">
        <div className="space-y-3">
          {data.acte4.items.map((item, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2 items-start rounded-xl border-l-4 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 p-3">
                <Brain className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-sm italic text-slate-700 dark:text-slate-300 leading-relaxed">
                  <strong className="not-italic text-slate-900 dark:text-white">{item.maladie} — </strong>
                  {item.raisonnement}
                </p>
              </div>
              <WhyBox label="Le Piège à Éviter">{item.pourquoi}</WhyBox>
            </div>
          ))}
        </div>
        <div className="rounded-xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-3">
          <p className="text-sm font-bold text-indigo-900 dark:text-indigo-200">{data.acte4.conclusion}</p>
        </div>
      </Accordion>

      <Accordion title="Acte 5 — Le Traitement" icon={Syringe} color="emerald">
        <div className="space-y-3">
          {data.acte5.items.map((item, i) => (
            <div key={i} className="space-y-1">
              <div className="flex gap-2 items-start rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/10 p-3">
                <Syringe className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{item.ligne}</p>
              </div>
              <WhyBox label="Justification Thérapeutique">{item.pourquoi}</WhyBox>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">Surveillance</p>
          <p className="text-sm text-emerald-900 dark:text-emerald-200">{data.acte5.surveillance}</p>
        </div>
      </Accordion>
    </motion.div>
  );
}

/**
 * Live version of the "Cas Clinique" tab for the real (AI-backed) course
 * workspace: opens the NDJSON stream once on mount, and renders each of the
 * 5 cases the moment its own line arrives — the other slots stay as
 * skeletons in the meantime. See app/api/courses/[id]/generate-stream.
 */
export function CasCliniqueLive({ courseId }: { courseId: string }) {
  const [units, setUnits] = useState<Record<string, UnitState>>({});
  const [streamError, setStreamError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStreamError(null);
    setUnits(Object.fromEntries(CAS_CLINIQUE_CASES.map((c) => [c.subUnitId, { status: "pending" as const }])));

    async function run() {
      try {
        const res = await fetch(`/api/courses/${courseId}/generate-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: "cas_clinique" }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "La génération a échoué.");
        }

        await readNdjsonStream(res, (line) => {
          if (cancelled) return;
          const { subUnitId, data, error } = line as { subUnitId: string; data: unknown; error: string | null };
          setUnits((prev) => ({
            ...prev,
            [subUnitId]: error ? { status: "error", message: error } : { status: "ready", data: data as ClinicalCase },
          }));
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
    <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="space-y-6">
      {CAS_CLINIQUE_CASES.map((meta) => {
        const unit = units[meta.subUnitId] ?? { status: "pending" as const };
        if (unit.status === "pending") {
          return <CaseSkeleton key={meta.subUnitId} numero={meta.numero} archetype={meta.archetype} />;
        }
        if (unit.status === "error") {
          return (
            <CaseErrorCard key={meta.subUnitId} numero={meta.numero} archetype={meta.archetype} message={unit.message} />
          );
        }
        return <CaseCard key={meta.subUnitId} data={unit.data} />;
      })}
    </motion.div>
  );
}
