"use client";

import { useLanguage } from "@/providers/LanguageProvider";
import { GlassPanel, NumberTicker, Reveal } from "./primitives";

/**
 * The existing metrics, made exact: the Studio really generates 7 formats
 * (the old "6" undercounted), exams target 40 MCQs minimum (not a
 * guaranteed 40-60), flashcards come in batches of 50, and the MedArt Lab
 * adds 3 interactive tools. Every number here is a product fact.
 */
const METRICS = [
  { value: 7, suffix: "", fr: "formats générés par cours", en: "formats generated per course" },
  { value: 40, suffix: "+", fr: "QCM corrigés par examen", en: "corrected MCQs per exam" },
  { value: 100, suffix: "%", fr: "basé sur TES propres cours", en: "based on YOUR own courses" },
  { value: 50, suffix: "", fr: "flashcards par lot, sans fin", en: "flashcards per endless batch" },
  { value: 3, suffix: "", fr: "outils du MedArt Lab", en: "MedArt Lab tools" },
  { value: 24, suffix: "/7", fr: "assistant IA disponible", en: "AI assistant available" },
];

export function MetricsStrip() {
  const { language } = useLanguage();
  return (
    <section className="relative px-4 pb-10 sm:px-6 lg:px-8">
      <Reveal>
        <GlassPanel className="mx-auto max-w-7xl overflow-hidden p-2">
          <div aria-hidden className="pointer-events-none absolute inset-x-10 -top-px h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
          <div className="grid grid-cols-2 divide-white/5 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
            {METRICS.map((metric) => (
              <div key={metric.fr} className="group rounded-2xl px-4 py-6 text-center transition-colors hover:bg-white/[0.03]">
                <p className="bg-gradient-to-b from-white to-cyan-200 bg-clip-text text-4xl font-black text-transparent sm:text-5xl">
                  <NumberTicker value={metric.value} suffix={metric.suffix} />
                </p>
                <p className="mt-2 text-xs leading-snug text-slate-400 sm:text-sm">{metric[language]}</p>
              </div>
            ))}
          </div>
        </GlassPanel>
      </Reveal>
    </section>
  );
}
