"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Star,
  ListChecks,
  Landmark,
  GraduationCap,
  Lightbulb,
  AlertTriangle,
  Stethoscope,
  Bug,
  Pill,
  CheckCircle2,
  Activity,
  Microscope,
  ShieldAlert,
  XCircle,
  Info,
  Siren,
  ClipboardList,
  Crosshair,
  Syringe,
  BookOpen,
  Brain,
  EyeOff,
  Zap,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  GastriteAstuceItem,
  GastriteResumeData,
  GastriteResumeMode,
  GastriteResumeTable,
} from "@/lib/course-slug-content";

interface GastriteResumeModeChrome {
  id: GastriteResumeMode["id"];
  label: string;
  icon: LucideIcon;
}

const MODES: GastriteResumeModeChrome[] = [
  { id: "smart", label: "Smart Summary", icon: Sparkles },
  { id: "exam", label: "Exam Summary", icon: Star },
  { id: "cheatsheet", label: "Cheat Sheet", icon: ListChecks },
  { id: "guideline", label: "Guideline Summary", icon: Landmark },
  { id: "professor", label: "Professor Notes", icon: GraduationCap },
  { id: "astuces", label: "Astuces", icon: Lightbulb },
];

/* ----------------------------------------------------------------------- */
/* Shared Framer Motion variants — every mode's content uses these.         */
/* ----------------------------------------------------------------------- */

const STAGGER_CONTAINER = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.1 },
  },
};

const FADE_UP = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 100, damping: 15 } },
};

const SCALE_IN = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 120, damping: 15 } },
};

/** Fixed left-border tone cycle used by section 4's 2x2 card grid — position-based, not per-item data (it was pure style in the original). */
const AMBER_BAR_SHADES = ["bg-amber-400", "bg-amber-500", "bg-amber-600", "bg-amber-700"];

/** Fixed icon cycle for section 5's 3-card grid — position-based, matches the original Stethoscope/Microscope/Bug sequence. */
const SECTION5_ICONS: LucideIcon[] = [Stethoscope, Microscope, Bug];

/** Fixed icon cycle for section 7's checklist — position-based, matches the original Pill/Bug/Crosshair/Microscope sequence. */
const SECTION7_ICONS: LucideIcon[] = [Pill, Bug, Crosshair, Microscope];

