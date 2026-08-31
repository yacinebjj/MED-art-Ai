"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, Plus, Search, Settings, Sparkles, UploadCloud } from "lucide-react";
import { DashboardHero } from "@/components/dashboard/DashboardHero";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { PublicCourseCard } from "@/components/dashboard/PublicCourseCard";
import { CurriculumView, CurriculumViewSkeleton } from "@/components/curriculum/CurriculumView";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider"; // 👈 استيراد اللغة
import { tDashboard } from "@/lib/translations/dashboard";
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";
import {
  MOCK_READING_PROGRESS_BY_COURSE_SLUG,
  MOCK_QCM_FALLBACK_BY_COURSE_SLUG,
  MOCK_SRS_MASTERY_FALLBACK_BY_COURSE_SLUG,
} from "@/lib/mock-course-progress";
import { MAX_LEITNER_BOX } from "@/lib/srs";
import type { CurriculumYearData } from "@/types/academic";

const CARD_GRID_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const CARD_ITEM_VARIANTS = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

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

  const [modalOpen, setModalOpen] = useState(false);
  const [courses, setCourses] = useState<PublicCourseSummary[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
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

  const refreshCourses = useCallback(async () => {
    try {
      const res = await fetch("/api/courses/list");
      const data = await res.json().catch(() => ({}));
      setCourses(data.courses ?? []);
    } catch {
      setCourses([]);
    }
  }, []);

  const refreshModules = useCallback(async () => {
    try {
      const res = await fetch("/api/modules");
      const data = await res.json().catch(() => ({}));
      setModules(data.modules ?? []);
    } catch {
      setModules([]);
    }
  }, []);

  const [courseMastery, setCourseMastery] = useState<
    { course_slug: string; mastery_pct: number; avg_leitner_box: number | null }[]
  >([]);

  const refreshCourseMastery = useCallback(async () => {
    try {
      const res = await fetch("/api/srs/course-mastery");
      const data = await res.json().catch(() => ({}));
      setCourseMastery(data.mastery ?? []);
    } catch {
      setCourseMastery([]);
    }
  }, []);

  useEffect(() => {
    Promise.all([refreshCourses(), refreshModules(), refreshCourseMastery()]).finally(() => setLoading(false));
  }, [refreshCourses, refreshModules, refreshCourseMastery]);

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

  const examReadinessByCourseSlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of courseMastery) map.set(row.course_slug, row.mastery_pct);
    for (const [slug, pct] of Object.entries(MOCK_QCM_FALLBACK_BY_COURSE_SLUG)) {
      if (!map.has(slug)) map.set(slug, pct);
    }
    return map;
  }, [courseMastery]);

  const srsMasteryByCourseSlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of courseMastery) {
      if (row.avg_leitner_box == null) continue;
      const normalized = ((row.avg_leitner_box - 1) / (MAX_LEITNER_BOX - 1)) * 100;
      map.set(row.course_slug, Math.max(0, Math.min(100, normalized)));
    }
    for (const [slug, pct] of Object.entries(MOCK_SRS_MASTERY_FALLBACK_BY_COURSE_SLUG)) {
      if (!map.has(slug)) map.set(slug, pct);
    }
    return map;
  }, [courseMastery]);

  const readingProgressByCourseSlug = useMemo(() => new Map(Object.entries(MOCK_READING_PROGRESS_BY_COURSE_SLUG)), []);

  function handleUploaded(slug: string) {
    router.push(`/dashboard/demo/${slug}`);
  }

  const handleDeleted = useCallback((slug: string) => {
    setCourses((prev) => prev.filter((c) => c.slug !== slug));
  }, []);

  const handleRenamed = useCallback((slug: string, title: string) => {
    setCourses((prev) => prev.map((c) => (c.slug === slug ? { ...c, title } : c)));
  }, []);

  const handleModuleChanged = useCallback((slug: string, moduleId: number) => {
    setCourses((prev) => prev.map((c) => (c.slug === slug ? { ...c, module_id: moduleId } : c)));
  }, []);

  const handleModuleCreated = useCallback((newModule: ModuleSummary) => {
    setModules((prev) => (prev.some((m) => m.id === newModule.id) ? prev : [...prev, newModule]));
  }, []);

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
        <button
          onClick={() => setModalOpen(true)}
          className="glass-card group col-span-2 flex items-center gap-3 rounded-2xl p-3 text-left shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-emerald-500/20 dark:shadow-glass-dark sm:gap-5 sm:rounded-3xl sm:p-6 xl:col-span-3"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-transform duration-300 group-hover:scale-110 sm:h-14 sm:w-14 sm:rounded-2xl">
            <UploadCloud className="h-5 w-5 sm:h-7 sm:w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground sm:text-lg">
              {tDashboard("addCourseHeading", language)}
            </p>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block sm:text-sm">
              {tDashboard("addCourseHelper", language)}
            </p>
          </div>
          <span className="hidden shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all duration-300 active:scale-95 sm:flex">
            <Plus className="h-4 w-4" />
            {tDashboard("importButton", language)}
          </span>
        </button>

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
        transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 sm:mb-8 lg:mb-10"
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

      <hr className="my-4 border-white/40 dark:border-white/10 sm:my-8 lg:my-10" />

      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="mb-2 text-base font-bold tracking-tight text-foreground sm:mb-6 sm:text-xl">
          {tDashboard("independentCoursesHeading", language)}
        </h2>

        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card h-36 animate-pulse rounded-2xl sm:h-40 sm:rounded-3xl lg:h-44" />
            ))}
          </div>
        ) : courses.length === 0 ? (
          <div className="glass-card flex flex-col items-center gap-3 rounded-3xl border-dashed p-6 text-center sm:p-10">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <FileText className="h-8 w-8 text-muted-foreground/50" />
            </motion.div>
            <p className="text-sm font-medium text-foreground">
              {tDashboard("noIndependentCourses", language)}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {tDashboard("noIndependentCoursesHelper", language)}
            </p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4"
            variants={CARD_GRID_VARIANTS}
            initial="hidden"
            animate="show"
          >
            {courses.map((course) => (
              <motion.div
                key={course.id}
                variants={CARD_ITEM_VARIANTS}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="rounded-3xl transition-shadow duration-300 hover:shadow-emerald-500/20"
              >
                <PublicCourseCard
                  course={course}
                  modules={modules}
                  onDeleted={handleDeleted}
                  onRenamed={handleRenamed}
                  onModuleChanged={handleModuleChanged}
                  onModuleCreated={handleModuleCreated}
                  readingPct={readingProgressByCourseSlug.get(course.slug)}
                  examReadinessPct={examReadinessByCourseSlug.get(course.slug)}
                  srsMasteryPct={srsMasteryByCourseSlug.get(course.slug)}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.section>

      <UploadModal open={modalOpen} onOpenChange={setModalOpen} onUploaded={handleUploaded} />
    </div>
  );
}