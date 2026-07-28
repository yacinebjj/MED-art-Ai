"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Stethoscope,
  Brain,
  Microscope,
  Syringe,
  Users,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveLucideIcon } from "@/lib/lucide-icon-lookup";
import type { GastriteCasCliniqueData, GastriteRawCase } from "@/lib/course-slug-content";

/* ----------------------------------------------------------------------- */
/* Shared Framer Motion variants — redefined locally, this file has no      */
/* dependency on CasCliniqueStudio.tsx or any other Studio component.       */
/* ----------------------------------------------------------------------- */

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const FADE_UP = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 16 } },
};

const SCALE_IN = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 120, damping: 15 } },
};

/* ----------------------------------------------------------------------- */
/* Data model — every case is data, not hand-written JSX.                   */
/* ----------------------------------------------------------------------- */

type Speaker = "patient" | "medecin" | "autre";

interface DialogueLine {
  speaker: Speaker;
  name: string;
  tone: string;
  text: ReactNode;
  pourquoi?: ReactNode;
}

interface ExamStep {
  action: ReactNode;
  pourquoi: ReactNode;
}

interface ParaclinicalItem {
  label: string;
  result: ReactNode;
  pourquoi: ReactNode;
}

interface DdxItem {
  maladie: string;
  raisonnement: ReactNode;
  pourquoi: ReactNode;
}

interface RxItem {
  ligne: ReactNode;
  pourquoi: ReactNode;
}

interface VitalItem {
  label: string;
  value: string;
  alert?: boolean;
}

type CaseColor = "emerald" | "amber" | "rose" | "cyan" | "indigo";

interface CaseData {
  id: string;
  numero: number;
  archetype: string;
  icon: LucideIcon;
  color: CaseColor;
  titre: string;
  scene: string;
  vitals: VitalItem[];
  acte1: DialogueLine[];
  acte2: ExamStep[];
  acte3: ParaclinicalItem[];
  acte4: { items: DdxItem[]; conclusion: ReactNode };
  acte5: { items: RxItem[]; surveillance: ReactNode };
}

/* ----------------------------------------------------------------------- */
/* Narrative building blocks.                                               */
/* ----------------------------------------------------------------------- */

function WhyBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1 rounded-r-lg border-l-4 border-indigo-400 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mb-1">🧠 {label}</p>
      <p className="text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">{children}</p>
    </div>
  );
}

function DialogueBubble({ speaker, name, tone, children }: { speaker: Speaker; name: string; tone: string; children: ReactNode }) {
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

function DialogueTurn({ line }: { line: DialogueLine }) {
  const isPatient = line.speaker === "patient";
  return (
    <div className="space-y-1">
      <DialogueBubble speaker={line.speaker} name={line.name} tone={line.tone}>
        {line.text}
      </DialogueBubble>
      {line.pourquoi && (
        <div className={cn("flex", isPatient ? "justify-start" : "justify-end")}>
          <div className="max-w-[88%] sm:max-w-[75%] w-full">
            <WhyBox label="Pourquoi cette question ?">{line.pourquoi}</WhyBox>
          </div>
        </div>
      )}
    </div>
  );
}

function ExamStepRow({ step }: { step: ExamStep }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-start rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10 p-3">
        <Stethoscope className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{step.action}</p>
      </div>
      <WhyBox label="Physiopathologie du signe">{step.pourquoi}</WhyBox>
    </div>
  );
}

function ParaclinicalRow({ item }: { item: ParaclinicalItem }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-start rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/40 dark:bg-purple-950/10 p-3">
        <Microscope className="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          <strong className="text-purple-700 dark:text-purple-400">{item.label} : </strong>
          {item.result}
        </p>
      </div>
      <WhyBox label="Analyse du Bilan">{item.pourquoi}</WhyBox>
    </div>
  );
}

