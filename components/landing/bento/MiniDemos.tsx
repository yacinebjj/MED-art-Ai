"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpenText,
  Check,
  Clock3,
  Flame,
  Headphones,
  ImageIcon,
  Lightbulb,
  ListChecks,
  Mic,
  Network,
  Pause,
  Play,
  RotateCcw,
  Search,
  Stethoscope,
  Table2,
  Timer,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Language } from "@/providers/LanguageProvider";

// ---------------------------------------------------------------------------
// Studio: the 7 real formats + a playable QCM

const FORMATS = [
  { icon: BookOpenText, fr: "Explication ultra-détaillée", en: "Ultra-detailed explanation" },
  { icon: ListChecks, fr: "Résumé orienté examen", en: "Exam-oriented summary" },
  { icon: Stethoscope, fr: "Cas clinique", en: "Clinical case" },
  { icon: Check, fr: "Examen QCMs", en: "MCQ exam" },
  { icon: Lightbulb, fr: "Exemples & analogies", en: "Examples & analogies" },
  { icon: ImageIcon, fr: "Infographie", en: "Infographic" },
  { icon: Headphones, fr: "Podcast audio", en: "Audio podcast" },
];

const QCM = {
  fr: {
    q: "Intoxication au paracétamol : quel antidote ?",
    options: ["Naloxone", "Flumazénil", "N-acétylcystéine", "Atropine"],
    why: "La N-acétylcystéine restaure le glutathion hépatique — à débuter selon la paracétamolémie.",
  },
  en: {
    q: "Paracetamol poisoning: which antidote?",
    options: ["Naloxone", "Flumazenil", "N-acetylcysteine", "Atropine"],
    why: "N-acetylcysteine restores hepatic glutathione — start according to the paracetamol level.",
  },
};
const QCM_ANSWER = 2;

