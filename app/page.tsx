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

const FEATURES = [
  {
    icon: BookOpenText,
    title: "Explication Ultra-Détaillée",
    description:
      "Un cours réexpliqué comme par un professeur particulier, phrase par phrase, jusqu'à ce que tout soit clair.",
  },
  {
    icon: ListChecks,
    title: "Résumé Orienté Examen",
    description: "Les points clés à retenir absolument, condensés pour une révision rapide.",
  },
  {
    icon: ShieldAlert,
    title: "Les Pièges",
    description: "Les erreurs classiques aux QCMs et examens, identifiées et expliquées.",
  },
  {
    icon: Brain,
    title: "Astuces Mnémotechniques",
    description: "Des moyens mnémotechniques pour mémoriser durablement les notions difficiles.",
  },
  {
    icon: Stethoscope,
    title: "Cas Clinique",
    description: "Une mise en situation clinique complète pour appliquer le cours en pratique.",
  },
  {
    icon: GraduationCap,
    title: "Examen QCMs",
    description:
      "Des QCMs progressifs (facile à difficile), 5 choix chacun, avec correction détaillée de chaque réponse.",
  },
];

/** Simple stat row — HyperUI-style "trusted by" metrics, adapted to what's actually true about this product rather than fabricated social-proof numbers. */
const METRICS = [
  { value: "6", label: "Formats générés par cours" },
  { value: "40-60", label: "QCM par examen généré" },
  { value: "100%", label: "Basé sur TES propres cours" },
  { value: "24/7", label: "Assistant IA disponible" },
];

const COMPARISON_ROWS = [
  { traditional: "Des heures à relire des PDF", modern: "Résumés générés par IA en quelques secondes" },
  { traditional: "QCM génériques trouvés en ligne", modern: "QCM basés sur TES propres cours" },
  { traditional: "Aucun retour sur tes points faibles", modern: "Suivi en temps réel de tes points faibles" },
  { traditional: "Notes éparpillées entre plusieurs apps", modern: "Tout centralisé dans un seul Studio" },
];