function DdxRow({ item }: { item: DdxItem }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-start rounded-xl border-l-4 border-slate-400 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 p-3">
        <Brain className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <p className="text-sm italic text-slate-700 dark:text-slate-300 leading-relaxed">
          <strong className="not-italic text-slate-900 dark:text-white">{item.maladie} — </strong>
          {item.raisonnement}
        </p>
      </div>
      <WhyBox label="Le Piège à Éviter">{item.pourquoi}</WhyBox>
    </div>
  );
}

function RxRow({ item }: { item: RxItem }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-2 items-start rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/10 p-3">
        <Syringe className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{item.ligne}</p>
      </div>
      <WhyBox label="Justification Thérapeutique">{item.pourquoi}</WhyBox>
    </div>
  );
}

function Vital({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-center",
        alert
          ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      )}
    >
      <div className={cn("text-[10px] font-bold uppercase tracking-wide", alert ? "text-rose-600 dark:text-rose-400" : "text-slate-400 dark:text-slate-500")}>
        {label}
      </div>
      <div className={cn("text-sm font-black", alert ? "text-rose-700 dark:text-rose-300" : "text-slate-800 dark:text-slate-200")}>{value}</div>
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
  icon: LucideIcon;
  color: ActeColor;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-center gap-3">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", ACTE_COLOR_CHIP[color])}>
            <Icon className="w-4 h-4" />
          </div>
          <h4 className="text-base md:text-lg font-black text-slate-900 dark:text-white">{title}</h4>
        </div>
        <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform duration-300 shrink-0", open && "rotate-180")} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

const CASE_HERO_STYLE: Record<CaseColor, string> = {
  emerald: "from-emerald-600 to-teal-700 dark:from-emerald-900 dark:to-teal-950 border-emerald-400/30",
  amber: "from-amber-500 to-orange-600 dark:from-amber-900 dark:to-orange-950 border-amber-400/30",
  rose: "from-rose-700 to-red-900 dark:from-rose-950 dark:to-black border-rose-500/40",
  cyan: "from-cyan-600 to-blue-800 dark:from-cyan-950 dark:to-blue-950 border-cyan-400/30",
  indigo: "from-indigo-600 to-purple-800 dark:from-indigo-950 dark:to-purple-950 border-indigo-400/30",
};

