"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayFirstName } from "@/lib/display-name";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { GlassArt } from "@/components/ui/GlassArt";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import { tCockpit } from "@/lib/translations/cockpit";
import { useNow } from "./primitives";

const QUOTES = {
  fr: [
    "Le succès est la somme de petits efforts, répétés jour après jour.",
    "Chaque page lue aujourd'hui est une vie sauvée demain.",
    "La médecine est une science d'incertitude et un art de probabilité.",
    "La fatigue passe, mais le titre de docteur reste. Ne lâche rien !",
    "N'oublie jamais pourquoi tu as commencé : pour faire la différence.",
  ],
  en: [
    "Success is the sum of small efforts, repeated day in and day out.",
    "Every page read today is a life saved tomorrow.",
    "Medicine is a science of uncertainty and an art of probability.",
    "Fatigue fades, but the title of Doctor remains. Don't give up!",
    "Never forget why you started: to make a difference.",
  ],
};

function greetingKey(hour: number) {
  if (hour < 5) return "greetNight" as const;
  if (hour < 12) return "greetMorning" as const;
  if (hour < 18) return "greetAfternoon" as const;
  return "greetEvening" as const;
}

function Pill({ icon: Icon, children, className }: { icon: typeof GraduationCap; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur", className)}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

/**
 * Contextual greeting + the student's study level. The plan ("Membre …") and
 * engine badges and the "Recherche globale" link were removed by product
 * order (2026-11-07): the plan lives in the top bar, and the Spotlight still
 * opens with Ctrl/⌘ K. On phones it is just the date and the greeting, set
 * straight on the page (no card) — the Resume card right below is what the
 * student came for.
 */
export function CockpitHeader() {
  const { profile, curriculumProfile } = useAuth();
  const { language } = useLanguage();
  const now = useNow();
  const [quoteIndex, setQuoteIndex] = useState(0);
  useEffect(() => setQuoteIndex(Math.floor(Math.random() * QUOTES.fr.length)), []);

  const firstName = displayFirstName(profile?.fullName) ?? tCockpit("fallbackName", language);
  const greeting = now ? tCockpit(greetingKey(now.getHours()), language) : tCockpit("greetDefault", language);
  const dateLabel = now
    ? now.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long" })
    : "";

  const year = curriculumProfile?.academicYear?.name ?? null;
  const specialty = curriculumProfile?.specialty?.name ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card relative overflow-hidden rounded-3xl border border-white/30 px-1 pt-1 shadow-glass dark:border-white/[0.06] dark:shadow-glass-dark flat-on-phone sm:p-6 lg:p-7"
    >
      {/* Decorative glows: desktop only — a 64-unit blur-3xl is a full-layer GPU filter phones pay for on every scroll frame. */}
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 hidden h-64 w-64 rounded-full bg-primary-400/20 blur-3xl dark:bg-primary-500/10 sm:block" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 right-10 hidden h-64 w-64 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-500/10 sm:block" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-600 first-letter:uppercase dark:text-primary-400">{dateLabel || " "}</p>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl lg:text-[1.75rem]">
            {greeting}, <span className="bg-gradient-to-r from-primary-600 via-cyan-500 to-violet-600 bg-clip-text text-transparent dark:from-primary-300 dark:via-cyan-300 dark:to-violet-300">Dr. {firstName}</span>
          </h1>
          <p className="mt-1.5 line-clamp-2 text-sm italic text-muted-foreground max-sm:hidden">« {QUOTES[language][quoteIndex]} »</p>

          <div className="mt-3 hidden flex-wrap gap-1.5 sm:flex">
            {year ? (
              <Pill icon={GraduationCap} className="border-primary-200/70 bg-primary-50/70 text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/40 dark:text-primary-300">
                {translateCurriculumName(year, language)}
                {specialty ? ` · ${translateCurriculumName(specialty, language)}` : ""}
              </Pill>
            ) : (
              <Pill icon={GraduationCap} className="border-border/70 bg-background/50 text-muted-foreground">
                {tCockpit("levelNotSet", language)}
              </Pill>
            )}
          </div>
        </div>

        <div className="hidden items-center gap-4 sm:flex">
          <GlassArt
            name="stethoscope"
            size={112}
            className="h-24 w-24 animate-float drop-shadow-[0_12px_22px_rgba(2,132,199,0.25)] motion-reduce:animate-none lg:h-28 lg:w-28"
          />
        </div>
      </div>
    </motion.div>
  );
}
