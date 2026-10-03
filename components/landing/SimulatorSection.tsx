"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { BookOpenText, Brain, Check, FileText, Headphones, ImageIcon, Lightbulb, ListChecks, RotateCcw, Sparkles, Stethoscope, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import { GlassPanel, GradientText, Reveal, SectionHeading } from "./primitives";

type Stage = "idle" | "absorbing" | "generating" | "done";

const OUTPUTS = [
  { icon: BookOpenText, fr: "Explication", en: "Explanation", tint: "text-cyan-300 border-cyan-400/40 bg-cyan-400/10" },
  { icon: ListChecks, fr: "Résumé", en: "Summary", tint: "text-sky-300 border-sky-400/40 bg-sky-400/10" },
  { icon: Stethoscope, fr: "Cas clinique", en: "Clinical case", tint: "text-rose-300 border-rose-400/40 bg-rose-400/10" },
  { icon: Check, fr: "40+ QCM", en: "40+ MCQs", tint: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10" },
  { icon: Lightbulb, fr: "Analogies", en: "Analogies", tint: "text-amber-300 border-amber-400/40 bg-amber-400/10" },
  { icon: ImageIcon, fr: "Infographie", en: "Infographic", tint: "text-fuchsia-300 border-fuchsia-400/40 bg-fuchsia-400/10" },
  { icon: Headphones, fr: "Podcast", en: "Podcast", tint: "text-orange-300 border-orange-400/40 bg-orange-400/10" },
  { icon: Brain, fr: "Flashcards", en: "Flashcards", tint: "text-violet-300 border-violet-400/40 bg-violet-400/10" },
];

const STEPS = [
  {
    fr: { title: "Importe ton cours", text: "PDF, Word, PowerPoint, photo ou Google Drive : dépose ton polycopié dans le module de ton programme officiel." },
    en: { title: "Import your course", text: "PDF, Word, PowerPoint, photo or Google Drive: drop your handout into its module of the official curriculum." },
  },
  {
    fr: { title: "L'IA l'analyse en profondeur", text: "Chaque mécanisme est décortiqué, chaque piège de QCM repéré — en restant fidèle à TON cours, pas à Internet." },
    en: { title: "AI analyses it in depth", text: "Every mechanism is unpacked, every MCQ trap spotted — staying faithful to YOUR course, not the internet." },
  },
  {
    fr: { title: "Tu révises comme jamais", text: "Sept formats, examen corrigé, flashcards, Lab clinique, groupes : tout est rangé par module, prêt avant le jour J." },
    en: { title: "You revise like never before", text: "Seven formats, a corrected exam, flashcards, the clinical Lab, groups: all filed by module, ready before exam day." },
  },
];

export function SimulatorSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>("idle");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const timers = useRef<number[]>([]);

  function run() {
    timers.current.forEach((t) => window.clearTimeout(t));
    if (reduce) {
      setStage("done");
      return;
    }
    setStage("absorbing");
    timers.current = [window.setTimeout(() => setStage("generating"), 1300), window.setTimeout(() => setStage("done"), 3100)];
  }

  useEffect(() => {
    if (inView && stage === "idle") run();
    // run() is stable enough for a one-shot autoplay; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const activeStep = stage === "idle" || stage === "absorbing" ? 0 : stage === "generating" ? 1 : 2;

  return (
    <section id="simulateur" className="relative scroll-mt-24 px-4 py-24 sm:px-6 lg:px-8">
      <SectionHeading
        eyebrow={fr ? "Comment ça marche" : "How it works"}
        title={
          fr ? (
            <>
              Un PDF entre. <GradientText>Une machine à réussir en sort.</GradientText>
            </>
          ) : (
            <>
              A PDF goes in. <GradientText>A success machine comes out.</GradientText>
            </>
          )
        }
        subtitle={fr ? "Regarde ton cours se transformer — en vrai, ça prend quelques instants." : "Watch your course transform — for real, it takes moments."}
      />

      <div ref={ref} className="mx-auto mt-14 grid max-w-7xl items-center gap-8 lg:grid-cols-[1fr_1.2fr]">
        {/* Steps */}
        <div className="space-y-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.fr.title} delay={i * 0.1}>
              <div
                className={cn(
                  "relative overflow-hidden rounded-2xl border p-5 transition-all duration-500",
                  activeStep === i ? "border-cyan-400/40 bg-cyan-400/[0.07] shadow-[0_0_40px_-10px_rgba(34,211,238,0.5)]" : "border-white/10 bg-white/[0.02]"
                )}
              >
                <div className="flex items-start gap-4">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black tabular-nums transition-colors duration-500",
                      activeStep >= i ? "bg-gradient-to-br from-cyan-400 to-blue-600 text-white" : "bg-white/5 text-slate-500"
                    )}
                  >
                    {activeStep > i ? <Check className="h-5 w-5" /> : `0${i + 1}`}
                  </span>
                  <div>
                    <p className="text-base font-extrabold text-white">{step[language].title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">{step[language].text}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Machine */}
        <GlassPanel className="relative flex min-h-[26rem] flex-col items-center justify-center overflow-hidden p-6">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.12),transparent_60%)]" />

          {/* The PDF */}
          <AnimatePresence>
            {(stage === "idle" || stage === "absorbing") && (
              <motion.div
                key="pdf"
                initial={{ opacity: 0, y: -40 }}
                animate={stage === "absorbing" ? { y: 92, scale: 0.25, opacity: 0, rotate: 18 } : { opacity: 1, y: 0, scale: 1, rotate: -4 }}
                exit={{ opacity: 0 }}
                transition={stage === "absorbing" ? { duration: 1.1, ease: [0.55, 0, 0.75, 0] } : { duration: 0.5 }}
                className="absolute top-8 flex w-44 flex-col gap-1.5 rounded-xl border border-white/15 bg-white p-3 shadow-2xl"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
                  <FileText className="h-4 w-4" /> Cardiologie.pdf
                </span>
                {[90, 75, 85, 60, 80].map((w, i) => (
                  <span key={i} className="h-1.5 rounded-full bg-slate-200" style={{ width: `${w}%` }} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* AI core */}
          <div className="relative mt-16 flex h-36 w-36 items-center justify-center">
            {[0, 1, 2].map((ring) => (
              <motion.span
                key={ring}
                aria-hidden
                className="absolute inset-0 rounded-full border border-cyan-400/40"
                animate={stage === "absorbing" || stage === "generating" ? { scale: [1, 1.6], opacity: [0.7, 0] } : { scale: 1, opacity: 0.25 }}
                transition={stage === "absorbing" || stage === "generating" ? { duration: 1.4, repeat: Infinity, delay: ring * 0.45 } : { duration: 0.4 }}
              />
            ))}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: stage === "generating" ? 2 : 12, repeat: Infinity, ease: "linear" }}
              className="absolute inset-3 rounded-full bg-[conic-gradient(from_0deg,rgba(34,211,238,0.9),rgba(139,92,246,0.9),rgba(16,185,129,0.9),rgba(34,211,238,0.9))] opacity-80 blur-[2px]"
            />
            <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-full bg-slate-950 shadow-[0_0_50px_rgba(34,211,238,0.6)]">
              <Sparkles className="h-7 w-7 text-cyan-300" />
              <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-cyan-200">
                {stage === "generating" ? (fr ? "Analyse…" : "Analysing…") : stage === "done" ? (fr ? "Prêt" : "Ready") : "MedArt AI"}
              </span>
            </div>
          </div>

          {/* Outputs */}
          <div className="relative mt-8 grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            {OUTPUTS.map((output, i) => (
              <motion.div
                key={output.fr}
                initial={false}
                animate={stage === "done" || stage === "generating" ? { opacity: stage === "done" || i < 3 ? 1 : 0.25, y: 0, scale: 1 } : { opacity: 0, y: -40, scale: 0.6 }}
                transition={{ delay: stage === "done" ? i * 0.07 : i * 0.12, type: "spring", stiffness: 260, damping: 20 }}
                className={cn("flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-bold", output.tint)}
              >
                <output.icon className="h-3.5 w-3.5" />
                {output[language]}
              </motion.div>
            ))}
          </div>

          <div className="relative mt-6">
            {stage === "done" ? (
              <button type="button" onClick={run} className="flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/5">
                <RotateCcw className="h-4 w-4" />
                {fr ? "Rejouer la démo" : "Replay the demo"}
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                disabled={stage !== "idle"}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.5)] disabled:opacity-60"
              >
                <Upload className="h-4 w-4" />
                {fr ? "Importer mon cours" : "Import my course"}
              </button>
            )}
          </div>
        </GlassPanel>
      </div>
    </section>
  );
}