const CASE_PILL_STYLE: Record<CaseColor, { active: string; idle: string }> = {
  emerald: {
    active: "border-emerald-600 bg-emerald-600 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  amber: {
    active: "border-amber-500 bg-amber-500 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  rose: {
    active: "border-rose-600 bg-rose-600 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  cyan: {
    active: "border-cyan-600 bg-cyan-600 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
  indigo: {
    active: "border-indigo-600 bg-indigo-600 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
};

function CaseView({ data }: { data: CaseData }) {
  const Icon = data.icon;
  return (
    <motion.div variants={STAGGER_CONTAINER} initial="hidden" animate="visible" className="space-y-6">
      <motion.div variants={SCALE_IN} className={cn("relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 shadow-xl border", CASE_HERO_STYLE[data.color])}>
        <div className="absolute top-0 right-0 -mt-14 -mr-14 w-56 h-56 bg-white/10 blur-[70px] rounded-full pointer-events-none" />
        <span className="relative z-10 flex items-center gap-1.5 w-fit px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
          <Icon className="w-3 h-3" /> Cas {data.numero} — {data.archetype}
        </span>
        <h2 className="relative z-10 text-2xl md:text-3xl font-black text-white mt-2">{data.titre}</h2>
        <p className="relative z-10 text-sm text-white/90 mt-1">{data.scene}</p>
      </motion.div>

      <motion.div variants={FADE_UP} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {data.vitals.map((v) => (
          <Vital key={v.label} label={v.label} value={v.value} alert={v.alert} />
        ))}
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 1 — L'Interrogatoire" icon={Users} color="slate" defaultOpen>
          <div className="space-y-3">
            {data.acte1.map((line, i) => (
              <DialogueTurn key={i} line={line} />
            ))}
          </div>
        </Accordion>
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 2 — L'Examen Physique" icon={Stethoscope} color="amber">
          <div className="space-y-3">
            {data.acte2.map((step, i) => (
              <ExamStepRow key={i} step={step} />
            ))}
          </div>
        </Accordion>
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 3 — Les Examens Complémentaires" icon={Microscope} color="purple">
          <div className="space-y-3">
            {data.acte3.map((item, i) => (
              <ParaclinicalRow key={i} item={item} />
            ))}
          </div>
        </Accordion>
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 4 — Raisonnement Clinique & Diagnostics Différentiels" icon={Brain} color="indigo">
          <div className="space-y-3">
            {data.acte4.items.map((item, i) => (
              <DdxRow key={i} item={item} />
            ))}
          </div>
          <div className="rounded-xl border-2 border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 p-3">
            <p className="text-sm font-bold text-indigo-900 dark:text-indigo-200">{data.acte4.conclusion}</p>
          </div>
        </Accordion>
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 5 — La Prise en Charge" icon={Syringe} color="emerald">
          <div className="space-y-3">
            {data.acte5.items.map((item, i) => (
              <RxRow key={i} item={item} />
            ))}
          </div>
          <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-3">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">Surveillance</p>
            <p className="text-sm text-emerald-900 dark:text-emerald-200">{data.acte5.surveillance}</p>
          </div>
        </Accordion>
      </motion.div>
    </motion.div>
  );
}

/* =========================================================================
   LES 4 CAS — chaque grand cadre étiologique de la gastrite, de la forme
   toxique aiguë jusqu'aux deux archétypes de population particulière.
   ========================================================================= */

/* ----------------------------------------------------------------------- */
/* Adapter — maps the raw Supabase JSON shape (icon as string, verbose       */
/* acteN_xxx field names) onto the CaseData shape CaseView already expects. */
/* ----------------------------------------------------------------------- */

const VALID_CASE_COLORS: CaseColor[] = ["emerald", "amber", "rose", "cyan", "indigo"];

/** Falls back to "indigo" for any AI-generated color outside the 5 this component actually styles — never crash the page over a stray "orange" or "teal". */
function resolveCaseColor(color: string): CaseColor {
  return (VALID_CASE_COLORS as string[]).includes(color) ? (color as CaseColor) : "indigo";
}

function mapRawCase(raw: GastriteRawCase): CaseData {
  return {
    id: raw.id,
    numero: raw.numero,
    archetype: raw.archetype,
    icon: resolveLucideIcon(raw.icon),
    color: resolveCaseColor(raw.color),
    titre: raw.titre,
    scene: raw.scene,
    vitals: raw.vitals,
    acte1: raw.acte1_interrogatoire,
    acte2: raw.acte2_examen_physique,
    acte3: raw.acte3_examens_complementaires,
    acte4: raw.acte4_raisonnement,
    acte5: raw.acte5_prise_en_charge,
  };
}

/* ----------------------------------------------------------------------- */
/* Shell — case selector pills + dispatch. Fully standalone.                */
/* ----------------------------------------------------------------------- */

export function GastriteCasCliniqueStudio({ data }: { data: GastriteCasCliniqueData }) {
  const cases = data.cases.map(mapRawCase);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeCase = cases[activeIndex];

  return (
    <div className="w-full mx-auto space-y-6 font-sans text-slate-800 dark:text-slate-200 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <Stethoscope className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{data.titre_section}</h2>
        </div>
        {cases.map((c, i) => {
          const isActive = i === activeIndex;
          const pillStyle = CASE_PILL_STYLE[c.color];
          return (
            <button
              key={c.id}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all duration-200",
                isActive ? pillStyle.active : pillStyle.idle
              )}
            >
              Cas {c.numero} — {c.archetype}
            </button>
          );
        })}
      </div>

      <CaseView key={activeCase.id} data={activeCase} />
    </div>
  );
}
