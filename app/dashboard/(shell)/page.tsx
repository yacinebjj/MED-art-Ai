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
import { useAuth } from "@/providers/AuthProvider";
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";
import {
  MOCK_READING_PROGRESS_BY_COURSE_SLUG,
  MOCK_QCM_FALLBACK_BY_COURSE_SLUG,
  MOCK_SRS_MASTERY_FALLBACK_BY_COURSE_SLUG,
} from "@/lib/mock-course-progress";
import { MAX_LEITNER_BOX } from "@/lib/srs";
import type { CurriculumYearData } from "@/types/academic";

// Module-level (not re-created every render): drives the "Mes cours
// indépendants" grid's cascade entrance — each card fades/slides in 50ms
// after the previous one instead of all popping in as a single block.
const CARD_GRID_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const CARD_ITEM_VARIANTS = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export default function DashboardPage() {
  const router = useRouter();
  const { profile, curriculumProfile } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [courses, setCourses] = useState<PublicCourseSummary[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/dashboard/search?q=${encodeURIComponent(searchQuery.trim())}`);
  }

  const refreshCourses = useCallback(async () => {
    const res = await fetch("/api/courses/list");
    const data = await res.json().catch(() => ({}));
    setCourses(data.courses ?? []);
  }, []);

  const refreshModules = useCallback(async () => {
    const res = await fetch("/api/modules");
    const data = await res.json().catch(() => ({}));
    setModules(data.modules ?? []);
  }, []);

  // Real per-course mastery % + avg Leitner box (see the `course_mastery` SQL
  // function and /api/srs/course-mastery) — powers the dual indicator on each
  // course card AND the "Statistiques" modal's QCM/SRS bars.
  const [courseMastery, setCourseMastery] = useState<
    { course_slug: string; mastery_pct: number; avg_leitner_box: number | null }[]
  >([]);

  const refreshCourseMastery = useCallback(async () => {
    const res = await fetch("/api/srs/course-mastery");
    const data = await res.json().catch(() => ({}));
    setCourseMastery(data.mastery ?? []);
  }, []);

  useEffect(() => {
    Promise.all([refreshCourses(), refreshModules(), refreshCourseMastery()]).finally(() => setLoading(false));
  }, [refreshCourses, refreshModules, refreshCourseMastery]);

  // Real official curriculum (UE + modules indépendants) for the student's
  // saved filière/année — see app/api/curriculum/route.ts. Both ids are null
  // until Settings has been filled in at least once; no fallback to a
  // hardcoded year here, an honest empty state below instead.
  const [curriculumData, setCurriculumData] = useState<CurriculumYearData | null>(null);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  // Keyed on the primitive (specialtyName, level) pair, not the
  // `curriculumProfile` object itself: AuthProvider can (legitimately) hand
  // out a new object reference with the exact same content — e.g. once
  // right after login resolves — and re-running this whole fetch on every
  // such reference change was the direct cause of the Dashboard's curriculum
  // section flickering (data reset to null, then re-fetched, then
  // reappeared) even when nothing had actually changed.
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
        if (!res.ok) throw new Error(body?.error ?? "Impossible de charger le programme.");
        return body as CurriculumYearData;
      })
      .then((body) => {
        if (!cancelled) setCurriculumData(body);
      })
      .catch((err) => {
        if (!cancelled) {
          setCurriculumError(err instanceof Error ? err.message : "Impossible de charger le programme.");
          setCurriculumData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCurriculumLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [curriculumSpecialtyName, curriculumLevel]);

  // The mock fallback (lib/mock-course-progress.ts) only fills a gap for a
  // course with zero real attempts; it's dropped the instant real ones exist
  // for that exact slug.
  const examReadinessByCourseSlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of courseMastery) map.set(row.course_slug, row.mastery_pct);
    for (const [slug, pct] of Object.entries(MOCK_QCM_FALLBACK_BY_COURSE_SLUG)) {
      if (!map.has(slug)) map.set(slug, pct);
    }
    return map;
  }, [courseMastery]);

  // Real SRS/memorization % — avg_leitner_box (1..MAX_LEITNER_BOX) normalized
  // to 0-100, same mock-fallback rule as examReadinessByCourseSlug above.
  // Powers the "Statistiques" modal's "Indice de mémorisation" bar.
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

  // Reading/study progress has no real per-user tracking yet anywhere in the
  // app (no "course viewed" instrumentation exists) — entirely a
  // demonstration seed until that ships.
  const readingProgressByCourseSlug = useMemo(() => new Map(Object.entries(MOCK_READING_PROGRESS_BY_COURSE_SLUG)), []);

  // Instant-insert architecture: the upload itself never calls the AI, so the
  // course is immediately ready to open — send the student straight there,
  // where each Studio tab generates its own content on demand (LazySection).
  // It lands with module_id: null, so it also shows up here in "Mes cours"
  // on the next visit until the student files it into a module.
  function handleUploaded(slug: string) {
    router.push(`/dashboard/demo/${slug}`);
  }

  // useCallback with an empty dependency array — each only uses a setter's
  // functional-update form, no other closed-over value — so PublicCourseCard
  // (React.memo-wrapped) receives the SAME function reference across
  // re-renders and never re-renders itself just because the dashboard page
  // did (e.g. on every keystroke in the search box above).
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

  const firstName = profile?.fullName?.split(" ")[0] || "Étudiant(e)";

  return (
    <div className="mx-auto max-w-7xl">
      {/* --- 1. Hero & Actions Rapides ------------------------------------ */}
      <DashboardHero firstName={firstName} academicYearName={curriculumProfile?.academicYear?.name ?? null} />

      {/* --- 2. Actions Rapides : Ajouter un cours, Recherche, Assistant --- */}
      {/* 3-way split so the Assistant/Chat entry point sits right alongside
          Upload/Search, "highly visible... above the fold" on mobile
          (compacted grid-cols-2 there — Assistant + Recherche share a row,
          Importer gets its own full-width row since it's the primary action). */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="mb-3 grid grid-cols-2 gap-2 sm:mb-6 sm:gap-4 lg:mb-8 lg:grid-cols-5"
      >
        <button
          onClick={() => setModalOpen(true)}
          className="glass-card group col-span-2 flex items-center gap-3 rounded-2xl p-3 text-left shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-emerald-500/20 dark:shadow-glass-dark sm:gap-5 sm:rounded-3xl sm:p-6 lg:col-span-3"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-transform duration-300 group-hover:scale-110 sm:h-14 sm:w-14 sm:rounded-2xl">
            <UploadCloud className="h-5 w-5 sm:h-7 sm:w-7" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground sm:text-lg">Ajouter un cours indépendant</p>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block sm:text-sm">
              Importe un PDF ou un document sans l'associer à un module.
            </p>
          </div>

          <span className="hidden shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all duration-300 active:scale-95 sm:flex">
            <Plus className="h-4 w-4" />
            Importer
          </span>
        </button>

        <Link
          href="/dashboard/assistant"
          className="glass-card group flex flex-col items-center justify-center gap-1.5 rounded-2xl p-3 text-center shadow-glass transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-violet-500/20 dark:shadow-glass-dark sm:flex-row sm:justify-start sm:gap-3 sm:rounded-3xl sm:p-6 lg:col-span-1"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_0_16px_rgba(168,85,247,0.5)] transition-transform duration-300 group-hover:scale-110 sm:h-11 sm:w-11">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
          <span className="text-xs font-bold text-foreground sm:text-sm">Assistant</span>
        </Link>

        <form
          onSubmit={handleSearchSubmit}
          className="glass-card flex items-center gap-2 rounded-2xl p-3 shadow-glass transition-all duration-300 focus-within:-translate-y-1 focus-within:shadow-emerald-500/20 dark:shadow-glass-dark sm:gap-3 sm:rounded-3xl sm:p-6 lg:col-span-1"
        >
          <Search className="h-4 w-4 shrink-0 text-primary-500 dark:text-primary-300" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
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

      {/* --- 3. Programme officiel — dépend de la spécialité/année réelles */}
      {/* enregistrées dans le profil (voir providers/AuthProvider.tsx et    */}
      {/* app/api/curriculum/route.ts). Fini le blocage sur "1ère année" :   */}
      {/* ce bloc suit exactement ce que l'étudiant a choisi dans Paramètres.*/}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="mb-4 sm:mb-8 lg:mb-10"
      >
        <h2 className="mb-2 text-base font-bold tracking-tight text-foreground sm:mb-4 sm:text-xl">
          Mon Programme{curriculumProfile?.academicYear ? ` — ${curriculumProfile.academicYear.name}` : ""}
        </h2>

        {curriculumProfile === null || curriculumLoading ? (
          // curriculumProfile === null means AuthProvider hasn't resolved it
          // yet (still loading, not "nothing configured") — showing the
          // skeleton here instead of the "configure your profile" prompt
          // avoids that prompt flashing on screen for a frame before the
          // real (already-configured) state arrives.
          <CurriculumViewSkeleton />
        ) : !curriculumProfile?.academicYear ? (
          <div className="glass-card flex flex-col items-start gap-3 rounded-3xl border-dashed p-3 text-sm text-muted-foreground sm:p-6">
            <p>Choisis ta spécialité et ton année dans les Paramètres pour afficher tes unités d&apos;enseignement.</p>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-bold text-white transition-all duration-300 active:scale-95"
            >
              <Settings className="h-3.5 w-3.5" />
              Aller aux Paramètres
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

      {/* --- 4. Historique — la grille Bento du programme ci-dessus gère   */}
      {/* déjà la navigation par module ; cette section ne montre plus que  */}
      {/* les cours indépendants du client (filtrage frontend, DB intacte). */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 className="mb-2 text-base font-bold tracking-tight text-foreground sm:mb-6 sm:text-xl">
          Mes cours indépendants (Historique)
        </h2>

        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card h-32 animate-pulse rounded-2xl sm:h-40 sm:rounded-3xl" />
            ))}
          </div>
        ) : courses.length === 0 ? (
          <div className="glass-card flex flex-col items-center gap-3 rounded-3xl border-dashed p-6 text-center sm:p-10">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <FileText className="h-8 w-8 text-muted-foreground/50" />
            </motion.div>
            <p className="text-sm font-medium text-foreground">
              Vous n'avez pas encore de cours indépendants.
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Cliquez sur « Ajouter un cours indépendant » ci-dessus pour importer votre premier cours.
            </p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"
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