export function StudioDemo({ language }: { language: Language }) {
  const [choice, setChoice] = useState<number | null>(null);
  const qcm = QCM[language];
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1.15fr]">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-1">
        {FORMATS.map((format, i) => (
          <motion.div
            key={format.fr}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.06 * i }}
            className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-sm text-slate-200"
          >
            <format.icon className="h-4 w-4 shrink-0 text-cyan-300" />
            <span className="truncate">{format[language]}</span>
            <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400" />
          </motion.div>
        ))}
      </div>
      <div className="rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">{language === "fr" ? "Essaie — QCM généré" : "Try it — generated MCQ"}</p>
        <p className="mt-2 text-sm font-bold text-white">{qcm.q}</p>
        <div className="mt-3 space-y-1.5">
          {qcm.options.map((option, i) => {
            const answered = choice !== null;
            const correct = i === QCM_ANSWER;
            return (
              <button
                key={option}
                type="button"
                disabled={answered}
                onClick={() => setChoice(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all",
                  !answered && "border-white/10 text-slate-200 hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-cyan-400/5",
                  answered && correct && "border-emerald-400/60 bg-emerald-400/15 text-emerald-100",
                  answered && !correct && i === choice && "border-rose-400/60 bg-rose-400/15 text-rose-100",
                  answered && !correct && i !== choice && "border-white/5 text-slate-500"
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/10 text-[10px] font-bold">{"ABCD"[i]}</span>
                <span className="flex-1">{option}</span>
                {answered && correct && <Check className="h-4 w-4 text-emerald-300" />}
                {answered && !correct && i === choice && <X className="h-4 w-4 text-rose-300" />}
              </button>
            );
          })}
        </div>
        <AnimatePresence>
          {choice !== null && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="overflow-hidden">
              <p className="mt-3 rounded-xl bg-emerald-400/10 p-2.5 text-xs leading-relaxed text-emerald-100">{qcm.why}</p>
              <button type="button" onClick={() => setChoice(null)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:underline">
                <RotateCcw className="h-3 w-3" />
                {language === "fr" ? "Rejouer" : "Replay"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flashcards: a playable 3-card deck

const CARDS = {
  fr: [
    { q: "Triade de Charcot ?", a: "Douleur de l'hypochondre droit, fièvre, ictère → angiocholite." },
    { q: "Signe de Murphy positif ?", a: "Inspiration bloquée à la palpation sous-costale droite → cholécystite aiguë." },
    { q: "Hyperkaliémie avec QRS larges : 1er geste ?", a: "Gluconate de calcium IV (cardioprotection immédiate)." },
  ],
  en: [
    { q: "Charcot's triad?", a: "Right upper quadrant pain, fever, jaundice → cholangitis." },
    { q: "Positive Murphy's sign?", a: "Inspiration arrested on right subcostal palpation → acute cholecystitis." },
    { q: "Hyperkalaemia with wide QRS: first step?", a: "IV calcium gluconate (immediate cardioprotection)." },
  ],
};

export function FlashcardDemo({ language }: { language: Language }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState({ known: 0, review: 0 });
  const cards = CARDS[language];
  const card = cards[index % cards.length];

  function grade(known: boolean) {
    setScore((s) => (known ? { ...s, known: s.known + 1 } : { ...s, review: s.review + 1 }));
    setFlipped(false);
    window.setTimeout(() => setIndex((i) => i + 1), 180);
  }

  return (
    <div>
      <div className="[perspective:1000px]">
        <motion.button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 22 }}
          className="relative h-40 w-full [transform-style:preserve-3d]"
          aria-label={language === "fr" ? "Retourner la carte" : "Flip the card"}
        >
          <span className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 p-4 text-center [backface-visibility:hidden]">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">{language === "fr" ? "Question" : "Question"}</span>
            <span className="mt-2 text-base font-bold text-white">{card.q}</span>
            <span className="mt-3 text-[11px] text-slate-400">{language === "fr" ? "Touche pour retourner" : "Tap to flip"}</span>
          </span>
          <span className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-emerald-400/30 bg-gradient-to-br from-emerald-500/20 to-teal-500/10 p-4 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">{language === "fr" ? "Réponse" : "Answer"}</span>
            <span className="mt-2 text-sm font-semibold text-white">{card.a}</span>
          </span>
        </motion.button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => grade(false)} className="rounded-xl border border-rose-400/30 bg-rose-400/10 py-2 text-xs font-bold text-rose-200 transition-colors hover:bg-rose-400/20">
          {language === "fr" ? "À revoir" : "Review"} · {score.review}
        </button>
        <button type="button" onClick={() => grade(true)} className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 py-2 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-400/20">
          {language === "fr" ? "Je savais" : "Knew it"} · {score.known}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MedArt Lab: three tools

export function LabDemo({ language }: { language: Language }) {
  const fr = language === "fr";
  const tools = [
    { id: "case", icon: Stethoscope, label: fr ? "Patient virtuel" : "Virtual patient", tint: "text-rose-300" },
    { id: "matrix", icon: Table2, label: fr ? "Matrice" : "Matrix", tint: "text-violet-300" },
    { id: "map", icon: Network, label: fr ? "Carte mentale" : "Mind map", tint: "text-cyan-300" },
  ] as const;
  const [tool, setTool] = useState<(typeof tools)[number]["id"]>("case");
  return (
    <div>
      <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={cn("relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors", tool === t.id ? "text-white" : "text-slate-500 hover:text-slate-300")}
          >
            {tool === t.id && <motion.span layoutId="lab-tab" className="absolute inset-0 rounded-lg bg-white/10" />}
            <t.icon className={cn("relative h-3.5 w-3.5", t.tint)} />
            <span className="relative hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 min-h-[8.5rem] rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-xs">
        <AnimatePresence mode="wait">
          <motion.div key={tool} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
            {tool === "case" && (
              <div className="space-y-1.5 text-slate-300">
                <p className="font-bold text-white">{fr ? "Homme, 58 ans — douleur thoracique depuis 1 h" : "Man, 58 — chest pain for 1 h"}</p>
                <p>TA 92/60 · FC 48 · SpO₂ 95 %</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {["ECG", fr ? "Troponine" : "Troponin", "Écho"].map((exam) => (
                    <span key={exam} className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-rose-200">
                      {exam}
                    </span>
                  ))}
                </div>
                <p className="text-emerald-300">{fr ? "Diagnostic → score et correction détaillée" : "Diagnosis → score and detailed correction"}</p>
              </div>
            )}
            {tool === "matrix" && (
              <table className="w-full text-left text-[11px]">
                <thead className="text-violet-300">
                  <tr>
                    <th className="pb-1">{fr ? "Molécule" : "Drug"}</th>
                    <th className="pb-1">{fr ? "Classe" : "Class"}</th>
                    <th className="pb-1">{fr ? "CI majeure" : "Key CI"}</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  <tr className="border-t border-white/5">
                    <td className="py-1">Bisoprolol</td>
                    <td>β-bloquant</td>
                    <td>{fr ? "Asthme sévère" : "Severe asthma"}</td>
                  </tr>
                  <tr className="border-t border-white/5">
                    <td className="py-1">Ramipril</td>
                    <td>IEC</td>
                    <td>{fr ? "Grossesse" : "Pregnancy"}</td>
                  </tr>
                  <tr className="border-t border-white/5">
                    <td className="py-1">Spironolactone</td>
                    <td>ARM</td>
                    <td>{fr ? "Hyperkaliémie" : "Hyperkalaemia"}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {tool === "map" && (
              <div className="flex flex-col items-center gap-2">
                <span className="rounded-full bg-cyan-400/20 px-3 py-1 font-bold text-cyan-100">{fr ? "Insuffisance cardiaque" : "Heart failure"}</span>
                <div className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {[fr ? "Étiologies" : "Causes", fr ? "Mécanismes" : "Mechanisms", fr ? "Clinique" : "Signs", fr ? "Traitement" : "Treatment"].map((branch, i) => (
                    <motion.span key={branch} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.08 * i }} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center text-slate-200">
                      {branch}
                    </motion.span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio: course podcast (the lecture-recording "Smart Notes" line returns with V2 — lib/feature-flags.ts)

export function AudioDemo({ language }: { language: Language }) {
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const bars = [8, 14, 22, 12, 26, 18, 10, 20, 28, 16, 9, 24, 14, 19, 11, 23];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-orange-400/20 bg-gradient-to-r from-orange-500/10 to-amber-500/5 p-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Lecture"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 text-slate-950 shadow-[0_0_20px_rgba(251,146,60,0.5)]"
        >
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <div className="flex h-8 flex-1 items-center gap-[3px]">
          {bars.map((h, i) => (
            <motion.span
              key={i}
              className="w-1 rounded-full bg-orange-300/80"
              animate={playing && !reduce ? { height: [h * 0.4, h, h * 0.6, h] } : { height: h * 0.5 }}
              transition={playing && !reduce ? { duration: 0.9, repeat: Infinity, delay: i * 0.05 } : { duration: 0.3 }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {["Français", "English", "Darija 🇩🇿"].map((lang) => (
          <span key={lang} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-slate-300">
            {lang}
          </span>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-xs text-slate-300">
        <Mic className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" />
        {language === "fr"
          ? "Écoute ton cours : intro, points clés, pièges et conclusion."
          : "Listen to your course: intro, key points, pitfalls and wrap-up."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cockpit: Ctrl+K, streak, pomodoro

export function CockpitDemo({ language }: { language: Language }) {
  const reduce = useReducedMotion();
  const [seconds, setSeconds] = useState(25 * 60);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setSeconds((s) => (s <= 0 ? 25 * 60 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [reduce]);
  const fr = language === "fr";
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="col-span-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-400">
        <Search className="h-3.5 w-3.5 text-cyan-300" />
        {fr ? "Demander à l'assistant…" : "Ask the assistant…"}
        <span className="ml-auto rounded border border-white/10 px-1.5 text-[10px]">Ctrl K</span>
      </div>
      <div className="rounded-xl border border-orange-400/20 bg-orange-400/10 p-3">
        <Flame className="h-4 w-4 text-orange-400" />
        <p className="mt-1 text-lg font-black text-white">{fr ? "Série" : "Streak"}</p>
        <div className="mt-1.5 flex gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className={cn("h-3 flex-1 rounded", i < 6 ? "bg-gradient-to-t from-orange-500 to-amber-400" : "bg-white/10")} />
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-3">
        <Timer className="h-4 w-4 text-sky-300" />
        <p className="mt-1 font-mono text-lg font-black text-white">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
        </p>
        <p className="flex items-center gap-1 text-[10px] text-slate-400">
          <Clock3 className="h-3 w-3" /> Pomodoro
        </p>
      </div>
    </div>
  );
}
