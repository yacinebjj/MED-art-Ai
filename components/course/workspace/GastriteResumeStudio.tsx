"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Sparkles,
  Star,
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
  Siren,
  ClipboardList,
  ClipboardCheck,
  Crosshair,
  Syringe,
  EyeOff,
  Zap,
  Flame,
  Filter,
  ArrowLeftRight,
  Infinity as InfinityIcon,
  Signpost,
  TrendingUp,
  Calculator,
  Gauge,
  Users,
  HeartPulse,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolTour } from "@/lib/onboarding/onboarding-context";
import type {
  GastriteGuidelineStep,
  GastriteResumeCard,
  GastriteResumeData,
  GastriteResumeMode,
  GastriteResumeSection,
  GastriteResumeTable,
} from "@/lib/course-slug-content";

interface GastriteResumeModeChrome {
  id: GastriteResumeMode["id"];
  label: string;
  icon: LucideIcon;
}

/**
 * The Résumé's three modes (product order: « Cheat Sheet » and « Astuces »
 * removed 2026-11-18, « Professor Notes » 2026-11-19). A résumé saved before
 * still holds those modes in its data; they are simply no longer offered.
 */
const MODES: GastriteResumeModeChrome[] = [
  { id: "smart", label: "Smart Summary", icon: Sparkles },
  { id: "exam", label: "Exam Summary", icon: Star },
  { id: "guideline", label: "Guideline Summary", icon: Landmark },
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

/** Smart Summary's sections beyond the seventh (complications, terrains, surveillance…) — same section look, one tone each. */
const EXTRA_SECTION_STYLES: { icon: LucideIcon; rule: string; iconWrap: string; title: string; dot: string }[] = [
  { icon: Flame, rule: "border-rose-500/30", iconWrap: "bg-rose-500/10 text-rose-500", title: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
  { icon: Users, rule: "border-sky-500/30", iconWrap: "bg-sky-500/10 text-sky-500", title: "text-sky-600 dark:text-sky-400", dot: "bg-sky-500" },
  { icon: HeartPulse, rule: "border-violet-500/30", iconWrap: "bg-violet-500/10 text-violet-500", title: "text-violet-600 dark:text-violet-400", dot: "bg-violet-500" },
  { icon: ClipboardList, rule: "border-emerald-500/30", iconWrap: "bg-emerald-500/10 text-emerald-500", title: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
];

/** Pièges-category tones cycle in the same fixed rose/blue/purple/amber order the original 4 categories used. */
const PIEGE_CATEGORY_TONES = [
  { pill: "bg-rose-600", rule: "bg-rose-200 dark:bg-rose-900/40", card: "bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-500/40 shadow-[0_0_25px_-8px_rgba(244,63,94,0.4)]", title: "text-rose-700 dark:text-rose-400", body: "text-rose-800 dark:text-rose-300" },
  { pill: "bg-blue-600", rule: "bg-blue-200 dark:bg-blue-900/40", card: "bg-blue-50 dark:bg-blue-950/40 border-2 border-blue-300 dark:border-blue-500/40 shadow-[0_0_25px_-8px_rgba(59,130,246,0.4)]", title: "text-blue-700 dark:text-blue-400", body: "text-blue-800 dark:text-blue-300" },
  { pill: "bg-purple-600", rule: "bg-purple-200 dark:bg-purple-900/40", card: "bg-purple-50 dark:bg-purple-950/40 border-2 border-purple-300 dark:border-purple-500/40 shadow-[0_0_25px_-8px_rgba(168,85,247,0.4)]", title: "text-purple-700 dark:text-purple-400", body: "text-purple-800 dark:text-purple-300" },
  { pill: "bg-amber-500", rule: "bg-amber-200 dark:bg-amber-900/40", card: "bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-500/40 shadow-[0_0_25px_-8px_rgba(245,158,11,0.4)]", title: "text-amber-700 dark:text-amber-400", body: "text-amber-800 dark:text-amber-300" },
];

/**
 * One "Pièges QCM & Perles cliniques" line in the exam format the Résumé
 * prompt asks for since 2026-11-12 (lib/ai/studio-prompts.ts):
 * `🚨 **Piège:** … ➡️ **Pourquoi ?** …` or `💎 **Perle:** … ➡️ **Pourquoi ?** …`.
 * Null for any other text (older résumés), which renders as before.
 */
const EXAM_POINT_RE = /^\s*(?:🚨|💎)?\s*\*\*\s*(Piège|Perle)\s*:?\s*\*\*\s*:?\s*([\s\S]+?)\s*(?:➡️|➡|→)\s*\*\*\s*Pourquoi\s*\??\s*\*\*\s*:?\s*([\s\S]+?)\s*$/i;

function parseExamPoint(text: string): { kind: "piege" | "perle"; statement: string; why: string } | null {
  const match = typeof text === "string" ? text.match(EXAM_POINT_RE) : null;
  if (!match) return null;
  return { kind: match[1].toLowerCase() === "perle" ? "perle" : "piege", statement: match[2], why: match[3] };
}

/** The verdict a « sniper » trap's why opens with (`**FAUX** — …`, lib/ai/studio-resume.ts), split from the rest. */
const VERDICT_RE = /^\s*\*\*\s*(VRAI|FAUX|TRUE|FALSE)\s*\*\*\s*[—–:-]\s*/i;

function splitVerdict(why: string): { verdict: "true" | "false" | null; rest: string } {
  const match = why.match(VERDICT_RE);
  if (!match) return { verdict: null, rest: why };
  const word = match[1].toUpperCase();
  return { verdict: word === "VRAI" || word === "TRUE" ? "true" : "false", rest: why.slice(match[0].length) };
}

/** `**bold**` runs as <strong>, everything else as plain text; unbalanced markers (or none) leave the text exactly as it is. */
function renderInlineBold(text: string): ReactNode {
  const parts = text.split("**");
  if (parts.length < 3 || parts.length % 2 === 0) return text;
  return parts.map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part));
}

const BULLET_LINE_RE = /^[-•–]\s+(.*)$/;

/**
 * A text field of the Résumé. One line (every résumé saved before
 * 2026-11-18, most fields since): a paragraph with `className`, exactly as
 * before. Several lines (a Guideline step: a lead sentence, then « - » lines):
 * the lines become paragraphs, the « - » lines a bullet list.
 */
function RichBlock({ text, className }: { text: string; className?: string }) {
  if (!text.includes("\n")) return <p className={className}>{renderInlineBold(text)}</p>;
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    const list = bullets;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="mt-1.5 space-y-1.5">
        {list.map((bullet, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
            <span className="min-w-0">{renderInlineBold(bullet)}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const bullet = line.match(BULLET_LINE_RE);
    if (bullet) {
      bullets.push(bullet[1]);
    } else {
      flush();
      blocks.push(
        <p key={`p-${blocks.length}`} className={blocks.length > 0 ? "mt-1.5" : undefined}>
          {renderInlineBold(line)}
        </p>
      );
    }
  }
  flush();
  return <div className={className}>{blocks}</div>;
}

/** Guideline timeline steps escalate teal → cyan → blue → emerald — position-based, matches the original 4-step sequence. */
const GUIDELINE_STEP_STYLES = [
  { dot: "bg-teal-500 shadow-teal-500/40", border: "border-teal-100 dark:border-teal-900/30", title: "text-teal-700 dark:text-teal-400", icon: Siren },
  { dot: "bg-cyan-500 shadow-cyan-500/40", border: "border-cyan-100 dark:border-cyan-900/30", title: "text-cyan-700 dark:text-cyan-400", icon: CheckCircle2 },
  { dot: "bg-blue-500 shadow-blue-500/40", border: "border-blue-100 dark:border-blue-900/30", title: "text-blue-700 dark:text-blue-400", icon: Microscope },
  { dot: "bg-emerald-500 shadow-emerald-500/40", border: "border-emerald-100 dark:border-emerald-900/30", title: "text-emerald-700 dark:text-emerald-400", icon: Crosshair },
];

function GenericTable({ table }: { table: GastriteResumeTable }) {
  if (!table.headers.length) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg">
      {/* Scrolls sideways on a phone instead of clipping a wide table. */}
      <div className="overflow-x-auto">
        <table className={cn("w-full text-left text-sm md:text-base border-collapse", table.headers.length >= 4 && "min-w-[40rem]")}>
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900/60">
              {table.headers.map((h, i) => (
                <th key={i} className="p-3 md:p-4 font-black text-slate-900 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className={cn("p-3 md:p-4 align-top text-slate-600 dark:text-slate-300", ci === 0 && "font-bold text-slate-900 dark:text-slate-100")}>
                    {renderInlineBold(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A section's content cards in a two-column grid: a text card (its paragraph) or a list card (its points). */
function SectionCards({ cards, accent }: { cards: GastriteResumeCard[]; accent: string }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {cards.map((card, i) => (
        <div key={`${i}-${card.titre}`} className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          {card.titre && <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase mb-2">{card.titre}</h3>}
          {card.content && <RichBlock text={card.content} className="text-sm leading-relaxed text-slate-600 dark:text-slate-300" />}
          {card.items.length > 0 && (
            <ul className={cn("text-sm leading-relaxed text-slate-600 dark:text-slate-300 space-y-2", card.content && "mt-2")}>
              {card.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden className={cn("mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full", accent)} />
                  <span className="min-w-0">{renderInlineBold(item)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** A section's plain points, one check per line. */
function SectionItems({ items, iconClass }: { items: string[]; iconClass: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-3 text-sm md:text-base text-slate-700 dark:text-slate-300">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 items-start">
          <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} />
          <div className="min-w-0">{renderInlineBold(item)}</div>
        </li>
      ))}
    </ul>
  );
}

/** Smart Summary's section 8 onward (complications, terrains particuliers, surveillance…): whatever the section holds, in order. */
function ExtraSection({ section, index }: { section: GastriteResumeSection; index: number }) {
  const style = EXTRA_SECTION_STYLES[index % EXTRA_SECTION_STYLES.length];
  const Icon = style.icon;
  return (
    <motion.section variants={FADE_UP} className="space-y-5">
      <div className={cn("flex items-center gap-3 border-b-2 pb-3", style.rule)}>
        <div className={cn("p-2 rounded-lg", style.iconWrap)}>
          <Icon className="w-6 h-6" />
        </div>
        <h2 className={cn("text-xl md:text-2xl font-black uppercase tracking-wide", style.title)}>
          {section.numero}. {section.titre}
        </h2>
      </div>
      {section.intro && <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(section.intro)}</p>}
      <SectionCards cards={section.cards} accent={style.dot} />
      <GenericTable table={section.table} />
      {section.rows.length > 0 && (
        <div className="space-y-3">
          {section.rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-800">
              <span className="font-bold text-slate-700 dark:text-slate-200">{renderInlineBold(row.label ?? "")}</span>
              {row.badge && <span className="px-3 py-1 text-xs font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{row.badge}</span>}
            </div>
          ))}
        </div>
      )}
      <SectionItems items={section.items} iconClass={style.title} />
      {section.outro && <p className="text-sm md:text-base font-semibold text-slate-700 dark:text-slate-300 leading-relaxed">{renderInlineBold(section.outro)}</p>}
    </motion.section>
  );
}

/* ----------------------------------------------------------------------- */
/* "Smart Summary" mode — the rich, data-driven "Masterclass" summary.      */
/* ----------------------------------------------------------------------- */

function MasterclassSummary({ mode }: { mode: GastriteResumeMode }) {
  const [s1, s2, s3, s4, s5, s6, s7, ...extraSections] = mode.sections;

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
            <div className="flex flex-wrap items-center gap-3 mb-2">
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
              {renderInlineBold(mode.hero.intro)}
            </p>
          </div>
        </div>
      </motion.div>

      {/* SECTION 1: L'Essentiel — the text cards and the alarm list(s), in their order. */}
      {s1 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <div className="flex items-center gap-3 border-b-2 border-teal-500/30 pb-3">
            <div className="p-2 bg-teal-500/10 rounded-lg text-teal-500"><Activity className="w-6 h-6" /></div>
            <h2 className="text-xl md:text-2xl font-black text-teal-600 dark:text-teal-400 uppercase tracking-wide">
              {s1.numero}. {s1.titre}
            </h2>
          </div>
          {s1.intro && <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s1.intro)}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {s1.cards.map((card, i) =>
              card.type === "list" ? (
                <div key={`${i}-${card.titre}`} className="bg-rose-50 dark:bg-rose-950/40 p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm relative overflow-hidden">
                  <div className="absolute right-0 top-0 w-32 h-32 bg-rose-500/10 blur-2xl rounded-full" />
                  <h3 className="text-sm font-black text-rose-700 dark:text-rose-400 uppercase mb-2 flex items-center gap-2 relative z-10">
                    <ShieldAlert className="w-4 h-4" /> {card.titre}
                  </h3>
                  <ul className="text-sm leading-relaxed text-rose-800 dark:text-rose-300 space-y-2 relative z-10 font-medium">
                    {card.items.map((item, j) => (
                      <li key={j}>❌ {renderInlineBold(item)}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div key={`${i}-${card.titre}`} className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-teal-300 dark:hover:border-teal-500/50 transition-colors">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase mb-2 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-teal-500" /> {card.titre}
                  </h3>
                  <RichBlock text={card.content ?? ""} className="text-sm leading-relaxed text-slate-600 dark:text-slate-300" />
                </div>
              )
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
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s2.intro)}</p>
          <GenericTable table={s2.table} />
          <SectionCards cards={s2.cards} accent="bg-indigo-500" />
          <SectionItems items={s2.items} iconClass="text-indigo-500" />
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s2.outro)}</p>
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
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s3.intro)}</p>
          <GenericTable table={s3.table} />
          <SectionCards cards={s3.cards} accent="bg-purple-500" />
          <SectionItems items={s3.items} iconClass="text-purple-500" />
          {s3.outro && <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s3.outro)}</p>}
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
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s4.intro)}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {s4.cards.map((card, i) => (
              <div key={`${i}-${card.titre}`} className="flex gap-4 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className={cn("w-1.5 h-full rounded-full shrink-0", AMBER_BAR_SHADES[i % AMBER_BAR_SHADES.length])} />
                <div className="min-w-0">
                  <h4 className="font-bold text-slate-900 dark:text-white mb-1">{card.titre}</h4>
                  <RichBlock text={card.content ?? ""} className="text-sm text-slate-600 dark:text-slate-400" />
                  {card.items.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                      {card.items.map((item, j) => (
                        <li key={j}>• {renderInlineBold(item)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
          <SectionItems items={s4.items} iconClass="text-amber-500" />
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
          {s5.intro && <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s5.intro)}</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {s5.cards.map((card, i) => {
              const Icon = SECTION5_ICONS[i % SECTION5_ICONS.length];
              return (
                <div key={`${i}-${card.titre}`} className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-md">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white mb-2">{card.titre}</h3>
                  {card.type === "list" ? (
                    <ul className="text-sm space-y-1.5 text-slate-600 dark:text-slate-400">
                      {card.items.map((item, j) => (
                        <li key={j}>• {renderInlineBold(item)}</li>
                      ))}
                    </ul>
                  ) : (
                    <RichBlock text={card.content ?? ""} className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed" />
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
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s6.intro)}</p>
            <div className="space-y-3">
              {s6.rows.map((row, i) => {
                const tone = SECTION6_ROW_TONES[i % SECTION6_ROW_TONES.length];
                return (
                  <div key={`${i}-${row.label}`} className={cn("flex justify-between items-center gap-3 bg-white dark:bg-slate-900 p-3 rounded-lg shadow-sm", tone.border)}>
                    <span className="font-bold text-slate-700 dark:text-slate-200">{renderInlineBold(row.label ?? "")}</span>
                    <span className={cn("shrink-0 px-3 py-1 text-xs font-bold rounded-full", tone.badge)}>{row.badge}</span>
                  </div>
                );
              })}
            </div>
            <SectionItems items={s6.items} iconClass="text-cyan-600 dark:text-cyan-400" />
            {s6.outro && <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 leading-relaxed">{renderInlineBold(s6.outro)}</p>}
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
            {s7.intro && <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(s7.intro)}</p>}
            <ul className="space-y-4 text-sm md:text-base text-slate-700 dark:text-slate-300">
              {s7.items.map((item, i) => {
                const Icon = SECTION7_ICONS[i % SECTION7_ICONS.length];
                return (
                  <li key={i} className="flex gap-3 items-start">
                    <div className="mt-1 bg-emerald-200 dark:bg-emerald-800/50 p-1 rounded text-emerald-700 dark:text-emerald-400">
                      <Icon className="w-3 h-3" />
                    </div>
                    <div className="min-w-0">{renderInlineBold(item)}</div>
                  </li>
                );
              })}
            </ul>
            <SectionCards cards={s7.cards} accent="bg-emerald-500" />
          </motion.section>
        )}
      </div>

      {/* SECTION 8 onward: complications, terrains particuliers, surveillance… (résumés since 2026-11-18). */}
      {extraSections.map((section, i) => (
        <ExtraSection key={`${section.numero}-${section.titre}`} section={section} index={i} />
      ))}
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Exam Summary" mode — high-yield facts, DDx comparison table, exam traps. */
/* ----------------------------------------------------------------------- */

/** A « sniper » trap family's look, matched on its (localized) category name. */
const TRAP_FAMILY_STYLES: { match: RegExp; icon: LucideIcon; tone: number }[] = [
  { match: /condition/i, icon: Filter, tone: 3 },
  { match: /invers/i, icon: ArrowLeftRight, tone: 2 },
  { match: /absolu/i, icon: InfinityIcon, tone: 0 },
  { match: /iatrog/i, icon: Pill, tone: 1 },
  { match: /piste|herring/i, icon: Signpost, tone: 2 },
  { match: /escala/i, icon: TrendingUp, tone: 3 },
  { match: /calcul/i, icon: Calculator, tone: 1 },
];

function ExamHero({ mode }: { mode: GastriteResumeMode }) {
  return (
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
          <p className="text-sm md:text-base font-medium text-orange-50 leading-relaxed max-w-2xl">{renderInlineBold(mode.hero.intro)}</p>
        </div>
      </div>
    </motion.div>
  );
}

function ExamSectionTitle({ icon: Icon, children, tone }: { icon: LucideIcon; children: ReactNode; tone: "orange" | "rose" | "emerald" | "sky" }) {
  const tones = {
    orange: { rule: "border-orange-500/30", wrap: "bg-orange-500/10 text-orange-500", title: "text-orange-600 dark:text-orange-400" },
    rose: { rule: "border-rose-500/30", wrap: "bg-rose-500/10 text-rose-500", title: "text-rose-600 dark:text-rose-400" },
    emerald: { rule: "border-emerald-500/30", wrap: "bg-emerald-500/10 text-emerald-500", title: "text-emerald-600 dark:text-emerald-400" },
    sky: { rule: "border-sky-500/30", wrap: "bg-sky-500/10 text-sky-500", title: "text-sky-600 dark:text-sky-400" },
  }[tone];
  return (
    <div className={cn("flex items-center gap-3 border-b-2 pb-3", tones.rule)}>
      <div className={cn("p-2 rounded-lg", tones.wrap)}>
        <Icon className="w-6 h-6" />
      </div>
      <h2 className={cn("text-xl md:text-2xl font-black uppercase tracking-wide", tones.title)}>{children}</h2>
    </div>
  );
}

/** The exam's differential-diagnosis / red-herring table (orange header row, first row highlighted). */
function ExamDdxTable({ mode, highlightFirstRow }: { mode: GastriteResumeMode; highlightFirstRow: boolean }) {
  return (
    <div className="rounded-2xl border border-orange-100 dark:border-orange-900/30 shadow-lg">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-800 dark:to-amber-800">
              {mode.ddx_table.headers.map((h) => (
                <th key={h} className="p-3 font-black text-white">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
            {mode.ddx_table.rows.map((row, ri) => {
              const highlighted = highlightFirstRow && ri === 0;
              return (
                <tr key={ri} className={cn(highlighted ? "bg-teal-50/60 dark:bg-teal-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors")}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        "p-3",
                        !highlightFirstRow && "align-top",
                        highlighted
                          ? ci === 0
                            ? "font-black text-teal-600 dark:text-teal-400"
                            : "text-slate-700 dark:text-slate-300"
                          : ci === 0
                            ? "font-bold text-slate-800 dark:text-slate-200"
                            : "text-slate-600 dark:text-slate-400"
                      )}
                    >
                      {renderInlineBold(cell)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Exam Summary since 2026-11-18 — the « sniper » mode built on the QCM
 * annales DNA (lib/ai/studio-resume.ts): exact thresholds with their
 * conditions, the jury's traps by family (each a QCM statement with its
 * verdict and the rule that settles it), the true and false absolutes, the
 * clinical escalation, the red herrings.
 */
function SniperExamContent({ mode }: { mode: GastriteResumeMode }) {
  const thresholds = mode.sections.find((section) => section.table.headers.length > 0);
  const trueAbsolutes = mode.cards.find((card) => card.tone === "emerald");
  const falseAbsolutes = mode.cards.find((card) => card.tone === "rose");
  const otherCards = mode.cards.filter((card) => card !== trueAbsolutes && card !== falseAbsolutes);

  return (
    <>
      {thresholds && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <ExamSectionTitle icon={Gauge} tone="orange">{thresholds.titre}</ExamSectionTitle>
          <div className="overflow-hidden rounded-2xl border border-orange-100 dark:border-orange-900/30 shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-gradient-to-r from-orange-600 to-amber-600 dark:from-orange-800 dark:to-amber-800">
                    {thresholds.table.headers.map((h, i) => (
                      <th key={i} className="p-3 font-black text-white">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {thresholds.table.rows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-orange-50/40 dark:hover:bg-orange-950/20 transition-colors">
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className={cn(
                            "p-3 align-top",
                            ci === 0 && "font-bold text-slate-900 dark:text-slate-100",
                            ci === 1 && "font-black text-orange-700 dark:text-orange-300 whitespace-nowrap",
                            ci === 2 && "text-slate-700 dark:text-slate-300",
                            ci === 3 && "text-rose-700 dark:text-rose-300"
                          )}
                        >
                          {renderInlineBold(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.section>
      )}

      {mode.pieges.categories.length > 0 && (
        <motion.section variants={FADE_UP} className="space-y-8">
          <ExamSectionTitle icon={Crosshair} tone="rose">{mode.pieges.titre}</ExamSectionTitle>
          {mode.pieges.intro && <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(mode.pieges.intro)}</p>}

          {mode.pieges.categories.map((category, ci) => {
            const family = TRAP_FAMILY_STYLES.find((style) => style.match.test(category.nom));
            const tone = PIEGE_CATEGORY_TONES[(family?.tone ?? ci) % PIEGE_CATEGORY_TONES.length];
            const FamilyIcon = family?.icon ?? AlertTriangle;
            return (
              <div key={`${ci}-${category.nom}`} className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-xs font-black uppercase tracking-wide", tone.pill)}>
                    <FamilyIcon className="h-3.5 w-3.5" />
                    {category.nom}
                  </span>
                  <span className={cn("h-px flex-1", tone.rule)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {category.items.map((item) => {
                    const point = parseExamPoint(item.text);
                    const { verdict, rest } = splitVerdict(point?.why ?? "");
                    return (
                      <div key={item.numero} className={cn("relative overflow-hidden p-5 rounded-2xl", tone.card)}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className={cn("font-black flex items-center gap-2", tone.title)}>
                            <XCircle className="w-4 h-4" /> Piège n°{item.numero}
                          </h3>
                          {verdict && (
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-white",
                                verdict === "true" ? "bg-emerald-600" : "bg-rose-600"
                              )}
                            >
                              {verdict === "true" ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
                              {verdict === "true" ? "Vrai" : "Faux"}
                            </span>
                          )}
                        </div>
                        {point ? (
                          <>
                            <p className={cn("text-sm font-semibold", tone.body)}>« {renderInlineBold(point.statement)} »</p>
                            <p className={cn("mt-2 text-sm", tone.body)}>
                              ➡️ <strong className="font-bold">Pourquoi ?</strong> {renderInlineBold(rest)}
                            </p>
                          </>
                        ) : (
                          <p className={cn("text-sm", tone.body)}>{renderInlineBold(item.text)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </motion.section>
      )}

      {(trueAbsolutes || falseAbsolutes) && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <ExamSectionTitle icon={InfinityIcon} tone="emerald">Mots absolus</ExamSectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[trueAbsolutes, falseAbsolutes].map((card, i) =>
              card ? (
                <div
                  key={i}
                  className={cn(
                    "rounded-2xl border-2 p-5",
                    i === 0 ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-950/30" : "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-950/30"
                  )}
                >
                  <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-black uppercase", i === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
                    {i === 0 ? <CircleCheck className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
                    {card.titre}
                  </h3>
                  <ul className={cn("space-y-2.5 text-sm leading-relaxed", i === 0 ? "text-emerald-900 dark:text-emerald-100" : "text-rose-900 dark:text-rose-100")}>
                    {card.items.map((item, j) => (
                      <li key={j}>{renderInlineBold(item)}</li>
                    ))}
                  </ul>
                </div>
              ) : null
            )}
          </div>
        </motion.section>
      )}

      {mode.steps.length > 0 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <ExamSectionTitle icon={TrendingUp} tone="sky">Escalade clinique</ExamSectionTitle>
          <ol className="space-y-3">
            {mode.steps.map((step) => (
              <li key={step.numero} className="flex gap-3 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm dark:border-sky-900/30 dark:bg-slate-900">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-xs font-black text-white shadow-md shadow-sky-500/30">{step.numero}</span>
                <div className="min-w-0">
                  <h3 className="font-black text-sky-700 dark:text-sky-300">{step.titre}</h3>
                  <RichBlock text={step.content} className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400" />
                </div>
              </li>
            ))}
          </ol>
        </motion.section>
      )}

      {otherCards.length > 0 && <SectionCards cards={otherCards} accent="bg-orange-500" />}

      {mode.ddx_table.headers.length > 0 && (
        <motion.section variants={FADE_UP} className="space-y-5">
          <ExamSectionTitle icon={Signpost} tone="orange">{mode.ddx_table.titre}</ExamSectionTitle>
          {mode.ddx_table.intro && <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{renderInlineBold(mode.ddx_table.intro)}</p>}
          <ExamDdxTable mode={mode} highlightFirstRow={false} />
        </motion.section>
      )}
    </>
  );
}

/** Exam Summary as written before 2026-11-18: the DDx table, then the traps (and pearls). */
function LegacyExamContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <>
      {/* Section : DDx */}
      <motion.section variants={FADE_UP} className="space-y-5">
        <div className="flex items-center gap-3 border-b-2 border-orange-500/30 pb-3">
          <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500"><Stethoscope className="w-6 h-6" /></div>
          <h2 className="text-xl md:text-2xl font-black text-orange-600 dark:text-orange-400 uppercase tracking-wide">
            {mode.ddx_table.titre}
          </h2>
        </div>

        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">{mode.ddx_table.intro}</p>

        {/* Mobile portrait fix (Point 6): `overflow-x-auto` on an INNER
            wrapper (the outer one keeps the rounded corners/border fixed in
            place) lets a multi-column DDx table scroll horizontally at its
            natural width instead of being clipped off a narrow phone. */}
        <ExamDdxTable mode={mode} highlightFirstRow />
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
                {category.items.map((item) => {
                  const point = parseExamPoint(item.text);
                  const isPerle = point?.kind === "perle";
                  return (
                    <div key={item.numero} className={cn("relative overflow-hidden p-5 rounded-2xl", tone.card)}>
                      <h3 className={cn("font-black mb-1 flex items-center gap-2", tone.title)}>
                        {isPerle ? <Lightbulb className="w-4 h-4" /> : <XCircle className="w-4 h-4" />} {isPerle ? "Perle" : "Piège"} n°{item.numero}
                      </h3>
                      {point ? (
                        <>
                          <p className={cn("text-sm", tone.body)}>{point.statement}</p>
                          <p className={cn("mt-2 text-sm", tone.body)}>
                            ➡️ <strong className="font-bold">Pourquoi ?</strong> {point.why}
                          </p>
                        </>
                      ) : (
                        <p className={cn("text-sm", tone.body)}>{renderInlineBold(item.text)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </motion.section>
    </>
  );
}

/**
 * A résumé written since 2026-11-18 has the « sniper » Exam Summary: its
 * thresholds (a section), absolutes (cards), escalation (steps), traps whose
 * why opens with a verdict — or, at the least, no differential table of the
 * old three-column kind.
 */
function isSniperExam(mode: GastriteResumeMode): boolean {
  if (mode.sections.length > 0 || mode.cards.length > 0 || mode.steps.length > 0 || mode.ddx_table.headers.length === 0) return true;
  return mode.pieges.categories.some((category) => category.items.some((item) => splitVerdict(parseExamPoint(item.text)?.why ?? "").verdict !== null));
}

function ExamSummaryContent({ mode }: { mode: GastriteResumeMode }) {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="w-full mx-auto space-y-10 font-sans text-slate-800 dark:text-slate-200 pb-4"
    >
      <ExamHero mode={mode} />
      {isSniperExam(mode) ? <SniperExamContent mode={mode} /> : <LegacyExamContent mode={mode} />}
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* "Guideline Summary" mode — vertical clinical-pathway timeline.           */
/* ----------------------------------------------------------------------- */

function GuidelineStepCard({ step, index, isLast }: { step: GastriteGuidelineStep; index: number; isLast: boolean }) {
  const style = GUIDELINE_STEP_STYLES[index % GUIDELINE_STEP_STYLES.length];
  const StepIcon = style.icon;
  return (
    <div className={cn("relative", !isLast && "mb-8")}>
      <div className={cn("absolute -left-10 top-0 flex h-8 w-8 items-center justify-center rounded-full text-white font-black text-sm shadow-lg", style.dot)}>
        {step.numero}
      </div>
      <div className={cn("rounded-2xl bg-white dark:bg-slate-900 border p-5 shadow-md", style.border)}>
        <h3 className={cn("font-black flex items-center gap-2 mb-1", style.title)}>
          <StepIcon className="w-4 h-4 shrink-0" /> {step.titre}
        </h3>
        <RichBlock text={step.content} className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed" />
      </div>
    </div>
  );
}

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
            <p className="text-sm text-teal-50 mt-1 max-w-xl">{renderInlineBold(mode.hero.intro)}</p>
          </div>
        </div>
      </motion.div>

      <motion.section variants={FADE_UP} className="relative pl-10">
        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gradient-to-b from-teal-400 via-cyan-400 to-emerald-400 rounded-full" />

        {mode.steps.map((step, i) => (
          <GuidelineStepCard key={step.numero} step={step} index={i} isLast={i === mode.steps.length - 1} />
        ))}
      </motion.section>

      {/* Synthesis boxes (contre-indications, critères d'hospitalisation…) — résumés since 2026-11-18. */}
      {mode.cards.length > 0 && (
        <motion.section variants={FADE_UP} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mode.cards.map((card, i) => (
            <div key={`${i}-${card.titre}`} className="rounded-2xl border border-teal-200 bg-teal-50/70 p-5 shadow-sm dark:border-teal-900/40 dark:bg-teal-950/20">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase text-teal-700 dark:text-teal-300">
                <ClipboardCheck className="h-4 w-4 shrink-0" /> {card.titre}
              </h3>
              {card.content && <RichBlock text={card.content} className="mb-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300" />}
              <ul className="space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {card.items.map((item, j) => (
                  <li key={j} className="flex gap-2">
                    <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span className="min-w-0">{renderInlineBold(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </motion.section>
      )}
    </motion.div>
  );
}

/* ----------------------------------------------------------------------- */
/* Shell — tombabilité badge + pill nav + mode dispatch.                    */
/* ----------------------------------------------------------------------- */

export function GastriteResumeStudio({ data }: { data: GastriteResumeData }) {
  const [activeModeId, setActiveModeId] = useState<GastriteResumeMode["id"]>(MODES[0].id);
  const activeMode = data.modes.find((m) => m.id === activeModeId);
  useToolTour("tool-resume");

  return (
    <div className="animate-fade-in">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/30" data-tour="res-score">
        <Flame className="h-4 w-4" />
        Tombabilité à l&apos;examen : {data.tombabilite}%
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2" data-tour="res-modes">
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
      {activeMode && activeModeId === "guideline" && <GuidelineSummaryContent mode={activeMode} />}
    </div>
  );
}
