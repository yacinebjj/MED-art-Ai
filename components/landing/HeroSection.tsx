"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useLanguage } from "@/providers/LanguageProvider";
import { GradientText, MagneticLink } from "./primitives";
import { HeroMockup } from "./HeroMockup";

export function HeroSection() {
  const { language } = useLanguage();
  const fr = language === "fr";
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const mockupY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const mockupRotate = useTransform(scrollYProgress, [0, 1], [0, 6]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <section ref={ref} className="relative overflow-hidden px-4 pb-20 pt-28 sm:px-6 sm:pt-36 lg:px-8 lg:pb-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <motion.div style={{ y: textY, opacity: fade }} className="text-center lg:text-left">
          {/* Hero text is server-rendered and visible on first paint: CSS-only
              entrance (.hero-rise, app/globals.css), no JS-gated opacity. */}
          <span className="hero-rise inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-semibold text-cyan-200 shadow-[0_0_30px_rgba(34,211,238,0.2)] backdrop-blur sm:text-sm">
            <Sparkles className="h-4 w-4" />
            {fr ? "Conçu pour les facultés de santé algériennes" : "Built for Algerian health faculties"}
          </span>

          {/* The gradient line is ONE plain text node: iOS WebKit can't paint a
              parent's background-clip:text through per-word animated
              inline-blocks, which made it invisible on phones. */}
          <h1 className="mt-7 text-balance text-[2.6rem] font-black leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-7xl">
            {fr ? "Transforme tes cours." : "Transform your courses."}
            <br />
            <GradientText>{fr ? "Domine tes examens." : "Master your exams."}</GradientText>
          </h1>

          <p className="hero-rise mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-slate-300 [animation-delay:80ms] sm:text-lg lg:mx-0">
            {fr ? (
              <>
                Le premier <span className="font-semibold text-white">système d&apos;exploitation médical</span> propulsé par l&apos;IA. Importe ton polycopié :
                en quelques instants, il devient explication ultra-détaillée, cas clinique, examen de 40+ QCM corrigés, flashcards et podcast —{" "}
                <span className="font-semibold text-cyan-200">100 % basés sur TES cours</span>.
              </>
            ) : (
              <>
                The first AI-powered <span className="font-semibold text-white">medical operating system</span>. Import your handout: within moments it becomes an
                ultra-detailed explanation, a clinical case, a 40+ corrected MCQ exam, flashcards and a podcast —{" "}
                <span className="font-semibold text-cyan-200">100% based on YOUR courses</span>.
              </>
            )}
          </p>

          <div className="hero-rise mt-9 flex flex-col items-center justify-center gap-3 [animation-delay:160ms] sm:flex-row lg:justify-start">
            <MagneticLink
              href="/register"
              className="group relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 px-7 py-4 text-base font-black text-slate-950 shadow-[0_0_40px_rgba(34,211,238,0.5)] transition-shadow duration-300 hover:shadow-[0_0_70px_rgba(34,211,238,0.75)]"
            >
              <span aria-hidden className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/50 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              <span className="relative">{fr ? "Commencer gratuitement" : "Start for free"}</span>
              <ArrowRight className="relative h-5 w-5 transition-transform group-hover:translate-x-1" />
            </MagneticLink>
            <MagneticLink
              href="#simulateur"
              strength={0.25}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-base font-bold text-white backdrop-blur transition-colors hover:bg-white/10"
            >
              <Play className="h-4 w-4 fill-current" />
              {fr ? "Voir la démo" : "See it work"}
            </MagneticLink>
          </div>

          <p className="hero-rise mt-5 flex items-center justify-center gap-2 text-xs text-slate-400 [animation-delay:240ms] lg:justify-start">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            {fr ? "7 jours d'essai illimité · Sans carte bancaire · Paiement local Edahabia / CIB" : "7-day unlimited trial · No card required · Local payment Edahabia / CIB"}
          </p>
        </motion.div>

        <motion.div style={{ y: mockupY, rotateX: mockupRotate }} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, delay: 0.3 }} className="[perspective:1400px]">
          <HeroMockup />
        </motion.div>
      </div>
    </section>
  );
}
