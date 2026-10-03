"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Crown, GraduationCap, Hourglass, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useCockpitUi } from "@/store/useCockpitUi";
import { HeroMascot } from "@/components/dashboard/DashboardHero";
import { Kbd } from "@/components/course/workspace/os/Kbd";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import { tCockpit } from "@/lib/translations/cockpit";
import { FLASHCARD_ENGINE_LABEL } from "@/lib/dashboard/engine";
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

function Pill({ icon: Icon, children, className }: { icon: typeof Cpu; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur", className)}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

/** Contextual greeting + live identity badges (study level, plan, AI engine connectivity) + Spotlight entry. */
export function CockpitHeader() {
  const { profile, curriculumProfile } = useAuth();
  const { language } = useLanguage();
  const plan = useCockpitStore((state) => state.overview?.plan ?? null);
  const status = useCockpitStore((state) => state.status);
  const setSpotlightOpen = useCockpitUi((state) => state.setSpotlightOpen);
  const now = useNow();
  const [quoteIndex, setQuoteIndex] = useState(0);
  useEffect(() => setQuoteIndex(Math.floor(Math.random() * QUOTES.fr.length)), []);

  const firstName = profile?.fullName?.trim().split(" ")[0] || tCockpit("fallbackName", language);
  const greeting = now ? tCockpit(greetingKey(now.getHours()), language) : tCockpit("greetDefault", language);
  const dateLabel = now
    ? now.toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long" })
    : "";

  const year = curriculumProfile?.academicYear?.name ?? null;
  const specialty = curriculumProfile?.specialty?.name ?? null;
  const engineOnline = status !== "offline" && status !== "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card relative overflow-hidden rounded-3xl border border-white/30 p-4 shadow-glass dark:border-white/[0.06] dark:shadow-glass-dark sm:p-6 lg:p-7"
    >
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-primary-400/20 blur-3xl dark:bg-primary-500/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 right-10 h-64 w-64 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-500/10" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-600 first-letter:uppercase dark:text-primary-400">{dateLabel || " "}</p>
          <h1 className="mt-1 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl lg:text-[1.75rem]">
            {greeting}, <span className="bg-gradient-to-r from-primary-600 via-cyan-500 to-violet-600 bg-clip-text text-transparent dark:from-primary-300 dark:via-cyan-300 dark:to-violet-300">Dr. {firstName}</span>
          </h1>
          <p className="mt-1.5 line-clamp-2 text-sm italic text-muted-foreground">« {QUOTES[language][quoteIndex]} »</p>

          <div className="mt-3 flex flex-wrap gap-1.5">
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
            {plan &&
              (plan.paidActive ? (
                <Pill icon={Crown} className="border-amber-300/70 bg-gradient-to-r from-amber-100/80 to-orange-100/80 text-amber-800 dark:border-amber-700/50 dark:from-amber-950/40 dark:to-orange-950/40 dark:text-amber-300">
                  {tCockpit("memberBadge", language).replace("{plan}", plan.label)} ⚡
                </Pill>
              ) : plan.trialActive ? (
                <Pill icon={Hourglass} className="border-amber-300/70 bg-amber-50/70 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
                  {tCockpit("trialBadge", language).replace("{n}", String(plan.trialDaysRemaining))}
                </Pill>
              ) : (
                <Pill icon={Sparkles} className="border-border/70 bg-background/50 text-muted-foreground">
                  {plan.label}
                </Pill>
              ))}
            <Pill icon={Cpu} className="border-emerald-200/70 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
              {FLASHCARD_ENGINE_LABEL}
              <span className={cn("ml-0.5 h-1.5 w-1.5 rounded-full", engineOnline ? "animate-pulse bg-emerald-500" : "bg-slate-400")} />
              <span className="sr-only">{engineOnline ? tCockpit("engineOnline", language) : tCockpit("engineOffline", language)}</span>
            </Pill>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSpotlightOpen(true)}
            className="group flex flex-1 items-center gap-3 rounded-2xl border border-white/40 bg-white/50 px-4 py-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-primary-800 sm:hidden"
          >
            <Search className="h-4 w-4 text-primary-500" />
            <span className="flex-1 text-sm text-muted-foreground">{tCockpit("spotlightTrigger", language)}</span>
          </button>
          <div className="hidden flex-col items-end gap-2 sm:flex">
            <HeroMascot className="h-24 w-24 lg:h-28 lg:w-28" />
            <button
              type="button"
              onClick={() => setSpotlightOpen(true)}
              className="hidden items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground md:flex"
            >
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
              {tCockpit("spotlightHint", language)}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
