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
  Baby,
  Siren,
  CheckCircle2,
  AlertTriangle,
  HeartPulse,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------------- */
/* Shared Framer Motion variants — redefined locally, this file has no      */
/* dependency on ResumeStudio.tsx or any other Studio component.           */
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
/* Data model — every case is data, not hand-written JSX. This is what     */
/* makes "every single line has a Pourquoi" tractable across 5 huge cases. */
/* ----------------------------------------------------------------------- */

type Speaker = "patient" | "medecin" | "autre";

interface DialogueLine {
  speaker: Speaker;
  name: string;
  tone: string;
  text: ReactNode;
  /** Only médecin lines get one — a patient's raw quote doesn't need physiopathology, the doctor's question does. */
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

type CaseColor = "emerald" | "amber" | "rose" | "cyan" | "slate";

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

/** The single, unified "Pourquoi ?" nested annotation — same shape everywhere, only the label changes per acte. */
function WhyBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-1 rounded-r-lg border-l-4 border-indigo-400 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-indigo-700 dark:text-indigo-400 mb-1">🧠 {label}</p>
      <p className="text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">{children}</p>
    </div>
  );
}

/** One speech bubble — patient (left, blue), médecin (right, slate), autre (right, rose). */
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

/** Acte 1 row — a dialogue bubble, immediately followed (médecin lines only) by its "Pourquoi cette question ?" box. */
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

/** Acte 2 row — the physical action/sign, immediately followed by its physiopathology. */
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

/** Acte 3 row — one paraclinical result, immediately followed by its "Analyse du Bilan". */
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

/** Acte 4 row — one differential diagnosis, framed as the doctor's own reasoning, followed by "Le Piège à Éviter". */
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

/** Acte 5 row — one prescription line, immediately followed by its "Justification Thérapeutique". */
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

/** One numbered vital-sign chip — flags abnormal values in rose. */
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

/** One of the 5 fixed acte colors — literal Tailwind classes, keyed by acte identity (not by case). */
type ActeColor = "slate" | "amber" | "purple" | "indigo" | "emerald";

const ACTE_COLOR_CHIP: Record<ActeColor, string> = {
  slate: "bg-slate-800 text-white",
  amber: "bg-amber-500 text-white",
  purple: "bg-purple-600 text-white",
  indigo: "bg-indigo-600 text-white",
  emerald: "bg-emerald-600 text-white",
};

/** Collapsible wrapper for each Acte — keeps 5 massive sections per case from turning into an unreadable wall of text. */
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

