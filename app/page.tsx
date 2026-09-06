"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BookOpenText,
  ListChecks,
  ShieldAlert,
  Brain,
  Stethoscope,
  GraduationCap,
  Sparkles,
  ArrowRight,
  Check,
  X,
  Layers,
  MessageCircle,
  NotebookPen,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MotionCard } from "@/components/ui/MotionCard";
import { RevealSection } from "@/components/ui/RevealSection";
import { cn } from "@/lib/utils";
import { getPlansForCycle, type BillingCycle } from "@/lib/pricing";
import { BillingCycleToggle } from "@/components/pricing/BillingCycleToggle";
import { PricingTierCard } from "@/components/pricing/PricingTierCard";
import { useLanguage } from "@/providers/LanguageProvider";

// Copy refreshed 2026-09-06 (Silicon Valley landing page pass) — hero/
// feature-blurb/final-CTA text drafted with an OpenRouter ECONOMY_MODEL call
// ($0.0064, well under the $0.5 budget authorized for this task) as a
// starting point, then hand-edited for register (this app always addresses
// students with informal "tu", never "vous") and to strip anything that
// read as a generic marketing platitude.
const FEATURES = [
  {
    icon: BookOpenText,
    title: { fr: "Explication Ultra-Détaillée", en: "Ultra-Detailed Explanation" },
    description: {
      fr: "Comprends la physiopathologie la plus complexe avec une clarté absolue — sans ambiguïté, sans raccourci.",
      en: "Understand even the most complex physiopathology with total clarity — no ambiguity, no shortcuts.",
    },
  },
  {
    icon: ListChecks,
    title: { fr: "Résumé Orienté Examen", en: "Exam-Oriented Summary" },
    description: {
      fr: "L'essentiel ultra-condensé, structuré pour une rétention rapide juste avant le jour J.",
      en: "The essentials, ultra-condensed and structured for fast retention right before exam day.",
    },
  },
  {
    icon: ShieldAlert,
    title: { fr: "Les Pièges", en: "Common Traps" },
    description: {
      fr: "Repère les subtilités vicieuses et les faux amis qui font chuter aux QCM.",
      en: "Spot the vicious subtleties and false friends that make students fail MCQs.",
    },
  },
  {
    icon: Brain,
    title: { fr: "Astuces Mnémotechniques", en: "Mnemonic Tips" },
    description: {
      fr: "Mémorise durablement listes complexes et posologies grâce à des ancrages mentaux puissants.",
      en: "Durably memorize complex lists and dosages with powerful mental anchors.",
    },
  },
  {
    icon: Stethoscope,
    title: { fr: "Cas Clinique", en: "Clinical Case" },
    description: {
      fr: "Passe de la théorie à la pratique avec une mise en situation clinique réaliste et immersive.",
      en: "Move from theory to practice with a realistic, immersive clinical scenario.",
    },
  },
  {
    icon: GraduationCap,
    title: { fr: "Examen QCMs", en: "MCQ Exam" },
    description: {
      fr: "Teste-toi en conditions réelles — 40 à 60 QCM progressifs, corrigés en détail instantanément.",
      en: "Test yourself under real conditions — 40 to 60 progressive MCQs, corrected in detail instantly.",
    },
  },
];

const METRICS = [
  { value: "6", label: { fr: "Formats générés par cours", en: "Formats generated per course" } },
  { value: "40-60", label: { fr: "QCM par examen généré", en: "MCQs per generated exam" } },
  { value: "100%", label: { fr: "Basé sur TES propres cours", en: "Based on YOUR own courses" } },
  { value: "24/7", label: { fr: "Assistant IA disponible", en: "AI Assistant available" } },
];

const COMPARISON_ROWS = [
  {
    traditional: { fr: "Des heures à relire des PDF", en: "Hours spent re-reading PDFs" },
    modern: { fr: "Résumés générés par IA en quelques secondes", en: "AI-generated summaries in seconds" },
  },
  {
    traditional: { fr: "QCM génériques trouvés en ligne", en: "Generic MCQs found online" },
    modern: { fr: "QCM basés sur TES propres cours", en: "MCQs based on YOUR own courses" },
  },
  {
    traditional: { fr: "Aucun retour sur tes points faibles", en: "No feedback on your weak points" },
    modern: { fr: "Suivi en temps réel de tes points faibles", en: "Real-time tracking of your weak points" },
  },
  {
    traditional: { fr: "Notes éparpillées entre plusieurs apps", en: "Notes scattered across multiple apps" },
    modern: { fr: "Tout centralisé dans un seul Studio", en: "Everything centralized in one Studio" },
  },
];

