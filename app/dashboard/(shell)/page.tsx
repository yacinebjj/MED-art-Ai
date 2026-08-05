"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { PublicCourseCard } from "@/components/dashboard/PublicCourseCard";
import { useAuth } from "@/providers/AuthProvider";
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";

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

export default function DashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [courses, setCourses] = useState<PublicCourseSummary[]>([]);
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    Promise.all([refreshCourses(), refreshModules()]).finally(() => setLoading(false));
  }, [refreshCourses, refreshModules]);

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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Bonjour, {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Tes espaces de travail.</p>
        </div>

        <Link
          href="/dashboard/demo"
          className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        >
          👀 Voir la Démo
        </Link>
      </div>

      {/* Mes cours — le bouton d'ajout, plus tout cours pas encore rangé dans un module. */}
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
            <button
              onClick={() => setModalOpen(true)}
              className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                <Plus className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium">Ajouter un cours</span>
            </button>

            {unassignedCourses.map((course) => (
              <PublicCourseCard
                key={course.id}
                course={course}
                modules={modules}
                onDeleted={handleDeleted}
                onRenamed={handleRenamed}
                onModuleChanged={handleModuleChanged}
                onModuleCreated={handleModuleCreated}
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

      <UploadModal open={modalOpen} onOpenChange={setModalOpen} onUploaded={handleUploaded} />
    </div>
  );
}
