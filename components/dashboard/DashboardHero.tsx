"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { AnimatedBrandMark } from "@/components/layout/AnimatedBrandMark";

interface DashboardHeroProps {
  firstName: string;
  /** The student's saved academic year name (e.g. "3ème année Médecine"), or null if not configured yet in Paramètres — drives which of the two welcome messages renders. */
  academicYearName: string | null;
}

/**
 * Dashboard hero banner — left side is the welcome text, right side is the
 * `public/doctor-3d.png` illustration (a real asset, not hand-coded SVG —
 * see git history for the two earlier SVG attempts this replaced) inside a
 * glassmorphic panel with a soft glow behind it and a slow, subtle float.
 *
 * The image container's own file on disk was actually saved as
 * `doctor-3d.png.png` (double extension) — renamed to the real
 * `doctor-3d.png` before wiring this up, verified as a valid 1024x1024 PNG.
 */
export function DashboardHero({ firstName, academicYearName }: DashboardHeroProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card shadow-glass dark:shadow-glass-dark mb-3 flex flex-col gap-3 rounded-3xl p-3 sm:mb-6 sm:gap-5 sm:p-8 lg:mb-8 lg:flex-row lg:items-center lg:gap-8"
    >
      {/* Left: welcome message */}
      <div className="flex items-center gap-3 sm:gap-4 lg:w-1/2">
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

      {/* Right: doctor-3d.png illustration */}
      <div className="relative h-[250px] w-full lg:h-full lg:w-1/2">
        <motion.div
          animate={{ y: [-5, 5, -5] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          className="relative h-full w-full"
        >
          {/* Soft glow behind the glass panel — extends beyond its edges and
              moves together with the float, rather than sitting statically
              behind a moving box. */}
          <div aria-hidden className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-emerald-400/25 via-cyan-400/15 to-emerald-400/25 blur-2xl" />

          <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm">
            <Image src="/doctor-3d.png" alt="Équipe médicale" fill priority className="object-contain" />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
