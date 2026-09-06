"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AnimatedBrandMark } from "@/components/layout/AnimatedBrandMark";
import { useLanguage } from "@/providers/LanguageProvider";
import { tDashboard, getHeroGreetingKey } from "@/lib/translations/dashboard";

interface DashboardHeroProps {
  firstName: string;
  /** The student's saved academic year name (e.g. "3ème année Médecine"), or null if not configured yet in Paramètres — drives which of the two welcome messages renders. */
  academicYearName: string | null;
}

/**
 * Hand-authored flat-vector chibi doctor — replaces the AI-generated raster
 * mascot (public/illustrations/dashboard-hero-mascot.jpeg) after THREE
 * failed attempts at removing its background: true alpha transparency (the
 * model draws a literal checkerboard pattern as pixels instead of real
 * alpha), a plain white background, and CSS `mix-blend-multiply` (correct
 * in theory — a white source pixel resolves to the backdrop unchanged
 * under multiply, regardless of theme — but confirmed by the user, live in
 * dark mode, to still show a visible box; `.glass-card`'s own
 * `backdrop-filter` most likely breaks the blend calculation in practice,
 * a known fragile interaction between blend-mode and an ancestor's
 * backdrop-filter). An SVG has no background at all by construction — no
 * blend-mode math, no raster artifacts, genuinely transparent in every
 * browser and every theme. Colors match the app's own tokens exactly
 * (teal `primary-600` #0d9488, violet `violet-600` #7c3aed) rather than an
 * arbitrary palette. Verified by rendering this exact markup standalone
 * against both a light and a dark backdrop before wiring it in here — see
 * this session's own scratch preview, not committed anywhere.
 */
function HeroMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden role="presentation">
      {/* coat body */}
      <path d="M 20 98 L 20 68 Q 20 58 30 55 L 40 52 Q 50 56 60 52 L 70 55 Q 80 58 80 68 L 80 98 Z" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
      {/* undershirt */}
      <path d="M 42 55 L 50 66 L 58 55 L 54 52 L 46 52 Z" fill="#0d9488" />
      {/* coat lapels */}
      <path d="M 40 52 L 46 62 L 50 66 L 42 55 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
      <path d="M 60 52 L 54 62 L 50 66 L 58 55 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
      {/* stethoscope */}
      <path d="M 44 54 Q 44 66 50 70 Q 56 66 56 54" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />
      <circle cx="50" cy="72" r="3.2" fill="#7c3aed" />
      {/* left arm — a slow, gentle wave, pivoting at the shoulder */}
      <motion.g
        style={{ transformOrigin: "22px 70px" }}
        animate={{ rotate: [0, -12, 0, -12, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 1.4, ease: "easeInOut" }}
      >
        <path d="M 22 70 Q 10 65 8 50" fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" />
        <circle cx="7" cy="47" r="6.5" fill="#fbcfa0" />
      </motion.g>
      {/* right arm */}
      <path d="M 78 70 Q 86 76 84 88" fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" />
      {/* neck */}
      <rect x="45" y="42" width="10" height="10" rx="3" fill="#fbcfa0" />
      {/* head */}
      <circle cx="50" cy="32" r="18" fill="#fbcfa0" />
      <circle cx="32" cy="32" r="3" fill="#fbcfa0" />
      <circle cx="68" cy="32" r="3" fill="#fbcfa0" />
      {/* hair */}
      <path d="M 32 28 Q 30 10 50 10 Q 70 10 68 28 Q 66 18 50 18 Q 34 18 32 28 Z" fill="#4a3222" />
      <path d="M 30 30 Q 28 20 34 16 Q 30 24 32 32 Z" fill="#4a3222" />
      <path d="M 70 30 Q 72 20 66 16 Q 70 24 68 32 Z" fill="#4a3222" />
      {/* blush */}
      <circle cx="39" cy="36" r="3" fill="#f9a8a8" opacity="0.6" />
      <circle cx="61" cy="36" r="3" fill="#f9a8a8" opacity="0.6" />
      {/* eyes + smile */}
      <circle cx="43" cy="31" r="2.2" fill="#292524" />
      <circle cx="57" cy="31" r="2.2" fill="#292524" />
      <path d="M 44 38 Q 50 42 56 38" fill="none" stroke="#292524" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
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
 * Current attempt: HeroMascot, a hand-authored inline SVG (below) — see its
 * own comment for the full history of why the AI-generated raster image
 * this component used before (public/illustrations/dashboard-hero-
 * mascot.jpeg, now fully retired from here) couldn't get a clean background
 * after three attempts. Desktop-only (`hidden md:block`) — same reasoning
 * as every prior illustration attempt here: a decorative image would push
 * real above-the-fold priorities below the fold on a phone, contradicting
 * the shell's no-scroll/compaction goal.
 */
export function DashboardHero({ firstName, academicYearName }: DashboardHeroProps) {
  const { language } = useLanguage();
  // Client-only (see getHeroGreetingKey's own comment on why the initial
  // render always uses the static "heroGreeting" default rather than reading
  // `new Date()` directly during render).
  const [greetingKey, setGreetingKey] = useState<"heroGreeting" | "heroGreetingMorning" | "heroGreetingAfternoon" | "heroGreetingEvening">("heroGreeting");
  useEffect(() => {
    setGreetingKey(getHeroGreetingKey(new Date().getHours()));
  }, []);

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
            {tDashboard(greetingKey, language).replace("{name}", firstName)}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
            {academicYearName
              ? tDashboard("heroWelcomeWithYear", language).replace("{year}", academicYearName)
              : tDashboard("heroWelcomeNoYear", language)}
          </p>
        </div>
      </div>
      {/* No wrapper div at all now — the <svg> IS the floating element,
          genuinely transparent by construction, no card/frame/background
          of any kind possible. */}
      <HeroMascot className="hidden h-24 w-24 shrink-0 md:block lg:h-28 lg:w-28" />
    </motion.div>
  );
}
