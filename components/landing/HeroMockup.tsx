"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BarChart3, Brain, Check, CheckCheck, FileText, Flame, LayoutDashboard, MessagesSquare, Search, Sparkles, Stethoscope, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { TiltCard } from "./primitives";

type Screen = "dashboard" | "studio" | "group";

const SCREENS: { id: Screen; icon: typeof LayoutDashboard; fr: string; en: string }[] = [
  { id: "dashboard", icon: LayoutDashboard, fr: "Cockpit", en: "Cockpit" },
  { id: "studio", icon: Sparkles, fr: "Studio IA", en: "AI Studio" },
  { id: "group", icon: MessagesSquare, fr: "Groupe", en: "Group" },
];

const CYCLE_MS = 5200;

function DashboardScreen({ fr }: { fr: boolean }) {
  const modules = [
    { name: fr ? "Cardiologie" : "Cardiology", pct: 82, tint: "from-emerald-400 to-teal-400" },
    { name: fr ? "Pneumologie" : "Pulmonology", pct: 64, tint: "from-cyan-400 to-sky-400" },
    { name: fr ? "Néphrologie" : "Nephrology", pct: 37, tint: "from-violet-400 to-fuchsia-400" },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-2.5 p-3">
      <div className="col-span-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-slate-400">
        <Search className="h-3.5 w-3.5 text-cyan-300" />
        {fr ? "Rechercher cours, modules, notes…" : "Search courses, modules, notes…"}
        <span className="ml-auto rounded border border-white/10 px-1.5 text-[9px]">Ctrl K</span>
      </div>
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-orange-500/15 to-rose-500/10 p-2.5">
        <Flame className="h-4 w-4 text-orange-400" />
        <p className="mt-1.5 text-xl font-black text-white">12</p>
        <p className="text-[9px] text-slate-400">{fr ? "jours de série" : "day streak"}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 p-2.5">
        <Target className="h-4 w-4 text-cyan-300" />
        <p className="mt-1.5 text-xl font-black text-white">87%</p>
        <p className="text-[9px] text-slate-400">{fr ? "précision QCM" : "MCQ accuracy"}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/15 to-fuchsia-500/10 p-2.5">
        <Brain className="h-4 w-4 text-violet-300" />
        <p className="mt-1.5 text-xl font-black text-white">50</p>
        <p className="text-[9px] text-slate-400">{fr ? "flashcards / lot" : "cards / batch"}</p>
      </div>
      <div className="col-span-3 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
        {modules.map((m, i) => (
          <div key={m.name}>
            <div className="mb-1 flex justify-between text-[10px] text-slate-300">
              <span>{m.name}</span>
              <span className="font-bold text-white">{m.pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div className={cn("h-full rounded-full bg-gradient-to-r", m.tint)} initial={{ width: 0 }} animate={{ width: `${m.pct}%` }} transition={{ duration: 1, delay: 0.15 * i, ease: "easeOut" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EXPLANATION_FR = "L'IDM inférieur résulte le plus souvent de l'occlusion de la coronaire droite : sus-décalage en DII, DIII, aVF. Rechercher une extension au VD (V3R-V4R) ; proscrire les dérivés nitrés si hypotension.";
const EXPLANATION_EN = "Inferior MI usually results from right coronary occlusion: ST elevation in II, III, aVF. Look for RV extension (V3R-V4R); avoid nitrates if hypotensive.";

function StudioScreen({ fr }: { fr: boolean }) {
  const reduce = useReducedMotion();
  const full = fr ? EXPLANATION_FR : EXPLANATION_EN;
  const [typed, setTyped] = useState(reduce ? full.length : 0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setTyped((n) => (n >= full.length ? n : n + 3)), 28);
    return () => window.clearInterval(id);
  }, [full, reduce]);
  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-red-600 text-white">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold text-white">Cardio — {fr ? "Syndromes coronariens.pdf" : "Coronary syndromes.pdf"}</p>
          <p className="text-[9px] text-emerald-300">{fr ? "✓ 7 formats générés" : "✓ 7 formats generated"}</p>
        </div>
      </div>
      <div className="flex-1 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-2.5">
        <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-cyan-300">{fr ? "Explication ultra-détaillée" : "Ultra-detailed explanation"}</p>
        <p className="text-[11px] leading-relaxed text-slate-200">
          {full.slice(0, typed)}
          {typed < full.length && <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-cyan-300 align-middle" />}
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
        <p className="text-[10px] font-semibold text-white">{fr ? "QCM 12 — Territoire de DII, DIII, aVF ?" : "MCQ 12 — Territory of II, III, aVF?"}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {[fr ? "Antérieur" : "Anterior", fr ? "Inférieur" : "Inferior", fr ? "Latéral" : "Lateral", fr ? "Septal" : "Septal"].map((option, i) => (
            <span
              key={option}
              className={cn(
                "flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px]",
                i === 1 ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-200" : "border-white/10 text-slate-400"
              )}
            >
              {i === 1 && <Check className="h-3 w-3" />}
              {option}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupScreen({ fr }: { fr: boolean }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? 4 : 0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setStep((s) => Math.min(4, s + 1)), 750);
    return () => window.clearInterval(id);
  }, [reduce]);
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-[11px] font-black text-white">C</span>
        <div>
          <p className="text-[11px] font-bold text-white">Cardio — Promo 4A</p>
          <p className="text-[9px] text-emerald-300">{step >= 2 ? (fr ? "Sara est en train d'écrire…" : "Sara is typing…") : fr ? "6 en ligne" : "6 online"}</p>
        </div>
      </div>
      {/* Messages only ever appear (step grows), so no AnimatePresence: it added exit bookkeeping for nothing. */}
        {step >= 1 && (
          <motion.div key="g1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-[85%] rounded-xl rounded-tl-sm border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[10px] text-slate-200">
            <span className="font-bold text-cyan-300">Amine</span> · {fr ? "Fiche choc cardiogénique 👇" : "Cardiogenic shock sheet 👇"}
            <span className="mt-1 flex items-center gap-1.5 rounded-lg bg-black/20 px-2 py-1 text-[9px]">
              <FileText className="h-3 w-3 text-rose-300" /> choc-cardiogenique.pdf · 1.8 Mo
            </span>
            <span className="mt-1 flex gap-1 text-[10px]">
              <span className="rounded-full bg-white/10 px-1.5">🔥 4</span>
              <span className="rounded-full bg-white/10 px-1.5">🧠 2</span>
              <span className="rounded-full bg-white/10 px-1.5">🩺 3</span>
            </span>
          </motion.div>
        )}
        {step >= 3 && (
          <motion.div key="g3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="ml-auto w-[80%] rounded-xl rounded-tr-sm bg-gradient-to-br from-cyan-500 to-blue-600 px-2.5 py-1.5 text-[10px] text-white">
            <span className="flex items-center gap-1 font-bold">
              <BarChart3 className="h-3 w-3" /> {fr ? "On révise quoi ce soir ?" : "What do we review tonight?"}
            </span>
            {[
              { label: fr ? "Cardiologie" : "Cardiology", pct: 67 },
              { label: fr ? "Pneumologie" : "Pulmonology", pct: 33 },
            ].map((o) => (
              <span key={o.label} className="relative mt-1 block overflow-hidden rounded-md bg-white/15 px-1.5 py-0.5">
                <motion.span className="absolute inset-y-0 left-0 bg-white/25" initial={{ width: 0 }} animate={{ width: `${o.pct}%` }} transition={{ duration: 0.9 }} />
                <span className="relative flex justify-between">
                  {o.label}
                  <b>{o.pct}%</b>
                </span>
              </span>
            ))}
            <span className="mt-0.5 flex justify-end">
              <CheckCheck className="h-3 w-3 text-cyan-100" />
            </span>
          </motion.div>
        )}
        {step >= 4 && (
          <motion.div key="g4" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-[85%] rounded-xl rounded-tl-sm border border-amber-300/40 bg-amber-300/10 px-2.5 py-1.5 text-[10px] text-amber-100">
            <span className="font-bold">Sara</span> · <span className="rounded bg-amber-300/30 px-1 font-bold">@{fr ? "toi" : "you"}</span> {fr ? "tu fais le cas clinique ?" : "can you take the clinical case?"}
          </motion.div>
        )}
    </div>
  );
}

/** Interactive replica of the real app in the hero: three live screens, auto-cycling, clickable. */
export function HeroMockup() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setScreen((current) => SCREENS[(SCREENS.findIndex((s) => s.id === current) + 1) % SCREENS.length].id);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  return (
    <div className="relative" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div aria-hidden className="absolute -inset-10 -z-10 rounded-[3rem] bg-[conic-gradient(from_180deg_at_50%_50%,rgba(34,211,238,0.35),rgba(139,92,246,0.3),rgba(16,185,129,0.25),rgba(34,211,238,0.35))] opacity-60 blur-3xl" />
      <TiltCard max={7} className="rounded-[1.75rem]">
        <div className="overflow-hidden rounded-[1.75rem] border border-white/15 bg-slate-950/80 shadow-[0_40px_120px_-30px_rgba(34,211,238,0.45)] backdrop-blur-xl">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
            <div className="ml-3 flex flex-1 justify-center gap-1" role="tablist" aria-label={fr ? "Aperçu de l'application" : "App preview"}>
              {SCREENS.map((s) => {
                const Icon = s.icon;
                const active = s.id === screen;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setScreen(s.id)}
                    className={cn(
                      "relative flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-colors sm:text-[11px]",
                      active ? "text-white" : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {active && <motion.span layoutId="hero-tab" className="absolute inset-0 rounded-lg bg-white/10" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
                    <Icon className="relative h-3 w-3" />
                    <span className="relative">{s[language]}</span>
                  </button>
                );
              })}
            </div>
            <Stethoscope className="h-3.5 w-3.5 text-cyan-300" />
          </div>
          <div className="relative h-[19rem] sm:h-[21rem]">
            <AnimatePresence mode="wait">
              <motion.div
                key={screen}
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
                transition={{ duration: 0.35 }}
                className="absolute inset-0"
              >
                {screen === "dashboard" && <DashboardScreen fr={fr} />}
                {screen === "studio" && <StudioScreen fr={fr} />}
                {screen === "group" && <GroupScreen fr={fr} />}
              </motion.div>
            </AnimatePresence>
          </div>
          {/* Cycle progress */}
          <div className="h-0.5 bg-white/5">
            <motion.div key={`${screen}-${paused}`} className="h-full bg-gradient-to-r from-cyan-400 to-violet-400" initial={{ width: "0%" }} animate={{ width: paused ? "0%" : "100%" }} transition={{ duration: CYCLE_MS / 1000, ease: "linear" }} />
          </div>
        </div>
      </TiltCard>

      {/* Floating depth cards */}
      <motion.div
        aria-hidden
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute -left-4 top-16 hidden rounded-2xl border border-white/15 bg-slate-900/80 px-3 py-2 text-xs text-white shadow-2xl backdrop-blur-xl sm:block lg:-left-10"
      >
        <span className="flex items-center gap-1.5 font-bold">
          <Flame className="h-4 w-4 text-orange-400" /> {fr ? "Série : 12 jours" : "Streak: 12 days"}
        </span>
      </motion.div>
      <motion.div
        aria-hidden
        animate={{ y: [0, 12, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
        className="absolute -right-3 bottom-20 hidden rounded-2xl border border-emerald-400/30 bg-emerald-950/70 px-3 py-2 text-xs text-emerald-100 shadow-2xl backdrop-blur-xl sm:block lg:-right-8"
      >
        <span className="flex items-center gap-1.5 font-bold">
          <Check className="h-4 w-4 text-emerald-300" /> {fr ? "40 QCM prêts" : "40 MCQs ready"}
        </span>
      </motion.div>
    </div>
  );
}