/** Full-case hero gradient — one literal style set per CaseColor so Tailwind's scanner picks up every class. */
const CASE_HERO_STYLE: Record<CaseColor, string> = {
  emerald: "from-emerald-600 to-teal-700 dark:from-emerald-900 dark:to-teal-950 border-emerald-400/30",
  amber: "from-amber-500 to-orange-600 dark:from-amber-900 dark:to-orange-950 border-amber-400/30",
  rose: "from-rose-700 to-red-900 dark:from-rose-950 dark:to-black border-rose-500/40",
  cyan: "from-cyan-600 to-blue-800 dark:from-cyan-950 dark:to-blue-950 border-cyan-400/30",
  slate: "from-slate-700 to-slate-900 dark:from-slate-900 dark:to-black border-slate-400/40",
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
  slate: {
    active: "border-slate-700 bg-slate-700 text-white shadow-sm",
    idle: "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
};

/** Renders one full case: hero, vitals, then the 5 accordion actes. Everything below is pure data traversal. */
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
        <Accordion title="ACTE 2 — L'Examen Clinique" icon={Stethoscope} color="amber">
          <div className="space-y-3">
            {data.acte2.map((step, i) => (
              <ExamStepRow key={i} step={step} />
            ))}
          </div>
        </Accordion>
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 3 — La Paraclinique" icon={Microscope} color="purple">
          <div className="space-y-3">
            {data.acte3.map((item, i) => (
              <ParaclinicalRow key={i} item={item} />
            ))}
          </div>
        </Accordion>
      </motion.div>

      <motion.div variants={FADE_UP}>
        <Accordion title="ACTE 4 — Raisonnement & Diagnostics Différentiels" icon={Brain} color="indigo">
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
        <Accordion title="ACTE 5 — Le Traitement" icon={Syringe} color="emerald">
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
   THE 5 CASES — every probability of the pathology, from the school-book
   presentation to the two special-population archetypes.
   ========================================================================= */

const CASES: CaseData[] = [
  /* ----------------------------- CAS 1 — TYPIQUE ----------------------------- */
  {
    id: "typique",
    numero: 1,
    archetype: "La Forme Typique",
    icon: CheckCircle2,
    color: "emerald",
    titre: "Amine, 22 ans — Le cas d'école",
    scene: "Il est 17h30 aux urgences, un lundi de rentrée universitaire. Un jeune homme se présente, la main sur le ventre, plié en deux.",
    vitals: [
      { label: "TA", value: "124/76 mmHg" },
      { label: "FC", value: "94/min" },
      { label: "FR", value: "16/min" },
      { label: "SpO2", value: "99% AA" },
      { label: "Température", value: "38,1°C", alert: true },
      { label: "Dextro", value: "5,2 mmol/L" },
      { label: "EVA", value: "6/10" },
      { label: "Glasgow", value: "15/15" },
    ],
    acte1: [
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "calme",
        text: "Où est-ce que ça fait mal exactement, et est-ce que la douleur a changé de place depuis le début ?",
        pourquoi:
          "Je cherche la migration typique de la douleur : le péritoine viscéral, peu innervé, envoie d'abord un signal diffus et péri-ombilical (territoire de l'intestin moyen embryonnaire) ; une fois l'inflammation atteint le péritoine pariétal, richement innervé par les nerfs somatiques de la paroi, la douleur devient précise et se fixe en FID.",
      },
      {
        speaker: "patient",
        name: "Amine",
        tone: "anxieux",
        text: "Ça a commencé autour du nombril hier soir, et depuis ce matin ça s'est déplacé en bas à droite, ça fait vraiment mal maintenant.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "attentif",
        text: "Avez-vous eu de la fièvre, des nausées, et avez-vous encore faim ?",
        pourquoi:
          "L'anorexie est présente dans plus de 90% des appendicites — elle serait liée à une inhibition réflexe vagale du centre de la faim en réponse à l'inflammation viscérale. Son absence doit faire sérieusement reconsidérer le diagnostic.",
      },
      {
        speaker: "patient",
        name: "Amine",
        tone: "fatigué",
        text: "Oui, un peu de fièvre, et je n'ai plus faim du tout depuis hier soir. J'ai vomi une fois ce matin.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "précis",
        text: "Est-ce que la douleur augmente quand vous marchez, toussez, ou sautez ?",
        pourquoi:
          "Toute mise en tension du péritoine pariétal enflammé — par la marche, la toux ou un saut — reproduit une micro-décompression qui réveille la douleur. C'est un équivalent clinique du signe de Blumberg, obtenu sans même toucher le patient.",
      },
      {
        speaker: "patient",
        name: "Amine",
        tone: "grimaçant",
        text: "Oui docteur, même en toussant ça me fait mal, j'ai dû venir tout doucement.",
      },
    ],
    acte2: [
      {
        action: (
          <>
            Le médecin palpe doucement le point de McBurney puis relâche brusquement : <strong>douleur vive au relâchement</strong> (signe de Blumberg positif).
          </>
        ),
        pourquoi:
          "Le signe de Blumberg traduit une irritation péritonéale pariétale localisée : la décompression brutale étire le péritoine enflammé, ce qui déclenche une douleur vive — bien plus spécifique de l'inflammation péritonéale que la simple douleur à la palpation directe.",
      },
      {
        action: (
          <>
            Le médecin palpe la fosse iliaque gauche : la douleur apparaît en <strong>fosse iliaque droite</strong> (signe de Rovsing positif).
          </>
        ),
        pourquoi:
          "La pression exercée à gauche déplace gaz et anses intestinales vers la droite via le côlon transverse, mobilisant le péritoine du foyer inflammatoire situé en FID — la douleur controlatérale confirme l'origine péritonéale droite plutôt qu'une simple sensibilité pariétale locale.",
      },
      {
        action: <>Le médecin recherche le psoïtis par extension passive de la cuisse droite : négatif.</>,
        pourquoi:
          "Le psoïtis n'est positif que lorsque l'appendice est au contact direct du muscle psoas (position rétro-cæcale). Sa négativité ici est cohérente avec une position antérieure classique de l'appendice — elle n'élimine rien, elle oriente seulement la topographie.",
      },
    ],
    acte3: [
      {
        label: "NFS",
        result: <>GB à 13 800/mm³, PNN à 82% (hyperleucocytose à polynucléaires neutrophiles).</>,
        pourquoi:
          "L'obstruction de la lumière appendiculaire favorise une prolifération bactérienne locale ; l'organisme répond par une démargination des neutrophiles depuis le pool marginal vers la circulation, expliquant l'hyperleucocytose — un marqueur précoce mais non spécifique.",
      },
      {
        label: "CRP",
        result: <>38 mg/L.</>,
        pourquoi:
          "La CRP est synthétisée par le foie sous stimulation de l'IL-6, elle-même libérée par les macrophages activés au contact du foyer inflammatoire. Son élévation est plus tardive que celle des globules blancs (décalage de 6 à 12h), ce qui explique un dosage encore modérément élevé à ce stade précoce.",
      },
      {
        label: "β-hCG",
        result: <>non demandé — patient de sexe masculin.</>,
        pourquoi:
          "Cet examen n'a de valeur que pour éliminer une grossesse extra-utérine chez la femme en âge de procréer — il est simplement sans objet ici ; le demander serait un réflexe automatique mal placé plutôt qu'un raisonnement clinique.",
      },
      {
        label: "Échographie abdominale",
        result: <>appendice non compressible, diamètre 9mm, infiltration de la graisse péri-appendiculaire, pas d'épanchement.</>,
        pourquoi:
          "L'appendice normal est compressible et fin (< 6mm) ; l'inflammation le rigidifie et l'épaissit au-delà du seuil pathologique. Chez ce patient jeune et au tableau clinique net, l'échographie suffit : c'est le gold standard non irradiant en première intention.",
      },
    ],
    acte4: {
      items: [
        {
          maladie: "Gastro-entérite aiguë",
          raisonnement: <>« Nausées et fébricule pourraient évoquer une gastro-entérite... »</>,
          pourquoi:
            "Le piège serait de s'arrêter sur les nausées. Mais dans la gastro-entérite, la diarrhée précède ou accompagne la douleur, laquelle reste diffuse et ne se fixe jamais en un point précis — ici, la douleur a clairement migré et s'est localisée, ce qui élimine ce diagnostic.",
        },
        {
          maladie: "Colique néphrétique droite",
          raisonnement: <>« Une douleur en FID chez un homme jeune, il faut aussi y penser... »</>,
          pourquoi:
            "La colique néphrétique donne une douleur paroxystique irradiant vers les organes génitaux externes, avec un patient agité qui ne trouve aucune position antalgique. Amine, lui, reste immobile — signe quasi pathognomonique d'irritation péritonéale plutôt que de douleur viscérale pure.",
        },
      ],
      conclusion: "Diagnostic retenu : appendicite aiguë non compliquée, stade catarrhale à suppurée.",
    },
    acte5: {
      items: [
        {
          ligne: <>Mise à jeun strict, pose d'une VVP.</>,
          pourquoi: "Le jeûne prépare à l'anesthésie générale (risque d'inhalation) et anticipe la chirurgie imminente ; la VVP permet l'administration immédiate des traitements.",
        },
        {
          ligne: (
            <>
              Réhydratation : <strong>Ringer Lactate 500 mL IV</strong> en 30 minutes, puis entretien.
            </>
          ),
          pourquoi:
            "Le Ringer Lactate, cristalloïde isotonique proche du plasma, corrige les pertes hydriques liées à l'anorexie et aux vomissements sans surcharger en chlore, contrairement au sérum salé isotonique seul.",
        },
        {
          ligne: (
            <>
              Antibioprophylaxie unique pré-opératoire : <strong>Céfazoline 2g IV</strong> + <strong>Métronidazole 500mg IV</strong>, dans l'heure précédant l'incision.
            </>
          ),
          pourquoi:
            "La Céfazoline (céphalosporine de 1ère génération) couvre les entérobactéries aérobies, le Métronidazole couvre la flore anaérobie (Bacteroides fragilis) — cette association cible exactement l'écologie bactérienne colique. Dose unique car c'est une prophylaxie, non un traitement curatif.",
        },
        {
          ligne: <>Appendicectomie cœlioscopique en urgence différée (dans les 12h).</>,
          pourquoi:
            "La cœlioscopie permet une exploration complète de la cavité péritonéale, un diagnostic de certitude peropératoire, et une convalescence plus rapide qu'une laparotomie — la voie de référence en l'absence de contre-indication.",
        },
      ],
      surveillance: "Constantes toutes les 4h, reprise du transit, sortie envisagée à J1-J2 si suites simples.",
    },
  },

  /* ---------------------------- CAS 2 — ATYPIQUE ---------------------------- */
  {
    id: "atypique",
    numero: 2,
    archetype: "La Forme Atypique",
    icon: AlertTriangle,
    color: "amber",
    titre: "Sarah, 27 ans — Le piège rétro-cæcal",
    scene: "Il est 11h du matin, consultation de routine. Douleur évoluant depuis 36 heures, avec une composante lombaire qui égare déjà l'interrogatoire.",
    vitals: [
      { label: "TA", value: "118/72 mmHg" },
      { label: "FC", value: "88/min" },
      { label: "FR", value: "15/min" },
      { label: "SpO2", value: "99% AA" },
      { label: "Température", value: "37,8°C" },
      { label: "Dextro", value: "5,0 mmol/L" },
      { label: "EVA", value: "5/10" },
      { label: "Glasgow", value: "15/15" },
    ],
    acte1: [
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "attentif",
        text: "Où ressentez-vous la douleur, et est-ce qu'elle irradie quelque part ?",
        pourquoi:
          "Je cherche à localiser précisément le trajet douloureux : une composante lombaire associée à la FID doit immédiatement faire penser à une position rétro-cæcale de l'appendice, où le tableau antérieur classique peut être totalement trompeur.",
      },
      {
        speaker: "patient",
        name: "Sarah",
        tone: "perplexe",
        text: "J'ai mal en bas à droite, mais ça tire aussi dans le dos, c'est bizarre.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "orienté",
        text: "Est-ce que la douleur augmente si je vous demande de tendre la jambe droite vers l'arrière ?",
        pourquoi:
          "Cette manœuvre teste indirectement le psoïtis avant même l'examen physique formel — si l'appendice est au contact du muscle psoas, ce test oriente déjà mon geste d'examen vers la bonne hypothèse.",
      },
      {
        speaker: "patient",
        name: "Sarah",
        tone: "surprise",
        text: "Oui, un peu, quand je marche vite ça tire aussi là.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "systématique",
        text: "Quelle est la date de vos dernières règles, et pourriez-vous être enceinte ?",
        pourquoi:
          "Chez toute femme en âge de procréer avec une douleur pelvienne ou en FID, éliminer une grossesse extra-utérine est une question de sécurité absolue — un retard de règles imposerait un dosage de β-hCG en urgence avant tout autre geste.",
      },
      {
        speaker: "patient",
        name: "Sarah",
        tone: "posée",
        text: "Mes règles étaient normales il y a deux semaines, je ne pense pas être enceinte.",
      },
    ],
    acte2: [
      {
        action: <>Le médecin palpe la FID antérieure : abdomen étonnamment souple, défense quasi-absente.</>,
        pourquoi:
          "L'appendice rétro-cæcal est protégé du péritoine pariétal antérieur par le cæcum lui-même, qui fait littéralement écran — ce qui explique l'absence de défense malgré une inflammation bien réelle. Un abdomen souple n'élimine donc jamais une appendicite rétro-cæcale.",
      },
      {
        action: <>Le médecin réalise l'extension passive de la cuisse droite (manœuvre du psoas) : douleur vive.</>,
        pourquoi:
          "Le muscle psoas-iliaque, situé en arrière du cæcum, est directement au contact de l'appendice rétro-cæcal enflammé. Son étirement à l'extension comprime le foyer inflammatoire, provoquant la douleur — c'est le seul signal fiable dans cette topographie.",
      },
      {
        action: <>Toucher pelvien : sans particularité, pas de masse annexielle, pas de douleur à la mobilisation utérine.</>,
        pourquoi:
          "Ce geste élimine cliniquement une salpingite (douleur à la mobilisation utérine, bilatérale) et une torsion d'annexe (masse annexielle palpable) avant même le résultat des examens complémentaires.",
      },
    ],
    acte3: [
      {
        label: "β-hCG",
        result: <>négatif.</>,
        pourquoi:
          "Résultat obligatoire avant tout geste chirurgical chez une femme en âge de procréer — il élimine formellement une grossesse extra-utérine, diagnostic qui engagerait le pronostic vital et changerait radicalement la prise en charge.",
      },
      {
        label: "NFS",
        result: <>GB à 11 200/mm³ — seulement discrètement élevé.</>,
        pourquoi:
          "L'appendice rétro-cæcal, protégé par le cæcum, diffuse parfois moins vite son inflammation vers le péritoine général — la réponse leucocytaire peut donc être plus modérée que dans les formes antérieures typiques, un vrai piège de lecture biologique.",
      },
      {
        label: "CRP",
        result: <>62 mg/L, en nette hausse par rapport à un dosage fait 12h plus tôt à 30 mg/L.</>,
        pourquoi:
          "C'est la cinétique, pas la valeur absolue, qui est ici décisive : un doublement en 12h démontre une inflammation activement progressive, bien plus parlant qu'un chiffre isolé même élevé.",
      },
      {
        label: "Échographie",
        result: <>non concluante, appendice non visualisé.</>,
        pourquoi:
          "La position rétro-cæcale place l'appendice derrière le cæcum rempli de gaz, qui bloque la transmission des ultrasons — une limite technique connue de l'échographie, pas une preuve de normalité.",
      },
      {
        label: "TDM abdomino-pelvienne injectée",
        result: <>appendice rétro-cæcal de 11mm, infiltration de la graisse péri-appendiculaire.</>,
        pourquoi:
          "Contrairement à l'échographie, la TDM n'est pas gênée par l'interposition gazeuse et offre une résolution supérieure pour localiser un appendice atypique — elle devient l'examen de recours dès que l'échographie est mise en défaut, même chez une patiente jeune, car le bénéfice diagnostique dépasse ici le risque d'irradiation.",
      },
    ],
    acte4: {
      items: [
        {
          maladie: "Grossesse extra-utérine",
          raisonnement: <>« Douleur pelvienne chez une femme jeune, je dois absolument y penser en premier. »</>,
          pourquoi: "Éliminée formellement par le β-hCG négatif — un réflexe non négociable, à faire systématiquement avant toute autre hypothèse.",
        },
        {
          maladie: "Pyélonéphrite droite",
          raisonnement: <>« La composante lombaire pourrait faire penser au rein... »</>,
          pourquoi:
            "Éliminée par une bandelette urinaire négative et l'absence de contact lombaire net — la fièvre isolée et la douleur lombaire ne suffisent pas, il faut la confirmation biologique.",
        },
        {
          maladie: "Torsion d'annexe",
          raisonnement: <>« Une douleur pelvienne chez une femme jeune, la torsion doit être éliminée vite. »</>,
          pourquoi:
            "Jugée peu probable : douleur progressive sur 36h, non brutale ni syncopale, et l'échographie pelvienne complémentaire ne retrouve aucune masse annexielle ni asymétrie de flux Doppler.",
        },
      ],
      conclusion: "Diagnostic retenu : appendicite aiguë en position rétro-cæcale, confirmée par la TDM.",
    },
    acte5: {
      items: [
        {
          ligne: <>Hospitalisation, VVP, patiente à jeun.</>,
          pourquoi: "Préparation standard à un geste chirurgical en urgence différée.",
        },
        {
          ligne: (
            <>
              Antibioprophylaxie : <strong>Céfazoline 2g IV</strong> + <strong>Métronidazole 500mg IV</strong> en pré-opératoire.
            </>
          ),
          pourquoi: "Même logique de couverture aéro-anaérobie que pour toute appendicectomie — la position atypique de l'appendice ne change pas l'écologie bactérienne en cause.",
        },
        {
          ligne: <>Appendicectomie cœlioscopique, avec exploration complète de la fosse rétro-cæcale.</>,
          pourquoi:
            "L'abord cœlioscopique est ici particulièrement indiqué : il permet, contrairement à une incision de McBurney classique, une exploration complète malgré la position atypique, évitant une conversion imprévue.",
        },
        {
          ligne: (
            <>
              Antalgie : Paracétamol 1g IV + <strong>Néfopam 20mg IV</strong> si EVA &gt; 6.
            </>
          ),
          pourquoi:
            "Le Néfopam, non morphinique, complète le Paracétamol pour une analgésie multimodale évitant les effets sédatifs et digestifs des opiacés en phase pré-opératoire.",
        },
      ],
      surveillance: "Surveillance post-opératoire habituelle : constantes, reprise du transit, cicatrices de trocarts.",
    },
  },

  /* ------------------------- CAS 3 — URGENCE ABSOLUE ------------------------- */
  {
    id: "urgence",
    numero: 3,
    archetype: "Compliquée / Urgence Absolue",
    icon: Siren,
    color: "rose",
    titre: "Karim, 45 ans — Péritonite généralisée & choc septique",
    scene: "Il est 3h du matin aux urgences. Le SAMU vient de déposer un patient prostré sur un brancard, algique, à peine conscient.",
    vitals: [
      { label: "TA", value: "82/48 mmHg", alert: true },
      { label: "FC", value: "128/min", alert: true },
      { label: "FR", value: "28/min", alert: true },
      { label: "SpO2", value: "91% sous 3L O2", alert: true },
      { label: "Température", value: "39,8°C", alert: true },
      { label: "Dextro", value: "7,8 mmol/L" },
      { label: "EVA", value: "9/10", alert: true },
      { label: "Glasgow", value: "14/15", alert: true },
    ],
    acte1: [
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "ferme",
        text: "Depuis combien de temps avez-vous mal, et est-ce que la douleur a changé de localisation ?",
        pourquoi:
          "Même dans l'urgence absolue, retracer la chronologie est précieux : une douleur initialement en FID il y a plusieurs jours, devenue diffuse et généralisée, oriente fortement vers une perforation appendiculaire secondairement compliquée de péritonite.",
      },
      {
        speaker: "patient",
        name: "Karim",
        tone: "geignant, à peine audible",
        text: "Depuis... quatre jours... ça a commencé à droite... maintenant j'ai mal partout...",
      },
      {
        speaker: "autre",
        name: "Infirmière de garde",
        tone: "alerte",
        text: "Docteur, tension à 82/48, il est en sueurs, marbré aux genoux !",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "rapide",
        text: "Avez-vous vomi, avez-vous encore uriné aujourd'hui ?",
        pourquoi:
          "Je recherche des signes indirects de choc : l'iléus réflexe de la péritonite généralisée provoque des vomissements, et l'oligurie signe déjà une hypoperfusion rénale par hypovolémie relative ou choc septique installé.",
      },
      {
        speaker: "patient",
        name: "Karim",
        tone: "épuisé",
        text: "J'ai vomi... deux fois... je n'ai pas fait pipi depuis ce matin je crois...",
      },
    ],
    acte2: [
      {
        action: (
          <>
            Le médecin palpe l'abdomen : <strong>contracture généralisée invincible</strong> (« ventre de bois »), défense aux 4 quadrants.
          </>
        ),
        pourquoi:
          "Le contenu digestif perforé irrite l'ensemble du péritoine pariétal, provoquant une contraction réflexe et permanente de toute la musculature abdominale — un signe qui, à lui seul, pose l'indication chirurgicale sans attendre la moindre imagerie.",
      },
      {
        action: <>Percussion abdominale : disparition de la matité pré-hépatique.</>,
        pourquoi:
          "De l'air libre intra-péritonéal (pneumopéritoine), issu de la perforation digestive, s'interpose entre le foie et la paroi, remplaçant la matité hépatique par une sonorité anormale — un signe simple et fiable de perforation digestive.",
      },
      {
        action: <>Auscultation abdominale : silence complet.</>,
        pourquoi:
          "La péritonite généralisée provoque un iléus réflexe : l'inflammation péritonéale bloque le péristaltisme intestinal par inhibition neurogène, expliquant l'absence totale de bruits hydro-aériques.",
      },
      {
        action: <>Recherche de marbrures et du temps de recoloration cutanée : marbrures des genoux, TRC &gt; 3 secondes.</>,
        pourquoi:
          "Ce sont des signes cliniques de choc : la vasoconstriction périphérique réflexe redirige le sang vers les organes nobles au prix d'une hypoperfusion cutanée visible — un signe simple et gratuit pour juger de la gravité hémodynamique.",
      },
    ],
    acte3: [
      {
        label: "Lactates artériels",
        result: <>4,8 mmol/L.</>,
        pourquoi:
          "En hypoxie tissulaire, les cellules basculent vers un métabolisme anaérobie, produisant de l'acide lactique en excès — les lactates sont le marqueur le plus direct et le plus réactif de l'hypoperfusion tissulaire globale, plus utile qu'une imagerie pour juger de l'urgence minute par minute.",
      },
      {
        label: "NFS, CRP, Procalcitonine",
        result: <>GB à 22 000/mm³ à forte prédominance neutrophile, CRP &gt; 300 mg/L, procalcitonine élevée.</>,
        pourquoi:
          "Cette triade traduit une réponse inflammatoire systémique majeure. La procalcitonine, sécrétée massivement en cas d'infection bactérienne systémique authentique, est ici un marqueur plus spécifique que la CRP seule pour confirmer le sepsis.",
      },
      {
        label: "Hémocultures x2",
        result: <>prélevées avant toute antibiothérapie.</>,
        pourquoi:
          "Prélever avant la première dose d'antibiotique est impératif : au-delà, l'antibiotique stérilise partiellement le prélèvement et empêche d'identifier le germe en cause, compromettant l'adaptation secondaire du traitement.",
      },
      {
        label: "Gaz du sang",
        result: <>acidose métabolique à trou anionique élevé.</>,
        pourquoi:
          "L'accumulation de lactates (acide fort) consomme les bicarbonates tampons, créant une acidose métabolique à trou anionique augmenté — signature biochimique directe de l'hypoperfusion tissulaire.",
      },
      {
        label: "TDM abdomino-pelvienne injectée",
        result: <>réalisée seulement après stabilisation hémodynamique minimale : pneumopéritoine, épanchement généralisé, appendice perforé non individualisable.</>,
        pourquoi:
          "On ne scanne jamais un patient en choc non stabilisé : le trajet vers la radiologie, hors de la surveillance rapprochée du box de déchoquage, expose à un arrêt cardio-circulatoire. La réanimation prime toujours sur la confirmation d'imagerie.",
      },
    ],
    acte4: {
      items: [
        {
          maladie: "Choc hypovolémique pur",
          raisonnement: <>« Pourrait-il s'agir d'une simple déshydratation sévère avec ce contexte de vomissements ? »</>,
          pourquoi:
            "Éliminé par l'association fièvre élevée + hyperleucocytose franche + lactates élevés avec acidose : le tableau est celui d'un choc distributif septique surajouté à l'hypovolémie, pas d'une simple déshydratation isolée.",
        },
        {
          maladie: "Infarctus mésentérique",
          raisonnement: <>« Douleur abdominale majeure avec choc chez un homme de 45 ans, dois-je évoquer une ischémie mésentérique ? »</>,
          pourquoi:
            "Moins probable : le point de départ documenté en FID il y a 4 jours et l'évolution progressive vers la généralisation sont typiques d'une perforation appendiculaire secondaire, alors que l'ischémie mésentérique donne classiquement une douleur d'emblée diffuse et disproportionnée par rapport à l'examen initial.",
        },
      ],
      conclusion: (
        <>
          Diagnostic retenu : péritonite généralisée par perforation appendiculaire, avec choc septique constitué. La question n'est plus « quel diagnostic » mais{" "}
          <strong>« quelle prise en charge immédiate »</strong>.
        </>
      ),
    },
    acte5: {
      items: [
        {
          ligne: <>Position demi-assise, oxygénothérapie à haut débit (objectif SpO2 &gt; 94%), monitorage scope continu.</>,
          pourquoi: "L'oxygénation à haut débit soutient l'apport en oxygène malgré l'hypoperfusion périphérique ; le monitorage continu détecte toute dégradation hémodynamique en temps réel.",
        },
        {
          ligne: <>Pose de 2 voies veineuses périphériques de gros calibre (14-16G).</>,
          pourquoi: "Un cathéter de gros calibre permet un débit de perfusion bien supérieur à un cathéter fin, indispensable pour un remplissage rapide et massif (loi de Poiseuille).",
        },
        {
          ligne: (
            <>
              Remplissage vasculaire : <strong>Ringer Lactate 30 mL/kg</strong> en bolus initial (≈ 2000mL), réévaluation après chaque bolus.
            </>
          ),
          pourquoi:
            "Ce volume vise à restaurer la précharge cardiaque et donc le débit cardiaque, avant même d'envisager des vasopresseurs — la première ligne de toute prise en charge de choc septique.",
        },
        {
          ligne: (
            <>
              Si hypotension persistante : <strong>Noradrénaline IV</strong> à la seringue électrique, titrée pour un objectif de PAM ≥ 65 mmHg.
            </>
          ),
          pourquoi:
            "La Noradrénaline est un vasoconstricteur alpha-1 puissant qui restaure le tonus vasculaire périphérique effondré par le choc distributif septique, permettant d'atteindre une pression de perfusion suffisante pour les organes.",
        },
        {
          ligne: (
            <>
              Antibiothérapie probabiliste large spectre dans l'heure : <strong>Pipéracilline-Tazobactam 4g IV puis 4g/6h</strong>.
            </>
          ),
          pourquoi:
            "Chaque heure de retard d'antibiothérapie efficace augmente mesurablement la mortalité du choc septique — la Pipéracilline-Tazobactam couvre entérobactéries, anaérobies et une partie du Pseudomonas, un spectre large adapté à une source abdominale non encore documentée.",
        },
        {
          ligne: <>Sondage urinaire, surveillance horaire de la diurèse (objectif &gt; 0,5 mL/kg/h).</>,
          pourquoi: "La diurèse horaire est le reflet le plus simple et le plus continu de la perfusion rénale, donc de l'efficacité de la réanimation en cours.",
        },
        {
          ligne: (
            <>
              Antalgie titrée : <strong>Morphine IV</strong> par bolus de 2-3mg.
            </>
          ),
          pourquoi:
            "Une fois la décision chirurgicale prise, il n'y a plus de raison de laisser le patient souffrir — la Morphine, titrée par petits bolus, contrôle la douleur sans démasquer une dépression respiratoire brutale.",
        },
        {
          ligne: <>Bloc opératoire en extrême urgence dès stabilisation minimale : laparotomie médiane, toilette péritonéale abondante, appendicectomie, lavage-drainage.</>,
          pourquoi:
            "La cœlioscopie n'est plus indiquée dans une péritonite généralisée sévère : la laparotomie médiane offre un accès large et rapide, indispensable pour un lavage complet et le contrôle définitif de la source infectieuse.",
        },
        {
          ligne: <>Transfert systématique en réanimation post-opératoire, surveillance rapprochée (scope, diurèse horaire, lactates répétés).</>,
          pourquoi: "La clairance des lactates dans les heures suivant la chirurgie est un excellent marqueur pronostique — leur persistance signe une réanimation insuffisante ou une complication débutante.",
        },
      ],
      surveillance: "Réanimation, réévaluation continue des paramètres vitaux et biologiques dans les 24 premières heures.",
    },
  },

  /* ---------------------- CAS 4 — TERRAIN : FEMME ENCEINTE ---------------------- */
  {
    id: "grossesse",
    numero: 4,
    archetype: "Terrain Particulier — La Femme Enceinte",
    icon: Baby,
    color: "cyan",
    titre: "Amina, 29 ans — 28 semaines d'aménorrhée",
    scene: "Consultation aux urgences obstétricales. La douleur ne ressemble à rien de ce qu'Amina connaît de ses deux précédentes grossesses.",
    vitals: [
      { label: "TA", value: "112/70 mmHg" },
      { label: "FC", value: "98/min" },
      { label: "FR", value: "18/min" },
      { label: "SpO2", value: "98% AA" },
      { label: "Température", value: "38,0°C", alert: true },
      { label: "Dextro", value: "5,4 mmol/L" },
      { label: "EVA", value: "5/10" },
      { label: "Glasgow", value: "15/15" },
    ],
    acte1: [
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "attentif",
        text: "Où se situe exactement la douleur ? Est-ce plus haut que ce que vous imaginiez ?",
        pourquoi:
          "À partir du 2e trimestre, l'utérus gravide repousse progressivement le cæcum et l'appendice vers le haut et l'arrière — au 3e trimestre, la douleur peut se retrouver au niveau du flanc voire de l'hypochondre droit, mimant une cholécystite ou une pyélonéphrite haute.",
      },
      {
        speaker: "patient",
        name: "Amina",
        tone: "inquiète",
        text: "C'est plus haut que ce à quoi je m'attendais, presque sous les côtes à droite.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "vigilant",
        text: "Avez-vous des contractions, des saignements, ou une diminution des mouvements du bébé ?",
        pourquoi:
          "Toute pathologie abdominale chez la femme enceinte impose une évaluation obstétricale parallèle : des contractions peuvent traduire une irritation utérine réflexe secondaire à l'inflammation péritonéale, et le bien-être fœtal doit être surveillé en continu quel que soit le diagnostic maternel.",
      },
      {
        speaker: "patient",
        name: "Amina",
        tone: "préoccupée",
        text: "Pas de saignement, mais je sens quelques contractions depuis ce matin, et le bébé bouge un peu moins je trouve.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "précis",
        text: "Avez-vous de la fièvre, des nausées, avez-vous vomi ?",
        pourquoi:
          "Les nausées sont fréquentes en début de grossesse, ce qui peut faussement rassurer — leur réapparition ou aggravation au 2e/3e trimestre, associée à une douleur localisée, doit au contraire alerter plutôt que rassurer.",
      },
      {
        speaker: "patient",
        name: "Amina",
        tone: "surprise",
        text: "Un peu de fièvre je crois, et des nausées alors que je n'en avais plus depuis le premier trimestre.",
      },
    ],
    acte2: [
      {
        action: <>Le médecin palpe avec douceur la zone décrite : sensibilité de l'hypochondre droit et du flanc, sans défense franche.</>,
        pourquoi:
          "L'utérus gravide distend la paroi abdominale et l'éloigne du foyer inflammatoire profond, ce qui atténue mécaniquement la transmission de la défense pariétale — un abdomen souple ne doit jamais rassurer chez la femme enceinte au 3e trimestre.",
      },
      {
        action: <>Le médecin recherche la douleur provoquée au point anatomiquement cohérent avec la position gravidique de l'appendice : douleur retrouvée à la palpation profonde du flanc droit.</>,
        pourquoi:
          "Chez la femme enceinte, les points de référence classiques (McBurney) migrent avec l'utérus ; il faut chercher la douleur là où l'appendice est réellement déplacé selon le terme, et non à son emplacement théorique habituel.",
      },
      {
        action: <>Monitoring fœtal (cardiotocographie) : rythme cardiaque fœtal normal, quelques contractions utérines irrégulières et peu intenses.</>,
        pourquoi:
          "Ces contractions traduisent une irritabilité utérine réflexe secondaire à l'inflammation intra-abdominale de voisinage, et non un authentique travail prématuré — mais seule la surveillance continue du rythme cardiaque fœtal permet de l'affirmer et d'exclure une souffrance fœtale débutante.",
      },
    ],
    acte3: [
      {
        label: "NFS",
        result: <>GB à 14 500/mm³.</>,
        pourquoi:
          "Attention au piège physiologique : une hyperleucocytose modérée (jusqu'à 12-15 000/mm³) est banale pendant la grossesse normale, du fait d'une démargination physiologique des neutrophiles. Le chiffre doit être interprété avec prudence et toujours confronté à la clinique.",
      },
      {
        label: "CRP",
        result: <>55 mg/L.</>,
        pourquoi: "Contrairement aux globules blancs, la CRP n'est pas significativement modifiée par la grossesse elle-même — elle garde ici toute sa valeur discriminante et pèse plus lourd que la NFS.",
      },
      {
        label: "Échographie abdominale",
        result: <>appendice difficile à visualiser du fait de l'utérus gravide, mais épaississement de la paroi cæcale évocateur.</>,
        pourquoi:
          "L'échographie est le premier choix chez la femme enceinte car totalement non irradiante — mais l'utérus gravide et le déplacement de l'appendice réduisent sa sensibilité au 3e trimestre, ce qui explique un résultat souvent moins net.",
      },
      {
        label: "IRM abdominale sans gadolinium",
        result: <>appendice épaissi à 10mm, infiltration péri-appendiculaire, confirmant le diagnostic.</>,
        pourquoi:
          "L'IRM est l'examen de recours privilégié pendant la grossesse quand l'échographie est mise en défaut : elle n'irradie pas le fœtus, contrairement au scanner, et offre une excellente résolution des tissus mous. Le gadolinium est évité par précaution, sans nuire à la qualité diagnostique.",
      },
    ],
    acte4: {
      items: [
        {
          maladie: "Cholécystite aiguë",
          raisonnement: <>« Douleur de l'hypochondre droit chez une femme enceinte, la cholécystite est une évidence à éliminer... »</>,
          pourquoi:
            "L'échographie hépatobiliaire, réalisée dans le même temps, retrouve une vésicule fine sans lithiase ni épaississement pariétal — ce qui élimine cette hypothèse malgré la localisation trompeuse de la douleur.",
        },
        {
          maladie: "Pyélonéphrite droite",
          raisonnement: <>« La grossesse favorise la stase urinaire, une pyélonéphrite est fréquente à ce terme... »</>,
          pourquoi:
            "La bandelette urinaire et l'ECBU reviennent négatifs, et il n'y a pas de contact lombaire net — la stase urinaire physiologique de la grossesse rend ce diagnostic fréquent, mais les examens complémentaires l'écartent formellement ici.",
        },
        {
          maladie: "Menace d'accouchement prématuré isolée",
          raisonnement: <>« Les contractions pourraient être la cause première, et non une conséquence... »</>,
          pourquoi:
            "Le monitoring ne retrouve pas de modification cervicale ni de contractions régulières et intenses — elles restent secondaires à l'irritation péritonéale de voisinage, confirmant que l'utérus n'est ici qu'un témoin, pas la cause.",
        },
      ],
      conclusion: "Diagnostic retenu : appendicite aiguë chez la femme enceinte de 28 SA, confirmée par IRM.",
    },
    acte5: {
      items: [
        {
          ligne: <>Hospitalisation conjointe avec l'équipe obstétricale, monitoring fœtal continu.</>,
          pourquoi: "Toute décision thérapeutique doit ici intégrer simultanément le pronostic maternel et fœtal — la coordination avec l'obstétricien est une condition de sécurité, pas une option.",
        },
        {
          ligne: (
            <>
              Antibioprophylaxie compatible avec la grossesse : <strong>Céfazoline 2g IV</strong> (sûre en grossesse) + <strong>Métronidazole 500mg IV</strong>.
            </>
          ),
          pourquoi:
            "Ces deux molécules ont un profil de sécurité établi pendant la grossesse aux doses prophylactiques utilisées — contrairement à certains antibiotiques formellement contre-indiqués (tétracyclines, fluoroquinolones).",
        },
        {
          ligne: <>Appendicectomie cœlioscopique, réalisable en toute sécurité jusqu'au 3e trimestre entre des mains expérimentées.</>,
          pourquoi:
            "La cœlioscopie n'est pas contre-indiquée pendant la grossesse : elle limite la manipulation utérine, réduit la douleur post-opératoire et le risque de travail prématuré par rapport à une laparotomie, à condition d'adapter la pression d'insufflation et la position des trocarts au terme.",
        },
        {
          ligne: <>Tocolyse non systématique, mais surveillance rapprochée des contractions en post-opératoire.</>,
          pourquoi:
            "Une tocolyse préventive systématique n'a pas montré de bénéfice net et expose à des effets secondaires maternels ; elle n'est réservée qu'à l'apparition de contractions régulières authentiques en post-opératoire.",
        },
      ],
      surveillance: "Surveillance post-opératoire conjointe : constantes maternelles, monitoring fœtal répété, reprise du transit, sortie coordonnée avec la maternité.",
    },
  },

  /* ---------------------- CAS 5 — TERRAIN : SUJET ÂGÉ ---------------------- */
  {
    id: "sujet_age",
    numero: 5,
    archetype: "Terrain Particulier — Le Sujet Âgé",
    icon: HeartPulse,
    color: "slate",
    titre: "Fatiha, 78 ans — Quand la biologie et la clinique se taisent",
    scene: "Il est 11h du matin. Consultation initialement prévue pour un simple contrôle glycémique — mais la fille de la patiente a insisté pour un examen plus approfondi.",
    vitals: [
      { label: "TA", value: "108/64 mmHg", alert: true },
      { label: "FC", value: "104/min", alert: true },
      { label: "FR", value: "20/min" },
      { label: "SpO2", value: "95% AA" },
      { label: "Température", value: "37,6°C", alert: true },
      { label: "Dextro", value: "14,2 mmol/L", alert: true },
      { label: "EVA", value: "3/10 (sous-exprimée)" },
      { label: "Glasgow", value: "14/15", alert: true },
    ],
    acte1: [
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "patient",
        text: "Depuis quand avez-vous mal exactement, et est-ce que ça s'est aggravé ?",
        pourquoi:
          "Chez le sujet âgé, la chronologie précise est d'autant plus précieuse que la patiente elle-même minimise volontiers ses symptômes — c'est souvent l'entourage, pas le patient, qui apporte l'information la plus fiable.",
      },
      {
        speaker: "patient",
        name: "Fatiha",
        tone: "minimisante, calme",
        text: "Ce n'est rien docteur, juste un peu mal au ventre depuis trois jours.",
      },
      {
        speaker: "autre",
        name: "La fille de Fatiha",
        tone: "inquiète",
        text: "Docteur, elle n'est plus comme d'habitude. Elle est plus confuse, elle qui est toujours si vive.",
      },
      {
        speaker: "medecin",
        name: "Dr. Meziane",
        tone: "vigilant",
        text: "Avez-vous encore faim ? Avez-vous eu de la fièvre chez vous ?",
        pourquoi:
          "L'anorexie reste un signe fiable même chez le sujet âgé, contrairement à la fièvre qui peut être totalement absente malgré une infection sévère — la réserve thermorégulatrice diminue avec l'âge, ce qui explique pourquoi une température normale ne doit jamais éliminer une urgence chez cette patiente.",
      },
      {
        speaker: "patient",
        name: "Fatiha",
        tone: "évasive",
        text: "Je n'ai pas très faim c'est vrai, mais je n'ai pas eu de fièvre, je me sens juste un peu fatiguée.",
      },
    ],
    acte2: [
      {
        action: <>Palpation de la FID : sensibilité diffuse avec un empâtement mal limité, sensible.</>,
        pourquoi:
          "Cet empâtement traduit un plastron en formation — un magma inflammatoire agglutinant l'appendice, le grand épiploon et les anses voisines, tentative naturelle de l'organisme pour cloisonner l'infection avant qu'elle ne diffuse davantage.",
      },
      {
        action: <>Recherche de défense : discrète mais présente, pas de contracture généralisée.</>,
        pourquoi:
          "Chez le sujet âgé, la paroi abdominale, moins tonique, transmet moins fidèlement l'irritation péritonéale sous-jacente — la défense peut donc être minime malgré une inflammation intra-abdominale déjà sévère et organisée.",
      },
      {
        action: <>Évaluation de l'état de conscience : légère confusion notée par la fille, non perçue par la patiente elle-même.</>,
        pourquoi:
          "Une confusion aiguë chez une personne âgée habituellement autonome doit systématiquement faire rechercher une cause somatique sous-jacente — ici, probablement le retentissement d'un syndrome infectieux systémique sur un cerveau âgé moins tolérant aux perturbations métaboliques.",
      },
    ],
    acte3: [
      {
        label: "NFS",
        result: <>GB à 9 800/mm³ (quasi normale), mais déviation gauche marquée.</>,
        pourquoi:
          "La moelle osseuse du sujet âgé a une capacité de réponse proliférative diminuée : elle libère davantage de formes immatures (déviation gauche) sans nécessairement augmenter le chiffre total de globules blancs — un chiffre normal ne doit jamais rassurer à lui seul, il faut lire la formule.",
      },
      {
        label: "CRP",
        result: <>180 mg/L.</>,
        pourquoi:
          "Contrairement à la NFS, la synthèse hépatique de CRP sous stimulation de l'IL-6 reste préservée avec l'âge — elle devient ici le marqueur le plus fiable de la sévérité réelle, largement plus parlant qu'une NFS faussement rassurante.",
      },
      {
        label: "Ionogramme",
        result: <>hyponatrémie légère, insuffisance rénale fonctionnelle.</>,
        pourquoi:
          "La diminution des apports hydriques (anorexie, sensation de soif elle-même émoussée avec l'âge) associée aux pertes digestives entraîne une déshydratation extracellulaire, expliquant l'insuffisance rénale fonctionnelle et les troubles ioniques associés.",
      },
      {
        label: "TDM abdomino-pelvienne injectée",
        result: <>plastron appendiculaire de 6cm, peu de liquide libre, pas de pneumopéritoine franc.</>,
        pourquoi:
          "Chez le sujet âgé à présentation atypique, la TDM est systématique et immédiate — on ne peut pas se permettre l'incertitude d'une échographie moins sensible et opérateur-dépendante face à un tableau aussi trompeur.",
      },
    ],
    acte4: {
      items: [
        {
          maladie: "Néoplasie colique droite perforée ou abcédée",
          raisonnement: <>« Chez une patiente de cet âge, je dois systématiquement évoquer un cancer colique révélé par sa complication... »</>,
          pourquoi:
            "Ce diagnostic ne s'élimine pas à ce stade — il impose une coloscopie de contrôle systématique à distance, après cicatrisation complète, car un authentique cancer du cæcum peut parfaitement se compliquer d'un tableau pseudo-appendiculaire chez le sujet âgé.",
        },
        {
          maladie: "Diverticulite droite",
          raisonnement: <>« Plus rare que la diverticulite sigmoïdienne classique, mais elle existe et mime parfaitement ce tableau. »</>,
          pourquoi:
            "Elle ne peut être formellement distinguée qu'à l'analyse fine de la TDM ou en peropératoire — sa prise en charge initiale (antibiothérapie, pas de chirurgie sur un tableau non compliqué) rejoint heureusement celle du plastron appendiculaire.",
        },
        {
          maladie: "Ischémie mésentérique",
          raisonnement: <>« Douleur abdominale chez une patiente âgée, artéritique probable, l'ischémie doit toujours être évoquée. »</>,
          pourquoi:
            "Jugée peu probable : absence d'acidose métabolique sévère aux gaz du sang, et localisation strictement en FID cohérente avec un foyer appendiculaire plutôt qu'une souffrance ischémique diffuse du grêle.",
        },
      ],
      conclusion: "Diagnostic retenu : appendicite aiguë compliquée d'un plastron chez le sujet âgé.",
    },
    acte5: {
      items: [
        {
          ligne: <>Pas de chirurgie immédiate — le plastron constitué est une contre-indication formelle.</>,
          pourquoi:
            "Opérer à chaud sur un magma inflammatoire mal individualisé expose à un risque majeur de plaie digestive iatrogène et de dissémination septique — l'organisme a déjà entrepris un cloisonnement naturel qu'il faut respecter, pas contrarier chirurgicalement.",
        },
        {
          ligne: <>Hospitalisation, 2 VVP, réhydratation prudente par Ringer Lactate, débit adapté aux fonctions rénale et cardiaque.</>,
          pourquoi:
            "Chez le sujet âgé, un remplissage trop rapide expose à une décompensation cardiaque (œdème pulmonaire) du fait d'une réserve myocardique diminuée — le débit doit être titré plus prudemment que chez un adulte jeune.",
        },
        {
          ligne: (
            <>
              Antibiothérapie IV probabiliste : <strong>Ceftriaxone 2g IV/j</strong> + <strong>Métronidazole 500mg x3/j IV</strong>.
            </>
          ),
          pourquoi:
            "La Ceftriaxone, céphalosporine de 3e génération à demi-vie longue (1 injection/j), couvre les entérobactéries ; le Métronidazole couvre les anaérobies — l'association cible la même écologie colique que chez l'adulte jeune, adaptée ici à une administration simplifiée.",
        },
        {
          ligne: <>Correction glycémique : insulinothérapie IV à la seringue électrique, surveillance dextro horaire.</>,
          pourquoi:
            "Le stress infectieux aigu majore l'insulinorésistance et décompense un diabète jusque-là équilibré — une hyperglycémie non corrigée aggrave elle-même le pronostic infectieux en altérant la fonction des polynucléaires neutrophiles.",
        },
        {
          ligne: <>Si évolution favorable : antibiothérapie 10-15 jours, puis appendicectomie « à froid » à 6-8 semaines + coloscopie de contrôle systématique.</>,
          pourquoi:
            "Ce délai laisse le temps à l'inflammation de régresser complètement, rendant la chirurgie différée bien plus sûre techniquement qu'une chirurgie à chaud ; la coloscopie systématique reste impérative pour ne jamais méconnaître un cancer colique sous-jacent.",
        },
      ],
      surveillance:
        "Surveillance scope (FC, TA, SpO2), réévaluation clinique et biologique à 48h ; si aggravation (choc, contracture généralisée) : laparotomie en urgence sans délai.",
    },
  },
];

/* ----------------------------------------------------------------------- */
/* Shell — case selector pills + dispatch. Fully standalone.                */
/* ----------------------------------------------------------------------- */

export function CasCliniqueStudio() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeCase = CASES[activeIndex];

  return (
    <div className="w-full mx-auto space-y-6 font-sans text-slate-800 dark:text-slate-200 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <Stethoscope className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Récit Clinique Immersif</h2>
        </div>
        {CASES.map((c, i) => {
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
