"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Search, UploadCloud } from "lucide-react";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { PublicCourseCard } from "@/components/dashboard/PublicCourseCard";
import { ModuleBentoGrid } from "@/components/dashboard/ModuleBentoGrid";
import { useAuth } from "@/providers/AuthProvider";
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";
import {
  MOCK_READING_PROGRESS_BY_COURSE_SLUG,
  MOCK_QCM_FALLBACK_BY_COURSE_SLUG,
  MOCK_SRS_MASTERY_FALLBACK_BY_COURSE_SLUG,
} from "@/lib/mock-course-progress";
import { MAX_LEITNER_BOX } from "@/lib/srs";

/**
 * Demo/showcase slugs authored before the `courses` table existed — no
 * Supabase row, so no id/module_id, so they can never be renamed, deleted,
 * or moved from the UI. Always merged into the "Gastroentérologie" module's
 * display (matched by name) alongside any real gastro course rows.
 */
// "ulcere" and "rectocolite" were removed from this list: "ulcere" pointed
// at /dashboard/demo/ulcere, a dead legacy slug distinct from
// "ulcere-gastrique" (the real, complete Supabase-backed course); the
// content behind "rectocolite" is now genuinely migrated to Supabase, at
// slug "la-rectocolite-hemorragique-rch-1785846798448" — both used to lead
// to a partially-broken page (only the Explication tab had content;
// Résumé/Cas Clinique/QCM silently fell back to Appendicite's). See
// lib/course-slug-content.ts's comment on CourseSlug for the full story.
// Only "appendicite" remains: the one course intentionally kept as a fully
// hardcoded showcase, with no Supabase row at all.
const LEGACY_GASTRO_SOURCES: { slug: string; title: string }[] = [{ slug: "appendicite", title: "Appendicite_Cours.pdf" }];

function isGastroModule(name: string): boolean {
  return name.trim().toLowerCase().startsWith("gastro");
}

interface WeaknessRadarRow {
  module_id: number;
  module_name: string;
  total_attempts: number;
  correct_attempts: number;
  mastery_pct: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [courses, setCourses] = useState<PublicCourseSummary[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [weaknessRadar, setWeaknessRadar] = useState<WeaknessRadarRow[]>([]);
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

  // Real per-module mastery %, computed server-side by the `weakness_radar`
  // SQL function from actual qcm_attempts — powers the Bento Grid's progress
  // bars (see progressByModuleName below). A 401 here just means "not signed
  // in yet" during the auth bootstrap race, not a real failure — silently
  // falls back to an empty radar (every card shows "Pas encore de données").
  const refreshWeaknessRadar = useCallback(async () => {
    const res = await fetch("/api/srs/weakness-radar");
    const data = await res.json().catch(() => ({}));
    setWeaknessRadar(data.radar ?? []);
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
    Promise.all([refreshCourses(), refreshModules(), refreshWeaknessRadar(), refreshCourseMastery()]).finally(() =>
      setLoading(false)
    );
  }, [refreshCourses, refreshModules, refreshWeaknessRadar, refreshCourseMastery]);

  // Matches each Bento Grid prototype card (a hardcoded name, not a real
  // module row — see ModuleBentoGrid.tsx) to a real module the student has
  // actually created, by name, then to that module's real mastery % from the
  // radar above. Most cards will resolve to nothing until the student has
  // both created a same-named module AND answered QCMs in a course filed
  // under it — that's a true reflection of the data, not a bug.
  const progressByModuleName = useMemo(() => {
    const map = new Map<string, number>();
    for (const mod of modules) {
      const radarRow = weaknessRadar.find((r) => r.module_id === mod.id);
      if (radarRow) map.set(mod.name.trim().toLowerCase(), radarRow.mastery_pct);
    }
    return map;
  }, [modules, weaknessRadar]);

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

  const unassignedCourses = useMemo(() => courses.filter((c) => c.module_id === null), [courses]);

  const coursesByModule = useMemo(() => {
    const map = new Map<number, PublicCourseSummary[]>();
    for (const course of courses) {
      if (course.module_id == null) continue;
      const list = map.get(course.module_id) ?? [];
      list.push(course);
      map.set(course.module_id, list);
    }
    return map;
  }, [courses]);

  const firstName = profile?.fullName?.split(" ")[0] || "Étudiant(e)";

  return (
    <div className="mx-auto max-w-7xl">
      {/* --- 1. Hero & Actions Rapides ------------------------------------ */}
      <div className="mb-10 flex flex-col gap-5 rounded-2xl bg-gradient-to-br from-teal-50 via-cyan-50 to-white p-6 sm:flex-row sm:items-center sm:justify-between dark:from-teal-950/40 dark:via-cyan-950/20 dark:to-neutral-950">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Bonjour, {firstName} 👋</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bienvenue dans ton espace de 1ère année de médecine — choisis un module ou ajoute un cours indépendant.
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

      {/* --- 3. Grille des Modules — 1ère Année Médecine (prototype) ------ */}
      <section className="mb-10">
        <h2 className="mb-4 text-xl font-bold tracking-tight text-slate-900 dark:text-gray-100">Mes Modules — 1ère Année Médecine</h2>
        <ModuleBentoGrid progressByModuleName={progressByModuleName} />
      </section>

      <hr className="my-10 border-slate-200 dark:border-neutral-800" />

      {/* --- 4. Historique — code EXISTANT, intégralement conservé, juste  */}
      {/* déplacé sous ce nouveau titre. Ne rien changer ci-dessous.       */}
      <section>
        <h2 className="mb-6 text-xl font-bold tracking-tight text-slate-900 dark:text-gray-100">Mes Cours Récents (Historique)</h2>

        {/* Mes cours — tout cours pas encore rangé dans un module (le bouton */}
        {/* d'ajout vit désormais dans le bandeau au-dessus de la grille). */}
        <section className="mb-10">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">Mes cours</h3>
          {loading ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:grid-cols-4">
              {unassignedCourses.map((course) => (
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

        {/* Mes modules — uniquement les modules réels, avec leurs cours respectifs. */}
        <section>
          <h3 className="mb-4 text-lg font-semibold text-slate-900">Mes modules</h3>
          {!loading && modules.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              Aucun module pour l'instant — utilise « Ajouter à un module » sur un cours pour en créer un.
            </p>
          ) : (
            <div className="space-y-8">
              {modules.map((moduleItem) => {
                const moduleCourses = coursesByModule.get(moduleItem.id) ?? [];
                const legacyExtras = isGastroModule(moduleItem.name)
                  ? LEGACY_GASTRO_SOURCES.filter((legacy) => !moduleCourses.some((c) => c.slug === legacy.slug))
                  : [];

                return (
                  <div key={moduleItem.id}>
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">{moduleItem.name}</p>
                    {moduleCourses.length === 0 && legacyExtras.length === 0 ? (
                      <p className="text-sm text-slate-400">Aucun cours dans ce module pour l'instant.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:grid-cols-4">
                        {moduleCourses.map((course) => (
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
                        {legacyExtras.map((source) => (
                          <Link
                            key={source.slug}
                            href={`/dashboard/demo/${source.slug}`}
                            className="flex h-40 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                              <FileText className="h-5 w-5" />
                            </div>
                            <p className="line-clamp-2 text-sm font-semibold text-slate-900">{source.title}</p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <UploadModal open={modalOpen} onOpenChange={setModalOpen} onUploaded={handleUploaded} />
    </div>
  );
}
