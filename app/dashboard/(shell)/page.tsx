"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, Settings, UploadCloud } from "lucide-react";
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

/**
 * The client wants the "Mes cours indépendants (Historique)" section to show
 * only these two courses for now, without touching the database (no DELETE)
 * — so this is a pure frontend filter over whatever `/api/courses/list`
 * actually returns. Matched by keyword against the real title, not module_id
 * (e.g. "masterclass : la gastrite" is filed under a real module, but must
 * still show up here), accent/case-insensitive so "Pleurésie" and
 * "pleuresie" both hit.
 */
const HISTORIQUE_VISIBLE_KEYWORDS = ["pleuresie", "gastrite"];

function normalizeForMatch(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

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

  function handleDeleted(slug: string) {
    setCourses((prev) => prev.filter((c) => c.slug !== slug));
  }

  function handleRenamed(slug: string, title: string) {
    setCourses((prev) => prev.map((c) => (c.slug === slug ? { ...c, title } : c)));
  }

  function handleModuleChanged(slug: string, moduleId: number) {
    setCourses((prev) => prev.map((c) => (c.slug === slug ? { ...c, module_id: moduleId } : c)));
  }

  function handleModuleCreated(newModule: ModuleSummary) {
    setModules((prev) => (prev.some((m) => m.id === newModule.id) ? prev : [...prev, newModule]));
  }

  const historiqueCourses = useMemo(
    () => courses.filter((c) => HISTORIQUE_VISIBLE_KEYWORDS.some((keyword) => normalizeForMatch(c.title).includes(keyword))),
    [courses]
  );

  const firstName = profile?.fullName?.split(" ")[0] || "Étudiant(e)";

  return (
    <div className="mx-auto max-w-7xl">
      {/* --- 1. Hero & Actions Rapides ------------------------------------ */}
      <div className="mb-10 flex flex-col gap-5 rounded-2xl bg-gradient-to-br from-teal-50 via-cyan-50 to-white p-6 sm:flex-row sm:items-center sm:justify-between dark:from-teal-950/40 dark:via-cyan-950/20 dark:to-neutral-950">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Bonjour Dr. {firstName} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {curriculumProfile?.academicYear
              ? `Bienvenue dans ton espace de ${curriculumProfile.academicYear.name} — choisis une unité, un module indépendant, ou ajoute un cours indépendant.`
              : "Choisis ta spécialité et ton année dans les Paramètres pour voir ton programme — en attendant, ajoute un cours indépendant."}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href="/dashboard/demo"
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-200 dark:hover:bg-neutral-800"
          >
            👀 Voir la Démo
          </Link>
        </div>
      </div>

      {/* --- 2. Ajouter un cours indépendant — juste au-dessus de la grille */}
      <div className="relative mb-8">
        {/* Soft pulsing glow layer behind the card — subtler in light mode, deeper in dark mode. */}
        <div className="absolute -inset-0.5 animate-pulse rounded-2xl bg-gradient-to-r from-blue-600/20 via-cyan-500/15 to-blue-600/20 blur-md dark:from-blue-600/40 dark:via-cyan-500/30 dark:to-blue-600/40" />

        <button
          onClick={() => setModalOpen(true)}
          className="relative flex w-full items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-md shadow-blue-500/5 transition-all duration-300 hover:border-blue-400 hover:shadow-[0_0_30px_rgba(37,99,235,0.15)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-xl dark:shadow-black/40 dark:hover:border-blue-500/60 dark:hover:shadow-[0_0_35px_rgba(37,99,235,0.35)]"
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.6)]">
            <UploadCloud className="h-7 w-7" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-slate-900 dark:text-white">Ajouter un cours indépendant</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Importe un PDF ou un document sans l'associer à un module — tu pourras le classer plus tard.
            </p>
          </div>

          <span className="hidden shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-blue-500 sm:flex">
            <Plus className="h-4 w-4" />
            Importer
          </span>
        </button>
      </div>

      {/* --- 2b. Recherche sémantique — redirige vers /dashboard/search ---- */}
      <form onSubmit={handleSearchSubmit} className="relative mb-8">
        <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-blue-600/15 via-cyan-500/10 to-blue-600/15 blur-md dark:from-blue-600/30 dark:via-cyan-500/20 dark:to-blue-600/30" />
        <div className="relative flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-md shadow-blue-500/5 transition-all duration-300 focus-within:border-blue-400 focus-within:shadow-[0_0_25px_rgba(37,99,235,0.15)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-xl dark:shadow-black/40 dark:focus-within:border-blue-500/60 dark:focus-within:shadow-[0_0_25px_rgba(37,99,235,0.3)]">
          <Search className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-300" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un concept dans tous mes cours..."
            className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={!searchQuery.trim()}
            className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Rechercher
          </button>
        </div>
      </form>

      {/* --- 3. Programme officiel — dépend de la spécialité/année réelles */}
      {/* enregistrées dans le profil (voir providers/AuthProvider.tsx et    */}
      {/* app/api/curriculum/route.ts). Fini le blocage sur "1ère année" :   */}
      {/* ce bloc suit exactement ce que l'étudiant a choisi dans Paramètres.*/}
      <section className="mb-10">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-slate-900 dark:text-gray-100">
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
          <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 dark:border-neutral-800 dark:bg-neutral-900/50 dark:text-gray-400">
            <p>Choisis ta spécialité et ton année dans les Paramètres pour afficher tes unités d&apos;enseignement.</p>
            <Link
              href="/dashboard/settings"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-500"
            >
              <Settings className="h-3.5 w-3.5" />
              Aller aux Paramètres
            </Link>
          </div>
        ) : curriculumError ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {curriculumError}
          </p>
        ) : curriculumData ? (
          <CurriculumView data={curriculumData} />
        ) : null}
      </section>

      <hr className="my-10 border-slate-200 dark:border-neutral-800" />

      {/* --- 4. Historique — la grille Bento du programme ci-dessus gère   */}
      {/* déjà la navigation par module ; cette section ne montre plus que  */}
      {/* les cours indépendants du client (filtrage frontend, DB intacte). */}
      <section>
        <h2 className="mb-6 text-xl font-bold tracking-tight text-slate-900 dark:text-gray-100">
          Mes cours indépendants (Historique)
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : historiqueCourses.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            Aucun cours pour l'instant.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:grid-cols-4">
            {historiqueCourses.map((course) => (
              <PublicCourseCard
                key={course.id}
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
            ))}
          </div>
        )}
      </section>

      <UploadModal open={modalOpen} onOpenChange={setModalOpen} onUploaded={handleUploaded} />
    </div>
  );
}
