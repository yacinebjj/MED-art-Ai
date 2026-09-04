"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { AnimatedBrandMark } from "@/components/layout/AnimatedBrandMark";
import { useLanguage } from "@/providers/LanguageProvider";
import { tDashboard } from "@/lib/translations/dashboard";

interface DashboardHeroProps {
  firstName: string;
  /** The student's saved academic year name (e.g. "3ème année Médecine"), or null if not configured yet in Paramètres — drives which of the two welcome messages renders. */
  academicYearName: string | null;
}

/**
 * Dashboard hero banner. This section went through several illustration
 * experiments before (a hand-coded single-doctor SVG, a two-character SVG
 * duo, a real photo, a live Spline 3D scene, doctor-3d.png) — all removed
 * for not looking right stylistically, landing on text-only for a while;
 * see git history. `doctor-3d.png` briefly lived on the Auth page's
 * marketing panel (components/auth/AuthLayout.tsx) before that panel was
 * removed entirely — it's currently unused anywhere in the app.
 * `doctor-report.png` is still the Sidebar profile badge
 * (components/layout/Sidebar.tsx) — this component owns neither asset.
 *
 * New attempt (chibi illustration set, public/illustrations/) — a flat
 * vector chibi mascot generated via OpenRouter's
 * google/gemini-3.1-flash-image-preview ("nano-banana-2", the same model
 * already proven live for Studio's Infographie tab — see
 * lib/ai/openrouter.ts's IMAGE_MODEL), color-matched to the app's own
 * teal/violet brand gradient (AnimatedBrandMark's from-primary-500
 * to-violet-600) rather than an arbitrary palette. Desktop-only
 * (`hidden md:block`) — same reasoning as every prior illustration attempt
 * here: a decorative image would push real above-the-fold priorities below
 * the fold on a phone, contradicting the shell's no-scroll/compaction goal.
 */
export function DashboardHero({ firstName, academicYearName }: DashboardHeroProps) {
  const { language } = useLanguage();
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card shadow-glass dark:shadow-glass-dark mb-3 flex flex-col gap-3 rounded-3xl p-3 sm:mb-6 sm:flex-row sm:items-center sm:gap-5 sm:p-8 lg:mb-8"
    >
      <div className="flex flex-1 items-center gap-3 sm:gap-4">
        <AnimatedBrandMark size="sm" className="sm:hidden" />
        <AnimatedBrandMark size="md" className="hidden sm:flex" />
        <div className="min-w-0">
          <h1 className="break-words text-base font-bold tracking-tight text-foreground sm:text-xl lg:text-2xl">
            {tDashboard("heroGreeting", language).replace("{name}", firstName)}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
            {academicYearName
              ? tDashboard("heroWelcomeWithYear", language).replace("{year}", academicYearName)
              : tDashboard("heroWelcomeNoYear", language)}
          </p>
        </div>
      </div>
      {/*
       * No card/frame/rounded-corner wrapper or drop shadow around the
       * mascot anymore — that container (rounded-2xl, shadow-md) is what
       * changed here, per explicit product direction ("aucune carte, cadre
       * ou fond carré derrière elle"). The image itself was also
       * regenerated (nano-banana-2) — the original had a teal/violet
       * gradient square baked into the picture; this one is a plain,
       * uniform white background instead.
       *
       * HONEST LIMITATION: true alpha-channel transparency (a real PNG
       * cutout) was attempted twice and is NOT achievable through this
       * image-generation pipeline — explicitly asking for "transparent"
       * makes the model draw a literal checkerboard PATTERN as pixels (the
       * conventional editor placeholder for transparency, not real alpha),
       * and it only ever returns JPEG regardless of the requested format.
       * A flat white background is the closest achievable result: it reads
       * as seamless against this card in light mode, but still shows as a
       * soft white square in dark mode. Fixing that for real would need
       * either a dedicated background-removal step (outside this pipeline)
       * or a hand-authored SVG (like the earlier, now-removed DoctorAIHero
       * attempt) instead of an AI-generated raster image.
       */}
      <div className="hidden shrink-0 md:block">
        <Image
          src="/illustrations/dashboard-hero-mascot.jpeg"
          alt=""
          role="presentation"
          width={112}
          height={112}
          className="h-24 w-24 object-contain lg:h-28 lg:w-28"
          priority
        />
      </div>
    </motion.div>
  );
}