/** Section 6's row tones escalate left→right (calm → urgent) — position-based, matches the original slate/amber/rose sequence. */
const SECTION6_ROW_TONES = [
  { badge: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300", border: "" },
  { badge: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400", border: "border-l-4 border-amber-400" },
  { badge: "bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400", border: "border-l-4 border-rose-500" },
];

/** Pièges-category tones cycle in the same fixed rose/blue/purple/amber order the original 4 categories used. */
const PIEGE_CATEGORY_TONES = [
  { pill: "bg-rose-600", rule: "bg-rose-200 dark:bg-rose-900/40", card: "bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-500/40 shadow-[0_0_25px_-8px_rgba(244,63,94,0.4)]", title: "text-rose-700 dark:text-rose-400", body: "text-rose-800 dark:text-rose-300" },
  { pill: "bg-blue-600", rule: "bg-blue-200 dark:bg-blue-900/40", card: "bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-500/40 shadow-[0_0_25px_-8px_rgba(59,130,246,0.4)]", title: "text-blue-700 dark:text-blue-400", body: "text-blue-800 dark:text-blue-300" },
  { pill: "bg-purple-600", rule: "bg-purple-200 dark:bg-purple-900/40", card: "bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-300 dark:border-purple-500/40 shadow-[0_0_25px_-8px_rgba(168,85,247,0.4)]", title: "text-purple-700 dark:text-purple-400", body: "text-purple-800 dark:text-purple-300" },
  { pill: "bg-amber-500", rule: "bg-amber-200 dark:bg-amber-900/40", card: "bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-500/40 shadow-[0_0_25px_-8px_rgba(245,158,11,0.4)]", title: "text-amber-700 dark:text-amber-400", body: "text-amber-800 dark:text-amber-300" },
];

/** Guideline timeline steps escalate teal → cyan → blue → emerald — position-based, matches the original 4-step sequence. */
const GUIDELINE_STEP_STYLES = [
  { dot: "bg-teal-500 shadow-teal-500/40", border: "border-teal-100 dark:border-teal-900/30", title: "text-teal-700 dark:text-teal-400", icon: Siren },
  { dot: "bg-cyan-500 shadow-cyan-500/40", border: "border-cyan-100 dark:border-cyan-900/30", title: "text-cyan-700 dark:text-cyan-400", icon: CheckCircle2 },
  { dot: "bg-blue-500 shadow-blue-500/40", border: "border-blue-100 dark:border-blue-900/30", title: "text-blue-700 dark:text-blue-400", icon: Microscope },
  { dot: "bg-emerald-500 shadow-emerald-500/40", border: "border-emerald-100 dark:border-emerald-900/30", title: "text-emerald-700 dark:text-emerald-400", icon: Crosshair },
];

/** Cheat Sheet's 4 dashboard panels each have a fixed tone + icon; matched by card position (Symptômes/Causes/Diagnostic/Traitement). */
const CHEATSHEET_TONE_STYLES: Record<string, { icon: LucideIcon; wrap: string; iconBg: string; title: string; pill: string; pillStrong: string }> = {
  teal: {
    icon: Activity,
    wrap: "bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-900/40",
    iconBg: "bg-teal-500",
    title: "text-teal-700 dark:text-teal-400",
    pill: "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300",
    pillStrong: "bg-teal-200 dark:bg-teal-900/60 text-teal-800 dark:text-teal-200",
  },
  indigo: {
    icon: Bug,
    wrap: "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900/40",
    iconBg: "bg-indigo-500",
    title: "text-indigo-700 dark:text-indigo-400",
    pill: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
    pillStrong: "bg-indigo-200 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-200",
  },
  purple: {
    icon: Microscope,
    wrap: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-900/40",
    iconBg: "bg-purple-500",
    title: "text-purple-700 dark:text-purple-400",
    pill: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
    pillStrong: "bg-purple-200 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200",
  },
  emerald: {
    icon: Syringe,
    wrap: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40",
    iconBg: "bg-emerald-500",
    title: "text-emerald-700 dark:text-emerald-400",
    pill: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    pillStrong: "bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
  },
};

/** Deterministic multi-color cycle for astuce acronym letters — the original hand-picked a bespoke color per letter; this reproduces the same visual language (not a byte-for-byte match) from plain-text data. */
const ACRONYM_LETTER_PALETTE = [
  "text-indigo-600 dark:text-indigo-400",
  "text-amber-600 dark:text-amber-400",
  "text-orange-600 dark:text-orange-400",
  "text-rose-600 dark:text-rose-400",
  "text-blue-600 dark:text-blue-400",
  "text-emerald-600 dark:text-emerald-400",
];

function GenericTable({ table }: { table: GastriteResumeTable }) {
  if (!table.headers.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg">
      <table className="w-full text-left text-sm md:text-base border-collapse">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-900/60">
            {table.headers.map((h, i) => (
              <th key={i} className="p-4 font-black text-slate-900 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {table.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              {row.map((cell, ci) => (
                <td key={ci} className={cn("p-4 text-slate-600 dark:text-slate-300", ci === 0 && "font-bold text-slate-900 dark:text-slate-100")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Smart Summary" mode — the rich, data-driven "Masterclass" summary.      */
/* ----------------------------------------------------------------------- */

function MasterclassSummary({ mode }: { mode: GastriteResumeMode }) {
  const [s1, s2, s3, s4, s5, s6, s7] = mode.sections;

  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-10 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      {/* HEADER: Hero Section */}
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 p-8 shadow-2xl border border-slate-700/50">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-teal-500/20 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-orange-500/20 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-4 bg-gradient-to-br from-teal-400 to-cyan-600 rounded-2xl shadow-lg shadow-teal-500/30 text-white">
            <Stethoscope className="w-10 h-10" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-2">
              {mode.hero.tags.map((tag, i) => (
                <span
                  key={tag}
                  className={cn(
                    "px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full border",
                    i % 2 === 0
                      ? "bg-teal-500/20 text-teal-300 border-teal-500/30"
                      : "bg-orange-500/20 text-orange-300 border-orange-500/30"
                  )}
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mb-2 drop-shadow-md">
              {mode.hero.titre}
            </h1>
            <p className="text-sm md:text-base font-medium text-slate-300 leading-relaxed max-w-2xl">
              {mode.hero.intro}
            </p>
          </div>
        </div>
      </motion.div>

      {/* SECTION 1: L'Essentiel */}
      {s1 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <div className="flex items-center gap-3 border-b-2 border-teal-500/30 pb-3">
            <div className="p-2 bg-teal-500/10 rounded-lg text-teal-500"><Activity className="w-6 h-6" /></div>
            <h2 className="text-xl md:text-2xl font-black text-teal-600 dark:text-teal-400 uppercase tracking-wide">
              {s1.numero}. {s1.titre}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {s1.cards[0] && (
              <div className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-teal-300 dark:hover:border-teal-500/50 transition-colors">
                <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase mb-2 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-teal-500" /> {s1.cards[0].titre}
                </h3>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{s1.cards[0].content}</p>
              </div>
            )}
            {s1.cards[1] && (
              <div className="bg-rose-50 dark:bg-rose-950/40 p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm relative overflow-hidden">
                <div className="absolute right-0 top-0 w-32 h-32 bg-rose-500/10 blur-2xl rounded-full" />
                <h3 className="text-sm font-black text-rose-700 dark:text-rose-400 uppercase mb-2 flex items-center gap-2 relative z-10">
                  <ShieldAlert className="w-4 h-4" /> {s1.cards[1].titre}
                </h3>
                <ul className="text-sm leading-relaxed text-rose-800 dark:text-rose-300 space-y-2 relative z-10 font-medium">
                  {s1.cards[1].items.map((item, i) => (
                    <li key={i}>❌ {item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </motion.section>
      )}

      {/* SECTION 2: Les 2 Coupables */}
      {s2 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <div className="flex items-center gap-3 border-b-2 border-indigo-500/30 pb-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-500"><Bug className="w-6 h-6" /></div>
            <h2 className="text-xl md:text-2xl font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
              {s2.numero}. {s2.titre}
            </h2>
          </div>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{s2.intro}</p>
          <GenericTable table={s2.table} />
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{s2.outro}</p>
        </motion.section>
      )}

      {/* SECTION 3: Cascade Physiopathologique */}
      {s3 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <div className="flex items-center gap-3 border-b-2 border-purple-500/30 pb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-500"><Zap className="w-6 h-6" /></div>
            <h2 className="text-xl md:text-2xl font-black text-purple-600 dark:text-purple-400 uppercase tracking-wide">
              {s3.numero}. {s3.titre}
            </h2>
          </div>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{s3.intro}</p>
          <GenericTable table={s3.table} />
        </motion.section>
      )}

      {/* SECTION 4: Piège Clinique */}
      {s4 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <div className="flex items-center gap-3 border-b-2 border-amber-500/30 pb-3">
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500"><EyeOff className="w-6 h-6" /></div>
            <h2 className="text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              {s4.numero}. {s4.titre}
            </h2>
          </div>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{s4.intro}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {s4.cards.map((card, i) => (
              <div key={card.titre} className="flex gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className={cn("w-1.5 h-full rounded-full shrink-0", AMBER_BAR_SHADES[i % AMBER_BAR_SHADES.length])} />
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-white mb-1">{card.titre}</h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{card.content}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>
      )}

      {/* SECTION 5: Arsenal Diagnostique */}
      {s5 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <div className="flex items-center gap-3 border-b-2 border-blue-500/30 pb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500"><Microscope className="w-6 h-6" /></div>
            <h2 className="text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 uppercase tracking-wide">
              {s5.numero}. {s5.titre}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {s5.cards.map((card, i) => {
              const Icon = SECTION5_ICONS[i % SECTION5_ICONS.length];
              return (
                <div key={card.titre} className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-md">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white mb-2">{card.titre}</h3>
                  {card.type === "list" ? (
                    <ul className="text-sm space-y-1.5 text-slate-600 dark:text-slate-400">
                      {card.items.map((item, j) => (
                        <li key={j}>• {item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{card.content}</p>
                  )}
                </div>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* SECTION 6 & 7: Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {s6 && (
          <motion.section variants={FADE_UP} className="space-y-4 bg-cyan-50 dark:bg-cyan-950/20 p-6 rounded-3xl border border-cyan-100 dark:border-cyan-900/50">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-6 h-6 text-cyan-600 dark:text-cyan-400" />
              <h2 className="text-lg font-black text-cyan-700 dark:text-cyan-300 uppercase">
                {s6.numero}. {s6.titre}
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{s6.intro}</p>
            <div className="space-y-3">
              {s6.rows.map((row, i) => {
                const tone = SECTION6_ROW_TONES[i % SECTION6_ROW_TONES.length];
                return (
                  <div key={row.label} className={cn("flex justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm", tone.border)}>
                    <span className="font-bold text-slate-700 dark:text-slate-200">{row.label}</span>
                    <span className={cn("px-3 py-1 text-xs font-bold rounded-full", tone.badge)}>{row.badge}</span>
                  </div>
                );
              })}
            </div>
          </motion.section>
        )}

        {s7 && (
          <motion.section variants={FADE_UP} className="space-y-4 bg-emerald-50 dark:bg-emerald-950/20 p-6 rounded-3xl border border-emerald-100 dark:border-emerald-900/50">
            <div className="flex items-center gap-2 mb-4">
              <Syringe className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-lg font-black text-emerald-700 dark:text-emerald-300 uppercase">
                {s7.numero}. {s7.titre}
              </h2>
            </div>
            <ul className="space-y-4 text-sm md:text-base text-slate-700 dark:text-slate-300">
              {s7.items.map((item, i) => {
                const Icon = SECTION7_ICONS[i % SECTION7_ICONS.length];
                return (
                  <li key={i} className="flex gap-3 items-start">
                    <div className="mt-1 bg-emerald-200 dark:bg-emerald-800/50 p-1 rounded text-emerald-700 dark:text-emerald-400">
                      <Icon className="w-3 h-3" />
                    </div>
                    <div>{item}</div>
                  </li>
                );
              })}
            </ul>
          </motion.section>
        )}
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Exam Summary" mode — high-yield facts, DDx comparison table, exam traps. */
/* ----------------------------------------------------------------------- */

function ExamSummaryContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-10 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-600 to-amber-600 dark:from-orange-900 dark:to-amber-950 p-8 shadow-2xl border border-orange-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-black/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-4 bg-white/20 backdrop-blur-md rounded-2xl shadow-lg text-white">
            <GraduationCap className="w-10 h-10" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              {mode.hero.badge}
            </span>
            <h1 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mt-2 mb-2 drop-shadow-md">
              {mode.hero.titre}
            </h1>
            <p className="text-sm md:text-base font-medium text-orange-50 leading-relaxed max-w-2xl">{mode.hero.intro}</p>
          </div>
        </div>
      </motion.div>

      {/* Section : DDx */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-orange-500/30 pb-3">
          <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500"><Stethoscope className="w-6 h-6" /></div>
          <h2 className="text-xl md:text-2xl font-black text-orange-600 dark:text-orange-400 uppercase tracking-wide">
            {mode.ddx_table.titre}
          </h2>
        </div>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{mode.ddx_table.intro}</p>

        <div className="overflow-hidden rounded-2xl border border-orange-100 dark:border-orange-900/30 shadow-lg">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-800 dark:to-amber-800">
                {mode.ddx_table.headers.map((h) => (
                  <th key={h} className="p-3 font-black text-white">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {mode.ddx_table.rows.map((row, ri) => (
                <tr key={ri} className={cn(ri === 0 ? "bg-teal-50/60 dark:bg-teal-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors")}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "p-3",
                        ri === 0
                          ? ci === 0
                            ? "font-black text-teal-600 dark:text-teal-400"
                            : "text-slate-700 dark:text-slate-300"
                          : ci === 0
                            ? "font-bold text-slate-800 dark:text-slate-200"
                            : "text-slate-600 dark:text-slate-400"
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Section : Pièges — master-grid catégorisé */}
      <motion.section variants={FADE_UP} className="space-y-8">
        <div className="flex items-center gap-3 border-b-2 border-rose-500/30 pb-3">
          <div className="p-2 bg-rose-500/10 rounded-lg text-rose-500"><AlertTriangle className="w-6 h-6" /></div>
          <h2 className="text-xl md:text-2xl font-black text-rose-600 dark:text-rose-400 uppercase tracking-wide">
            {mode.pieges.titre}
          </h2>
        </div>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{mode.pieges.intro}</p>

        {mode.pieges.categories.map((category, ci) => {
          const tone = PIEGE_CATEGORY_TONES[ci % PIEGE_CATEGORY_TONES.length];
          return (
            <div key={category.nom} className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={cn("px-3 py-1 rounded-full text-white text-xs font-black uppercase tracking-wide", tone.pill)}>{category.nom}</span>
                <span className={cn("h-px flex-1", tone.rule)} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {category.items.map((item) => (
                  <div key={item.numero} className={cn("relative overflow-hidden p-5 rounded-2xl", tone.card)}>
                    <h3 className={cn("font-black mb-1 flex items-center gap-2", tone.title)}>
                      <XCircle className="w-4 h-4" /> Piège n°{item.numero}
                    </h3>
                    <p className={cn("text-sm", tone.body)}>{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </motion.section>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Cheat Sheet" mode — dense, color-coded dashboard grid.                  */
/* ----------------------------------------------------------------------- */

function CheatSheetContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 to-indigo-950 dark:from-slate-950 dark:to-indigo-950 p-6 shadow-2xl border border-indigo-500/20">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-56 h-56 bg-indigo-500/20 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 bg-white/10 backdrop-blur-md rounded-xl text-white"><ListChecks className="w-8 h-8" /></div>
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">{mode.hero.titre}</h1>
            <p className="text-xs md:text-sm text-indigo-200 mt-1">{mode.hero.sous_titre}</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {mode.cards.map((card) => {
          const tone = CHEATSHEET_TONE_STYLES[card.tone ?? ""] ?? CHEATSHEET_TONE_STYLES.teal;
          const Icon = tone.icon;
          const lastIndex = card.items.length - 1;
          return (
            <motion.div key={card.titre} variants={FADE_UP} className={cn("rounded-2xl border p-4 shadow-md", tone.wrap)}>
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("p-1.5 rounded-lg text-white", tone.iconBg)}>
                  <Icon className="w-4 h-4" />
                </div>
                <h3 className={cn("font-black text-sm uppercase", tone.title)}>{card.titre}</h3>
              </div>
              <div className="space-y-1.5">
                {card.items.map((item, i) => (
                  <span
                    key={i}
                    className={cn(
                      "block px-2 py-1 rounded-full text-xs",
                      i === lastIndex ? cn("italic", tone.pill) : i === lastIndex - 1 ? cn("font-black", tone.pillStrong) : cn("font-bold", tone.pill)
                    )}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Guideline Summary" mode — vertical clinical-pathway timeline.           */
/* ----------------------------------------------------------------------- */

function GuidelineSummaryContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-cyan-700 dark:from-teal-900 dark:to-cyan-950 p-8 shadow-2xl border border-teal-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-white/15 backdrop-blur-md rounded-2xl shadow-lg text-white">
            <ClipboardList className="w-10 h-10" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              {mode.hero.badge}
            </span>
            <h1 className="text-3xl md:text-4xl font-black text-white uppercase tracking-tight mt-2">{mode.hero.titre}</h1>
            <p className="text-sm text-teal-50 mt-1 max-w-xl">{mode.hero.intro}</p>
          </div>
        </div>
      </motion.div>

      <motion.section variants={FADE_UP} className="relative pl-10">
        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gradient-to-b from-teal-400 via-cyan-400 to-emerald-400 rounded-full" />

        {mode.steps.map((step, i) => {
          const style = GUIDELINE_STEP_STYLES[i % GUIDELINE_STEP_STYLES.length];
          const StepIcon = style.icon;
          const isLast = i === mode.steps.length - 1;
          return (
            <div key={step.numero} className={cn("relative", !isLast && "mb-8")}>
              <div className={cn("absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full text-white font-black text-sm shadow-lg", style.dot)}>
                {step.numero}
              </div>
              <div className={cn("rounded-2xl bg-white dark:bg-slate-900 border p-5 shadow-md", style.border)}>
                <h3 className={cn("font-black flex items-center gap-2 mb-1", style.title)}>
                  <StepIcon className="w-4 h-4" /> {step.titre}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{step.content}</p>
              </div>
            </div>
          );
        })}
      </motion.section>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Professor Notes" mode — notepad/quote style, clinical pearls.           */
/* ----------------------------------------------------------------------- */

function ProfessorNotesContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 p-8 shadow-xl border border-slate-300 dark:border-slate-700">
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-4 bg-slate-800 dark:bg-slate-700 rounded-2xl shadow-lg text-white">
            <BookOpen className="w-10 h-10" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-slate-800/10 dark:bg-white/10 text-slate-700 dark:text-slate-300 rounded-full border border-slate-400/30">
              {mode.hero.badge}
            </span>
            <h1 className="text-2xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight mt-2">
              {mode.hero.titre}
            </h1>
          </div>
        </div>
      </motion.div>

      <motion.section variants={FADE_UP} className="space-y-4">
        {mode.quotes.map((quote, i) => (
          <div key={i} className="rounded-2xl bg-white dark:bg-slate-900 border-l-4 border-slate-400 dark:border-slate-600 p-6 shadow-sm">
            <p className="italic text-slate-700 dark:text-slate-300 text-base leading-relaxed">« {quote.text} »</p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-2 uppercase tracking-wide">— {quote.contexte}</p>
          </div>
        ))}
      </motion.section>

      <motion.section variants={FADE_UP} className="space-y-3">
        <div className="flex items-center gap-3 border-b-2 border-amber-500/30 pb-3">
          <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500"><Lightbulb className="w-6 h-6" /></div>
          <h2 className="text-xl font-black text-amber-600 dark:text-amber-400 uppercase tracking-wide">Perles Cliniques</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mode.perles.map((perle, i) => {
            const Icon = perle.type === "perle" ? Lightbulb : Info;
            const label = perle.type === "perle" ? "Perle" : "Astuce";
            return (
              <div key={i} className="flex gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
                <Icon className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  <strong>{label} :</strong> {perle.text}
                </p>
              </div>
            );
          })}
        </div>
      </motion.section>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Astuces Mnémotechniques" mode — clever mnemonics, acronyms.             */
/* ----------------------------------------------------------------------- */

function AstuceCard({ item }: { item: GastriteAstuceItem }) {
  return (
    <motion.div
      variants={FADE_UP}
      className={cn(
        "group p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-amber-300 dark:hover:border-amber-500/50",
        item.numero === 5 && "md:col-span-2"
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-5 h-5 text-amber-500" />
        <h3 className="font-black text-amber-700 dark:text-amber-400 uppercase text-sm tracking-wide">
          Astuce n°{item.numero} — {item.titre}
        </h3>
      </div>

      {item.acronyme && (
        <p className="text-2xl font-black tracking-tight mb-3">
          {item.acronyme.split("").map((char, i) => (
            <span key={i} className={ACRONYM_LETTER_PALETTE[i % ACRONYM_LETTER_PALETTE.length]}>
              {char}
            </span>
          ))}
        </p>
      )}
      {item.chiffres && <p className="text-4xl font-black text-amber-600 dark:text-amber-400 mb-2">{item.chiffres}</p>}
      {item.image && <p className="font-black text-slate-900 dark:text-white mb-2">{item.image}</p>}
      {item.citation && <p className="italic text-base font-bold text-slate-900 dark:text-white mb-2">« {item.citation} »</p>}

      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{item.content}</p>

      {item.details.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-500">
          {item.details.map((detail, i) => (
            <li key={i}>{detail}</li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function AstucesContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <motion.div variants={SCALE_IN} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 to-orange-600 dark:from-amber-900 dark:to-orange-950 p-8 shadow-2xl border border-amber-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-black/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-4 bg-white/20 backdrop-blur-md rounded-2xl shadow-lg text-white">
            <Brain className="w-10 h-10" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              {mode.hero.badge}
            </span>
            <h1 className="text-3xl md:text-5xl font-black text-white uppercase tracking-tight mt-2 mb-2 drop-shadow-md">
              {mode.hero.titre}
            </h1>
            <p className="text-sm md:text-base font-medium text-amber-50 leading-relaxed max-w-2xl">{mode.hero.intro}</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {mode.items.map((item) => (
          <AstuceCard key={item.numero} item={item} />
        ))}
      </div>
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* Shell — tombabilité badge + pill nav + mode dispatch.                    */
/* ----------------------------------------------------------------------- */

export function GastriteResumeStudio({ data }: { data: GastriteResumeData }) {
  const [activeModeId, setActiveModeId] = useState<GastriteResumeMode["id"]>(MODES[0].id);
  const activeMode = data.modes.find((m) => m.id === activeModeId);

  return (
    <div className="animate-fade-in">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/30">
        <Flame className="h-4 w-4" />
        Tombabilité à l&apos;examen : {data.tombabilite}%
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {MODES.map((m) => {
          const isActive = m.id === activeModeId;
          return (
            <button
              key={m.id}
              onClick={() => setActiveModeId(m.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200",
                isActive
                  ? "border-teal-600 bg-teal-600 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      {activeMode && activeModeId === "smart" && <MasterclassSummary mode={activeMode} />}
      {activeMode && activeModeId === "exam" && <ExamSummaryContent mode={activeMode} />}
      {activeMode && activeModeId === "cheatsheet" && <CheatSheetContent mode={activeMode} />}
      {activeMode && activeModeId === "guideline" && <GuidelineSummaryContent mode={activeMode} />}
      {activeMode && activeModeId === "professor" && <ProfessorNotesContent mode={activeMode} />}
      {activeMode && activeModeId === "astuces" && <AstucesContent mode={activeMode} />}
    </div>
  );
}
