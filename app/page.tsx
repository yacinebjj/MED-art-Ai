"use client";

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
import { PLANS } from "@/lib/pricing";
import { useLanguage } from "@/providers/LanguageProvider";

const FEATURES = [
  {
    icon: BookOpenText,
    title: { fr: "Explication Ultra-Détaillée", en: "Ultra-Detailed Explanation" },
    description: {
      fr: "Un cours réexpliqué comme par un professeur particulier, phrase par phrase, jusqu'à ce que tout soit clair.",
      en: "A course re-explained like by a private tutor, sentence by sentence, until everything is clear.",
    },
  },
  {
    icon: ListChecks,
    title: { fr: "Résumé Orienté Examen", en: "Exam-Oriented Summary" },
    description: {
      fr: "Les points clés à retenir absolument, condensés pour une révision rapide.",
      en: "The key points to absolutely remember, condensed for quick review.",
    },
  },
  {
    icon: ShieldAlert,
    title: { fr: "Les Pièges", en: "Common Traps" },
    description: {
      fr: "Les erreurs classiques aux QCMs et examens, identifiées et expliquées.",
      en: "Classic errors in MCQs and exams, identified and explained.",
    },
  },
  {
    icon: Brain,
    title: { fr: "Astuces Mnémotechniques", en: "Mnemonic Tips" },
    description: {
      fr: "Des moyens mnémotechniques pour mémoriser durablement les notions difficiles.",
      en: "Mnemonics to durably memorize difficult concepts.",
    },
  },
  {
    icon: Stethoscope,
    title: { fr: "Cas Clinique", en: "Clinical Case" },
    description: {
      fr: "Une mise en situation clinique complète pour appliquer le cours en pratique.",
      en: "A complete clinical scenario to apply the course in practice.",
    },
  },
  {
    icon: GraduationCap,
    title: { fr: "Examen QCMs", en: "MCQ Exam" },
    description: {
      fr: "Des QCMs progressifs (facile à difficile), 5 choix chacun, avec correction détaillée de chaque réponse.",
      en: "Progressive MCQs (easy to hard), 5 choices each, with detailed correction for each answer.",
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
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-background/80 shadow-2xl backdrop-blur-md">
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

function formatBillingPeriod(durationMonths: number, language: "fr" | "en"): string {
  if (durationMonths === 1) return language === "fr" ? "mois" : "month";
  if (durationMonths === 12) return language === "fr" ? "an" : "year";
  return language === "fr" ? `${durationMonths} mois` : `${durationMonths} months`;
}

const LANDING_PLAN_IDS = Object.keys(PLANS) as (keyof typeof PLANS)[];

export default function LandingPage() {
  const { language } = useLanguage();

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1">
        {/* --- Hero --- */}
        <section className="overflow-hidden bg-slate-50 dark:bg-slate-900/40 sm:grid sm:grid-cols-2">
          <div className="flex flex-col justify-center p-8 md:p-12 lg:px-16 lg:py-24">
            <div className="mx-auto max-w-xl text-center sm:text-left">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-sm font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
                <Sparkles className="h-4 w-4" />
                {language === "fr" ? "Conçu pour les facultés de santé algériennes" : "Designed for Algerian medical faculties"}
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white md:text-4xl">
                {language === "fr" 
                  ? "Ton second cerveau médical, propulsé par l'IA" 
                  : "Your medical second brain, powered by AI"}
              </h1>
              <p className="mt-4 text-slate-600 dark:text-slate-300">
                {language === "fr" 
                  ? "Transforme tes cours de Médecine, Pharmacie et Chirurgie Dentaire en explications, résumés et QCM sur-mesure." 
                  : "Transform your Medicine, Pharmacy, and Dental Surgery courses into tailored explanations, summaries, and MCQs."}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="w-full shadow-[0_0_35px_rgba(20,184,166,0.4)] sm:w-auto">
                  <Link href="/register">
                    {language === "fr" ? "Commencer gratuitement" : "Start for free"}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                  <Link href="/login">{language === "fr" ? "Se connecter" : "Log in"}</Link>
                </Button>
              </div>
            </div>
          </div>
          <div className="relative h-56 w-full sm:h-full">
            <Image src="/1.jpg" alt="Étudiant en médecine révisant avec Med Art AI" fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" priority />
          </div>
        </section>

        {/* --- Metrics --- */}
        <RevealSection>
          <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
              {METRICS.map((metric) => (
                <div key={metric.label.fr}>
                  <p className="text-4xl font-extrabold text-primary-600 dark:text-primary-400 sm:text-5xl">{metric.value}</p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{metric.label[language]}</p>
                </div>
              ))}
            </div>
          </section>
        </RevealSection>

        {/* --- Features Grid --- */}
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

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <RevealSection key={feature.title.fr} delay={Math.min(index * 0.08, 0.32)}>
                <MotionCard className="h-full p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{feature.title[language]}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description[language]}</p>
                </MotionCard>
              </RevealSection>
            ))}
          </div>
        </section>

        {/* --- How it works --- */}
        <section id="how-it-works" className="bg-slate-50 py-20 dark:bg-slate-900/40">
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
                      <span
                        className={cn(
                          "mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl",
                          ACCENT_CLASSES[surface.accent].bg,
                          ACCENT_CLASSES[surface.accent].text
                        )}
                      >
                        <surface.icon className="h-6 w-6" />
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

          <RevealSection delay={0.1} className="relative mt-14 overflow-hidden rounded-3xl border border-white/10 bg-background/50 p-2 backdrop-blur-md sm:p-3">
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
                ? "Commence gratuitement, passe à un forfait payant quand tu es prêt à réviser sérieusement." 
                : "Start for free, upgrade to a paid plan when you're ready to study seriously."}
            </p>
          </RevealSection>

          <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {LANDING_PLAN_IDS.map((planId, index) => {
              const plan = PLANS[planId];
              const isFeatured = planId === "pro";
              return (
                <RevealSection key={plan.id} delay={index * 0.1} className="h-full">
                  <MotionCard
                    className={cn(
                      "flex h-full flex-col p-6 sm:p-8",
                      isFeatured && "border-primary-400 shadow-[0_0_40px_rgba(20,184,166,0.2)] dark:border-primary-600"
                    )}
                  >
                    <h3 className="text-lg font-bold text-foreground">{plan.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                    <div className="mt-6 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight text-foreground">
                        {plan.priceDZD.toLocaleString("fr-FR")}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground">
                        DZD / {formatBillingPeriod(plan.durationMonths, language)}
                      </span>
                    </div>
                    <ul className="mt-6 flex-1 space-y-2.5">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <Button asChild size="lg" variant={isFeatured ? "primary" : "outline"} className="mt-8 w-full">
                      <Link href="/register">{language === "fr" ? "S'inscrire" : "Sign up"}</Link>
                    </Button>
                  </MotionCard>
                </RevealSection>
              );
            })}
          </div>
        </section>

        {/* --- Final CTA --- */}
        <RevealSection>
          <section className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 lg:px-8">
            <Card className="bg-gradient-to-br from-primary-600 to-secondary-700 px-8 py-14 text-white">
              <h2 className="text-3xl font-bold">
                {language === "fr" ? "Prêt à étudier plus intelligemment ?" : "Ready to study smarter?"}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-primary-50">
                {language === "fr" 
                  ? "Rejoins les étudiants en santé qui utilisent déjà Med Art AI pour préparer leurs examens." 
                  : "Join the medical students who are already using Med Art AI to prepare for their exams."}
              </p>
              <Button asChild size="lg" className="mt-8 bg-white text-primary-700 hover:bg-primary-50">
                <Link href="/register">
                  {language === "fr" ? "Créer mon compte étudiant" : "Create my student account"}
                </Link>
              </Button>
              <div className="mx-auto mt-8 w-full max-w-sm md:max-w-md">
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