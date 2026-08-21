"use client";

import { motion } from "framer-motion";
import { AnimatedBrandMark } from "@/components/layout/AnimatedBrandMark";

interface DashboardHeroProps {
  firstName: string;
  /** The student's saved academic year name (e.g. "3ème année Médecine"), or null if not configured yet in Paramètres — drives which of the two welcome messages renders. */
  academicYearName: string | null;
}

/**
 * Dashboard hero banner — text-only welcome card, no illustration/graphic
 * of any kind. This section has gone through several illustration
 * experiments (a hand-coded single-doctor SVG, a two-character SVG duo, a
 * real photo, a live Spline 3D scene, doctor-3d.png) — all removed; see git
 * history. `doctor-3d.png` briefly lived on the Auth page's marketing
 * panel (components/auth/AuthLayout.tsx) before that panel was removed
 * entirely — it's currently unused anywhere in the app. `doctor-report.png`
 * is still the Sidebar profile badge (components/layout/Sidebar.tsx) — this
 * component owns neither asset.
 */
export function DashboardHero({ firstName, academicYearName }: DashboardHeroProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card shadow-glass dark:shadow-glass-dark mb-3 flex flex-col gap-3 rounded-3xl p-3 sm:mb-6 sm:flex-row sm:items-center sm:gap-5 sm:p-8 lg:mb-8"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <AnimatedBrandMark size="sm" className="sm:hidden" />
        <AnimatedBrandMark size="md" className="hidden sm:flex" />
        <div>
          <h1 className="text-base font-bold tracking-tight text-foreground sm:text-xl lg:text-2xl">Bonjour Dr. {firstName} 👋</h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
            {academicYearName
              ? `Bienvenue dans ton espace de ${academicYearName} — choisis une unité, un module indépendant, ou ajoute un cours indépendant.`
              : "Choisis ta spécialité et ton année dans les Paramètres pour voir ton programme — en attendant, ajoute un cours indépendant."}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
