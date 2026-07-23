import Link from "next/link";
import {
  BookOpenText,
  ListChecks,
  ShieldAlert,
  Brain,
  Stethoscope,
  GraduationCap,
  UploadCloud,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MotionCard } from "@/components/ui/MotionCard";

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

const STEPS = [
  {
    icon: UploadCloud,
    title: "1. Téléverse ton cours",
    description: "PDF, PPTX ou DOCX — dépose ton support de cours en quelques secondes.",
  },
  {
    icon: Sparkles,
    title: "2. L'IA analyse le contenu",
    description: "Med Art AI structure ton cours en 6 formats d'étude complémentaires.",
  },
  {
    icon: GraduationCap,
    title: "3. Révise et réussis",
    description: "Explore chaque section, entraîne-toi aux QCMs, et prépare ton examen sereinement.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-b from-primary-50 via-white to-white dark:from-primary-950/40 dark:via-slate-950 dark:to-slate-950"
            aria-hidden
          />
          <div className="mx-auto max-w-5xl px-4 py-24 text-center sm:px-6 lg:px-8">
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-1.5 text-sm font-medium text-primary-700 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-300">
              <Sparkles className="h-4 w-4" />
              Conçu pour les facultés de santé algériennes
            </span>
            <h1 className="text-balance text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-6xl">
              Transforme tes cours en{" "}
              <span className="bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                outils de réussite
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-slate-600 dark:text-slate-300">
              Med Art AI aide les étudiants en Médecine, Pharmacie et Chirurgie Dentaire à
              comprendre, mémoriser et réussir leurs examens grâce à des cours enrichis par l'IA.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link href="/register">
                  Commencer gratuitement
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
                <Link href="/login">J'ai déjà un compte</Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
              Un seul cours, 6 façons de le maîtriser
            </h2>
            <p className="mt-4 text-slate-600 dark:text-slate-300">
              Chaque cours importé est transformé en six sections complémentaires pensées pour
              l'examen.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <MotionCard key={feature.title} className="p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {feature.description}
                </p>
              </MotionCard>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="bg-slate-50 py-20 dark:bg-slate-900/40"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
                Comment ça marche
              </h2>
            </div>

            <div className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.title} className="text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-primary-600 shadow-card dark:bg-slate-900 dark:text-primary-400">
                    <step.icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <Card className="bg-gradient-to-br from-primary-600 to-secondary-700 px-8 py-14 text-white">
            <h2 className="text-3xl font-bold">Prêt à étudier plus intelligemment ?</h2>
            <p className="mx-auto mt-4 max-w-xl text-primary-50">
              Rejoins les étudiants en santé qui utilisent déjà Med Art AI pour préparer leurs
              examens.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-8 bg-white text-primary-700 hover:bg-primary-50"
            >
              <Link href="/register">Créer mon compte étudiant</Link>
            </Button>
          </Card>
        </section>
      </main>

      <Footer />
    </div>
  );
}