const ACCENT_CLASSES = {
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-600 dark:text-emerald-400", glow: "from-emerald-400/30 via-teal-400/20 to-emerald-400/30" },
  violet: { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-600 dark:text-violet-400", glow: "from-violet-400/30 via-fuchsia-400/20 to-violet-400/30" },
  amber: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-600 dark:text-amber-400", glow: "from-amber-400/30 via-orange-400/20 to-amber-400/30" },
};

function MockupFrame({
  accent,
  src,
  alt,
  width,
  height,
}: {
  accent: keyof typeof ACCENT_CLASSES;
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const tint = ACCENT_CLASSES[accent];
  return (
    <div className="relative mx-auto w-full max-w-2xl">
      <div aria-hidden className={cn("pointer-events-none absolute -inset-2 rounded-[2rem] bg-gradient-to-br opacity-60 blur-xl", tint.glow)} />
      <div className="glass-card relative overflow-hidden rounded-2xl shadow-glass dark:shadow-glass-dark">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        </div>
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes="(min-width: 1024px) 640px, 90vw"
          className="h-auto w-full object-contain"
        />
      </div>
    </div>
  );
}

const PRODUCT_SURFACES = [
  {
    icon: Layers,
    accent: "emerald" as const,
    title: { fr: "Le Studio : organise tes modules", en: "The Studio: organize your modules" },
    description: {
      fr: "Chaque cours importé devient six formats complémentaires — explication détaillée, résumé, pièges, mnémotechniques, cas clinique et QCM — générés automatiquement et rangés par module.",
      en: "Each imported course becomes six complementary formats — detailed explanation, summary, traps, mnemonics, clinical case, and MCQs — automatically generated and organized by module.",
    },
    image: "/2.jpg",
    width: 3309,
    height: 2206,
  },
  {
    icon: MessageCircle,
    accent: "violet" as const,
    title: { fr: "L'Assistant IA, disponible à toute heure", en: "The AI Assistant, available anytime" },
    description: {
      fr: "Pose n'importe quelle question sur tes révisions — organisation, compréhension d'un concept, ou juste un coup de motivation — l'Assistant MedArt répond en temps réel.",
      en: "Ask any question about your revisions — organization, understanding a concept, or just a motivation boost — the MedArt Assistant answers in real time.",
    },
    image: "/3.jpg",
    width: 5419,
    height: 3613,
  },
  {
    icon: NotebookPen,
    accent: "amber" as const,
    title: { fr: "Tes notes, toutes au même endroit", en: "Your notes, all in one place" },
    description: {
      fr: "Centralise tes propres notes de révision directement liées à chaque cours, sans jongler entre plusieurs applications.",
      en: "Centralize your own revision notes directly linked to each course, without juggling multiple applications.",
    },
    image: "/4.jpg",
    width: 4241,
    height: 4241,
  },
];

export default function LandingPage() {
  const { language } = useLanguage();
  const [cycle, setCycle] = useState<BillingCycle>("annual");

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden">
      {/* Fixed, viewport-pinned backdrop (same aurora/mesh system as the
          authenticated shell — see app/globals.css) — everything below
          scrolls over ONE continuous field instead of the old alternating
          flat bg-slate-50/white bands, which is what read as "classique"
          rather than a premium, single-surface SaaS page. */}
      <div aria-hidden className="aurora-canvas-bg fixed inset-0 -z-20" />
      <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />

      <Navbar />

      <main className="flex-1">
        {/* --- Hero --- */}
        <section className="relative overflow-hidden px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:px-8 lg:pb-28 lg:pt-20">
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <RevealSection className="text-center lg:text-left">
              <span className="glass-card inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-primary-700 shadow-soft dark:text-primary-300 sm:text-sm">
                <Sparkles className="h-4 w-4 shrink-0" />
                {language === "fr" ? "Conçu pour les facultés de santé algériennes" : "Designed for Algerian medical faculties"}
              </span>
              <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-5xl lg:text-6xl">
                <span className="bg-gradient-to-r from-primary-600 via-teal-500 to-secondary-600 bg-clip-text text-transparent">
                  {language === "fr" ? "Transforme tes cours." : "Transform your courses."}
                </span>{" "}
                {language === "fr" ? "Domine tes examens." : "Master your exams."}
              </h1>
              <p className="mx-auto mt-5 max-w-md text-base text-slate-600 dark:text-slate-300 sm:text-lg lg:mx-0">
                {language === "fr"
                  ? "Importe tes cours : Med Art AI génère instantanément résumés ciblés, pièges de QCM et examens complets pour réussir."
                  : "Import your courses — Med Art AI instantly generates targeted summaries, MCQ traps, and full exams to help you succeed."}
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
                <Button
                  asChild
                  size="lg"
                  className="group relative w-full overflow-hidden shadow-[0_0_35px_rgba(20,184,166,0.4)] transition-shadow duration-300 hover:shadow-[0_0_50px_rgba(20,184,166,0.55)] sm:w-auto"
                >
                  <Link href="/register">
                    {language === "fr" ? "Commencer gratuitement" : "Start for free"}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full glass-card sm:w-auto">
                  <Link href="/login">{language === "fr" ? "Se connecter" : "Log in"}</Link>
                </Button>
              </div>
            </RevealSection>

            <RevealSection delay={0.15} className="relative">
              <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-primary-400/25 via-secondary-400/15 to-transparent blur-3xl" />
              <div className="glass-card relative overflow-hidden rounded-[1.75rem] p-1.5 shadow-glass dark:shadow-glass-dark sm:p-2">
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[1.375rem] sm:aspect-[5/4]">
                  <Image
                    src="/1.jpg"
                    alt={language === "fr" ? "Étudiant en médecine révisant avec Med Art AI" : "Medical student studying with Med Art AI"}
                    fill
                    sizes="(min-width: 1024px) 50vw, 100vw"
                    className="object-cover"
                    priority
                  />
                </div>
              </div>
            </RevealSection>
          </div>
        </section>

        {/* --- Metrics --- */}
        <RevealSection>
          <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
            <div className="glass-card grid grid-cols-2 gap-6 rounded-3xl p-6 shadow-glass dark:shadow-glass-dark sm:gap-8 sm:p-8 lg:grid-cols-4">
              {METRICS.map((metric) => (
                <div key={metric.label.fr} className="text-center">
                  <p className="text-3xl font-extrabold text-primary-600 dark:text-primary-400 sm:text-4xl lg:text-5xl">{metric.value}</p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">{metric.label[language]}</p>
                </div>
              ))}
            </div>
          </section>
        </RevealSection>

        {/* --- Features Bento Grid ---
            Tiles 0 (Explication) and 5 (Examen QCM) — the two flagship
            formats — span 2 columns on desktop; [grid-auto-flow:dense] lets
            the other 4 tiles fill around them automatically instead of
            needing hand-placed grid coordinates for every combination of
            spans, which would break the moment FEATURES' order changes. */}
        <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <RevealSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              {language === "fr" ? "Tout ce dont tu as besoin pour réussir" : "Everything you need to succeed"}
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              {language === "fr"
                ? "Chaque cours importé est transformé en six sections complémentaires pensées pour l'examen."
                : "Each imported course is transformed into six complementary sections designed for the exam."}
            </p>
          </RevealSection>

          <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:[grid-auto-flow:dense]">
            {FEATURES.map((feature, index) => (
              <RevealSection key={feature.title.fr} delay={Math.min(index * 0.08, 0.32)} className={cn("h-full", (index === 0 || index === 5) && "lg:col-span-2")}>
                <MotionCard className="glass-card group relative flex h-full flex-col overflow-hidden p-6 sm:p-7">
                  <div
                    aria-hidden
                    className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary-400/15 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                  />
                  <div className="relative mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 transition-transform duration-300 group-hover:scale-110 dark:bg-primary-900/30 dark:text-primary-400">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="relative text-base font-semibold text-slate-900 dark:text-slate-100">{feature.title[language]}</h3>
                  <p className="relative mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description[language]}</p>
                </MotionCard>
              </RevealSection>
            ))}
          </div>
        </section>

        {/* --- How it works --- */}
        <section id="how-it-works" className="py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <RevealSection className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
                {language === "fr" ? "Comment ça marche" : "How it works"}
              </h2>
            </RevealSection>

            <div className="mt-16 space-y-20">
              {PRODUCT_SURFACES.map((surface, index) => {
                const isReversed = index % 2 === 1;
                return (
                  <RevealSection
                    key={surface.title.fr}
                    className={cn(
                      "flex flex-col items-center gap-10 lg:flex-row lg:gap-16",
                      isReversed && "lg:flex-row-reverse"
                    )}
                  >
                    <div className="flex-1 text-center lg:text-left">
                      <span className="mb-4 inline-flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex h-12 w-12 items-center justify-center rounded-2xl",
                            ACCENT_CLASSES[surface.accent].bg,
                            ACCENT_CLASSES[surface.accent].text
                          )}
                        >
                          <surface.icon className="h-6 w-6" />
                        </span>
                        <span className="text-xs font-bold tabular-nums text-slate-400 dark:text-slate-600">0{index + 1}</span>
                      </span>
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{surface.title[language]}</h3>
                      <p className="mt-3 text-slate-600 dark:text-slate-300">{surface.description[language]}</p>
                    </div>
                    <div className="flex w-full flex-1 justify-center">
                      <MockupFrame
                        accent={surface.accent}
                        src={surface.image}
                        alt={surface.title[language]}
                        width={surface.width}
                        height={surface.height}
                      />
                    </div>
                  </RevealSection>
                );
              })}
            </div>
          </div>
        </section>

        {/* --- Comparison --- */}
        <section id="comparaison" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <RevealSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              {language === "fr" ? "L'avantage injuste" : "The unfair advantage"}
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              {language === "fr" ? "Étude traditionnelle contre Med Art AI." : "Traditional study vs Med Art AI."}
            </p>
          </RevealSection>

          <RevealSection delay={0.1} className="glass-card relative mt-14 overflow-hidden rounded-3xl p-2 shadow-glass dark:shadow-glass-dark sm:p-3">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary-400/10 blur-3xl" />
            <div className="relative grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
              <div className="rounded-2xl border border-rose-200/50 bg-rose-50/50 p-5 dark:border-rose-900/30 dark:bg-rose-950/10 sm:p-6">
                <p className="mb-4 text-xs font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                  {language === "fr" ? "Étude traditionnelle" : "Traditional study"}
                </p>
                <ul className="space-y-3">
                  {COMPARISON_ROWS.map((row) => (
                    <li key={row.traditional.fr} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      {row.traditional[language]}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50/60 p-5 shadow-[0_0_30px_rgba(16,185,129,0.15)] dark:border-emerald-800/50 dark:bg-emerald-950/20 sm:p-6">
                <p className="mb-4 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  Med Art AI
                </p>
                <ul className="space-y-3">
                  {COMPARISON_ROWS.map((row) => (
                    <li key={row.modern.fr} className="flex items-start gap-2 text-sm font-medium text-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      {row.modern[language]}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </RevealSection>
        </section>

        {/* --- Pricing --- */}
        <section id="tarifs" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <RevealSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              {language === "fr" ? "Des tarifs pensés pour les étudiants" : "Pricing designed for students"}
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              {language === "fr"
                ? "Seul, en groupe, ou avec toute ta promo — commence gratuitement, passe à un forfait payant quand tu es prêt à réviser sérieusement."
                : "Alone, as a group, or with your whole cohort — start for free, upgrade to a paid plan when you're ready to study seriously."}
            </p>
          </RevealSection>

          <RevealSection delay={0.1} className="mt-10 flex justify-center">
            <BillingCycleToggle value={cycle} onChange={setCycle} />
          </RevealSection>

          <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {getPlansForCycle(cycle).map((plan, index) => (
              <RevealSection key={plan.id} delay={index * 0.1} className="h-full">
                <PricingTierCard
                  plan={plan}
                  ctaSlot={
                    <Button asChild size="lg" variant={plan.featured ? "primary" : "outline"} className="mt-6 w-full">
                      <Link href="/register">{language === "fr" ? "S'inscrire" : "Sign up"}</Link>
                    </Button>
                  }
                />
              </RevealSection>
            ))}
          </div>
        </section>

        {/* --- Final CTA --- */}
        <RevealSection>
          <section className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 lg:px-8">
            <Card className="relative overflow-hidden bg-gradient-to-br from-primary-600 to-secondary-700 px-6 py-14 text-white sm:px-8">
              <div aria-hidden className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -bottom-16 -right-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
              <h2 className="relative text-3xl font-bold">
                {language === "fr" ? "Aborde tes examens avec certitude." : "Face your exams with confidence."}
              </h2>
              <p className="relative mx-auto mt-4 max-w-xl text-primary-50">
                {language === "fr"
                  ? "Importe ton premier cours aujourd'hui et révise avec l'efficacité que tes études méritent."
                  : "Import your first course today and study with the efficiency your degree deserves."}
              </p>
              <Button asChild size="lg" className="relative mt-8 bg-white text-primary-700 shadow-[0_0_35px_rgba(255,255,255,0.35)] hover:bg-primary-50">
                <Link href="/register">
                  {language === "fr" ? "Créer mon compte étudiant" : "Create my student account"}
                </Link>
              </Button>
              <div className="relative mx-auto mt-8 w-full max-w-sm md:max-w-md">
                <Image
                  src="/doctors.png"
                  alt={language === "fr" ? "L'équipe médicale Med Art AI" : "Med Art AI medical team"}
                  width={1024}
                  height={1024}
                  sizes="(min-width: 768px) 448px, 384px"
                  className="h-auto w-full object-contain"
                />
              </div>
            </Card>
          </section>
        </RevealSection>
      </main>

      <Footer />
    </div>
  );
}