const ACCENT_CLASSES = {
  emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-600 dark:text-emerald-400", glow: "from-emerald-400/30 via-teal-400/20 to-emerald-400/30" },
  violet: { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-600 dark:text-violet-400", glow: "from-violet-400/30 via-fuchsia-400/20 to-violet-400/30" },
  amber: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-600 dark:text-amber-400", glow: "from-amber-400/30 via-orange-400/20 to-amber-400/30" },
};

/**
 * "Screenshot frame" chrome around each real photo below — a glowing-
 * bordered window with 3 fake title-bar dots. NOTE: `/2.jpg`, `/3.jpg`,
 * `/4.jpg` are real user-provided photos (verified: valid JPEGs, but at
 * huge native camera/stock resolutions — 3300-5600px wide, up to 26MB
 * source size), not literal UI screenshots of the Studio/Assistant/Notes
 * screens. Framed here as illustrative photography accompanying each
 * feature's description, not captioned as "this is our real interface" —
 * that claim would be inaccurate. next/image optimizes/resizes these
 * server-side regardless of source size, but the huge originals are still
 * real repo weight worth compressing before this ships.
 */
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
        {/* No fixed height + object-cover here anymore — that was cropping/
            zooming into these real (non-16:9) photos. width/height below are
            each photo's REAL intrinsic dimensions (verified), so `h-auto`
            lets the browser derive the correct height and object-contain
            shows the whole image with no cropping. */}
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

/** width/height are each photo's real intrinsic pixel dimensions (verified via file inspection) — required by next/image now that MockupFrame no longer uses `fill`. */
const PRODUCT_SURFACES = [
  {
    icon: Layers,
    accent: "emerald" as const,
    title: "Le Studio : organise tes modules",
    description:
      "Chaque cours importé devient six formats complémentaires — explication détaillée, résumé, pièges, mnémotechniques, cas clinique et QCM — générés automatiquement et rangés par module.",
    image: "/2.jpg",
    width: 3309,
    height: 2206,
  },
  {
    icon: MessageCircle,
    accent: "violet" as const,
    title: "L'Assistant IA, disponible à toute heure",
    description:
      "Pose n'importe quelle question sur tes révisions — organisation, compréhension d'un concept, ou juste un coup de motivation — l'Assistant MedArt répond en temps réel.",
    image: "/3.jpg",
    width: 5419,
    height: 3613,
  },
  {
    icon: NotebookPen,
    accent: "amber" as const,
    title: "Tes notes, toutes au même endroit",
    description:
      "Centralise tes propres notes de révision directement liées à chaque cours, sans jongler entre plusieurs applications.",
    image: "/4.jpg",
    width: 4241,
    height: 4241,
  },
];

/** "800 DZD / mois" for monthly plans, "5 000 DZD / 3 mois" / "12 000 DZD / an" for Semester/Annual — mirrors components/billing/PlanCard.tsx's own formatting exactly, so the number a visitor sees here never disagrees with what they see after signing up. */
function formatBillingPeriod(durationMonths: number): string {
  if (durationMonths === 1) return "mois";
  if (durationMonths === 12) return "an";
  return `${durationMonths} mois`;
}

/** All 6 real plans from lib/pricing.ts, in the same order the file defines them — Object.keys() order on a plain object literal is guaranteed to be insertion order for string keys in JS, so this doesn't need a separate hand-maintained id list. Prices are the real, live DZD amounts — never fabricated "$9/mo Starter"-style numbers, since a visitor who signs up will see these exact figures again at checkout. */
const LANDING_PLAN_IDS = Object.keys(PLANS) as (keyof typeof PLANS)[];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1">
        {/* --- Hero: text left, photo right (HyperUI split-hero structure) --- */}
        <section className="overflow-hidden bg-slate-50 dark:bg-slate-900/40 sm:grid sm:grid-cols-2">
          <div className="flex flex-col justify-center p-8 md:p-12 lg:px-16 lg:py-24">
            <div className="mx-auto max-w-xl text-center sm:text-left">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-sm font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
                <Sparkles className="h-4 w-4" />
                Conçu pour les facultés de santé algériennes
              </span>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white md:text-4xl">
                Ton second cerveau médical, propulsé par l&apos;IA
              </h1>
              <p className="mt-4 text-slate-600 dark:text-slate-300">
                Transforme tes cours de Médecine, Pharmacie et Chirurgie Dentaire en explications, résumés et QCM
                sur-mesure.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="w-full shadow-[0_0_35px_rgba(20,184,166,0.4)] sm:w-auto">
                  <Link href="/register">
                    Commencer gratuitement
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                  <Link href="/login">Se connecter</Link>
                </Button>
              </div>
            </div>
          </div>
          <div className="relative h-56 w-full sm:h-full">
            <Image src="/1.jpg" alt="Étudiant en médecine révisant avec Med Art AI" fill sizes="(min-width: 640px) 50vw, 100vw" className="object-cover" priority />
          </div>
        </section>

        {/* --- Metrics ---------------------------------------------------- */}
        <RevealSection>
          <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 gap-8 text-center lg:grid-cols-4">
              {METRICS.map((metric) => (
                <div key={metric.label}>
                  <p className="text-4xl font-extrabold text-primary-600 dark:text-primary-400 sm:text-5xl">{metric.value}</p>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{metric.label}</p>
                </div>
              ))}
            </div>
          </section>
        </RevealSection>

        {/* --- Features (6-format grid) --------------------------------- */}
        <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <RevealSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              Tout ce dont tu as besoin pour réussir
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              Chaque cours importé est transformé en six sections complémentaires pensées pour l&apos;examen.
            </p>
          </RevealSection>

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <RevealSection key={feature.title} delay={Math.min(index * 0.08, 0.32)}>
                <MotionCard className="h-full p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{feature.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{feature.description}</p>
                </MotionCard>
              </RevealSection>
            ))}
          </div>
        </section>

        {/* --- How it works: alternating split sections with real photos --- */}
        <section id="how-it-works" className="bg-slate-50 py-20 dark:bg-slate-900/40">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <RevealSection className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Comment ça marche</h2>
            </RevealSection>

            <div className="mt-16 space-y-20">
              {PRODUCT_SURFACES.map((surface, index) => {
                const isReversed = index % 2 === 1;
                return (
                  <RevealSection
                    key={surface.title}
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
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{surface.title}</h3>
                      <p className="mt-3 text-slate-600 dark:text-slate-300">{surface.description}</p>
                    </div>
                    <div className="flex w-full flex-1 justify-center">
                      <MockupFrame
                        accent={surface.accent}
                        src={surface.image}
                        alt={surface.title}
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

        {/* --- Comparison: Étude traditionnelle vs Med Art AI ----------- */}
        <section id="comparaison" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <RevealSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">L&apos;avantage injuste</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">Étude traditionnelle contre Med Art AI.</p>
          </RevealSection>

          <RevealSection delay={0.1} className="relative mt-14 overflow-hidden rounded-3xl border border-white/10 bg-background/50 p-2 backdrop-blur-md sm:p-3">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary-400/10 blur-3xl" />
            <div className="relative grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
              <div className="rounded-2xl border border-rose-200/50 bg-rose-50/50 p-5 dark:border-rose-900/30 dark:bg-rose-950/10 sm:p-6">
                <p className="mb-4 text-xs font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                  Étude traditionnelle
                </p>
                <ul className="space-y-3">
                  {COMPARISON_ROWS.map((row) => (
                    <li key={row.traditional} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      {row.traditional}
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
                    <li key={row.modern} className="flex items-start gap-2 text-sm font-medium text-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      {row.modern}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </RevealSection>
        </section>

        {/* --- Pricing: real plans from lib/pricing.ts ------------------- */}
        <section id="tarifs" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <RevealSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Des tarifs pensés pour les étudiants</h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              Commence gratuitement, passe à un forfait payant quand tu es prêt à réviser sérieusement.
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
                        DZD / {formatBillingPeriod(plan.durationMonths)}
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
                      <Link href="/register">S&apos;inscrire</Link>
                    </Button>
                  </MotionCard>
                </RevealSection>
              );
            })}
          </div>
        </section>

        {/* --- Final CTA ------------------------------------------------ */}
        <RevealSection>
          <section className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 lg:px-8">
            <Card className="bg-gradient-to-br from-primary-600 to-secondary-700 px-8 py-14 text-white">
              <h2 className="text-3xl font-bold">Prêt à étudier plus intelligemment ?</h2>
              <p className="mx-auto mt-4 max-w-xl text-primary-50">
                Rejoins les étudiants en santé qui utilisent déjà Med Art AI pour préparer leurs examens.
              </p>
              <Button asChild size="lg" className="mt-8 bg-white text-primary-700 hover:bg-primary-50">
                <Link href="/register">Créer mon compte étudiant</Link>
              </Button>

              {/* NOTE: /doctors.png is the exact same file that used to be
                  /doctor-3d.png (renamed, not a new asset — confirmed by
                  identical file size before the rename), and its real
                  dimensions are 1024x1024 (square) — object-contain here
                  shows it in full at a small, deliberately restrained size. */}
              <div className="mx-auto mt-8 w-full max-w-sm md:max-w-md">
                <Image
                  src="/doctors.png"
                  alt="L'équipe médicale Med Art AI"
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
