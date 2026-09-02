"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, Search, Settings, Sparkles } from "lucide-react";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { LectureNotesUploader } from "@/components/dashboard/LectureNotesUploader";
import { CurriculumView, CurriculumViewSkeleton } from "@/components/curriculum/CurriculumView";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider"; // 👈 استيراد اللغة
import { tDashboard } from "@/lib/translations/dashboard";
import type { CurriculumYearData } from "@/types/academic";

// 👈 المقولات التحفيزية باللغتين
const MOTIVATIONAL_QUOTES = {
  fr: [
    "Le succès est la somme de petits efforts, répétés jour après jour. 🌟",
    "Chaque page lue aujourd'hui est une vie sauvée demain. 🩺",
    "La médecine est une science d'incertitude et un art de probabilité. 🧠",
    "Crois en toi. Il y a quelque chose en toi de plus grand que n'importe quel obstacle. 💪",
    "N'oublie jamais pourquoi tu as commencé : pour faire la différence. ❤️",
    "La fatigue passe, mais le titre de docteur reste. Ne lâche rien ! 📚",
    "Les défis rendent la vie intéressante ; les surmonter lui donne un sens. 🚀"
  ],
  en: [
    "Success is the sum of small efforts, repeated day in and day out. 🌟",
    "Every page read today is a life saved tomorrow. 🩺",
    "Medicine is a science of uncertainty and an art of probability. 🧠",
    "Believe in yourself. There is something inside you that is greater than any obstacle. 💪",
    "Never forget why you started: to make a difference. ❤️",
    "Fatigue fades, but the title of Doctor remains. Don't give up! 📚",
    "Challenges are what make life interesting; overcoming them is what makes life meaningful. 🚀"
  ]
};

export default function DashboardPage() {
  const router = useRouter();
  const auth = useAuth() ?? {};
  const profile = auth.profile;
  const curriculumProfile = auth.curriculumProfile;
  const { language } = useLanguage(); // 👈 جلب اللغة الحالية

  const [searchQuery, setSearchQuery] = useState("");
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    // 👈 نختارو رقم مقولة باش تتبدل باللغتين نفس المقولة
    setQuoteIndex(Math.floor(Math.random() * MOTIVATIONAL_QUOTES.fr.length));
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/dashboard/search?q=${encodeURIComponent(searchQuery.trim())}`);
  }

  const [curriculumData, setCurriculumData] = useState<CurriculumYearData | null>(null);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  const curriculumSpecialtyName = curriculumProfile?.specialty?.name ?? null;
  const curriculumLevel = curriculumProfile?.academicYear?.level ?? null;

  useEffect(() => {
    if (!curriculumSpecialtyName || curriculumLevel == null) {
      setCurriculumData(null);
      return;
    }

    let cancelled = false;
    setCurriculumLoading(true);
    setCurriculumError(null);

    fetch(`/api/curriculum?specialty=${encodeURIComponent(curriculumSpecialtyName)}&level=${curriculumLevel}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? tDashboard("curriculumLoadError", language));
        return body as CurriculumYearData;
      })
      .then((body) => {
        if (!cancelled) setCurriculumData(body);
      })
      .catch((err) => {
        if (!cancelled) {
          setCurriculumError(err instanceof Error ? err.message : tDashboard("curriculumLoadError", language));
          setCurriculumData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCurriculumLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `language` is intentionally omitted: it only picks the fallback error
    // string's locale and must not trigger a curriculum refetch on toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculumSpecialtyName, curriculumLevel]);

  const firstName = profile?.fullName?.split(" ")[0] || tDashboard("fallbackStudentName", language);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <DashboardHero firstName={firstName} academicYearName={curriculumProfile?.academicYear?.name ?? null} />
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground italic sm:line-clamp-none">
            « {MOTIVATIONAL_QUOTES[language][quoteIndex]} »
          </p>
        </div>
        <div className="mt-1 shrink-0">
          <LanguageToggle />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="mb-3 grid grid-cols-2 gap-2 sm:mb-6 sm:gap-4 md:grid-cols-4 lg:mb-8 xl:grid-cols-5"
      >
        {/* Remplace l'ancienne entrée "Importer un cours indépendant" — même
            emplacement, même prééminence visuelle, nouvelle destination. */}
        <Link
          href="/dashboard/audio-workspace"
          className="glass-card group col-span-2 flex items-center gap-3 rounded-2xl p-3 text-left shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-orange-500/20 dark:shadow-glass-dark sm:gap-5 sm:rounded-3xl sm:p-6 xl:col-span-3"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-[0_0_20px_rgba(249,115,22,0.5)] transition-transform duration-300 group-hover:scale-110 sm:h-14 sm:w-14 sm:rounded-2xl">
            <Mic className="h-5 w-5 sm:h-7 sm:w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground sm:text-lg">Audio to Smart Notes</p>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block sm:text-sm">
              Enregistre ou importe un cours audio — l&apos;IA en sort des notes structurées.
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all duration-300 active:scale-95 sm:flex">
            <Sparkles className="h-4 w-4" />
            Ouvrir
          </span>
        </Link>

        <Link
          href="/dashboard/assistant"
          className="glass-card group flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 text-center shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-violet-500/20 dark:shadow-glass-dark sm:rounded-3xl sm:p-6 xl:flex-row xl:justify-start xl:gap-3"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_0_16px_rgba(168,85,247,0.5)] transition-transform duration-300 group-hover:scale-110 sm:h-11 sm:w-11">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
          <span className="text-xs font-bold text-foreground sm:text-sm">
            {tDashboard("assistantLabel", language)}
          </span>
        </Link>

        <form
          onSubmit={handleSearchSubmit}
          className="glass-card flex items-center gap-2 rounded-2xl p-3 shadow-glass transition-all duration-300 focus-within:-translate-y-1 focus-within:shadow-emerald-500/20 dark:shadow-glass-dark sm:gap-3 sm:rounded-3xl sm:p-6 lg:col-span-1"
        >
          <Search className="h-4 w-4 shrink-0 text-primary-500 dark:text-primary-300" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tDashboard("searchPlaceholder", language)}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <button
            type="submit"
            disabled={!searchQuery.trim()}
            className="hidden shrink-0 rounded-xl bg-primary-600 px-3 py-2 text-xs font-bold text-white transition-all duration-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:block"
          >
            OK
          </button>
        </form>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.09, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 sm:mb-8 lg:mb-10"
      >
        <h2 className="mb-2 text-base font-bold tracking-tight text-foreground sm:mb-4 sm:text-xl">
          Audio to Smart Notes
        </h2>
        <LectureNotesUploader />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="mb-2 text-base font-bold tracking-tight text-foreground sm:mb-4 sm:text-xl">
          {tDashboard("myCurriculumHeading", language)}
          {curriculumProfile?.academicYear ? ` — ${curriculumProfile.academicYear.name}` : ""}
        </h2>

        {curriculumProfile === null || curriculumLoading ? (
          <CurriculumViewSkeleton />
        ) : !curriculumProfile?.academicYear ? (
          <div className="glass-card flex flex-col items-start gap-3 rounded-3xl border-dashed p-3 text-sm text-muted-foreground sm:p-6">
            <p>
              {tDashboard("chooseSpecialtyHelper", language)}
            </p>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-bold text-white transition-all duration-300 active:scale-95"
            >
              <Settings className="h-3.5 w-3.5" />
              {tDashboard("goToSettings", language)}
            </Link>
          </div>
        ) : curriculumError ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {curriculumError}
          </p>
        ) : curriculumData ? (
          <CurriculumView data={curriculumData} />
        ) : null}
      </motion.section>
    </div>
  );
}
