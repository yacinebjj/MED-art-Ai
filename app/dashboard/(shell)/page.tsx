"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FileText, ArrowLeft } from "lucide-react";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { CourseGridCard } from "@/components/dashboard/CourseGridCard";
import { useAuth } from "@/providers/AuthProvider";
import { cn } from "@/lib/utils";
import type { Course } from "@/lib/types";

interface MockModule {
  id: string;
  title: string;
  courseCount: number;
  available: boolean;
  updatedLabel: string;
  emoji: string;
  iconStyles: string;
}

const MOCK_MODULES: MockModule[] = [
  {
    id: "gastro",
    title: "Gastro-entérologie",
    courseCount: 4,
    available: true,
    updatedLabel: "Mis à jour 27 Jul 2026",
    emoji: "🦠",
    iconStyles: "bg-teal-50 text-teal-600",
  },
  {
    id: "cardio",
    title: "Cardiologie",
    courseCount: 6,
    available: false,
    updatedLabel: "Bientôt disponible",
    emoji: "🫀",
    iconStyles: "bg-rose-50 text-rose-600",
  },
  {
    id: "pneumo",
    title: "Pneumologie",
    courseCount: 3,
    available: false,
    updatedLabel: "Bientôt disponible",
    emoji: "🫁",
    iconStyles: "bg-sky-50 text-sky-600",
  },
];

interface SupabaseCourseListItem {
  slug: string;
  title: string;
}

/** Demo/showcase slugs authored before the `courses` table existed (no Supabase row) — always shown alongside whatever Supabase returns. */
const LEGACY_GASTRO_SOURCES: SupabaseCourseListItem[] = [
  { slug: "appendicite", title: "Appendicite_Cours.pdf" },
  { slug: "ulcere", title: "Ulcere_Gastro.pdf" },
  { slug: "rectocolite", title: "Rectocolite_Video.mp4" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [gastroSources, setGastroSources] = useState<SupabaseCourseListItem[]>(LEGACY_GASTRO_SOURCES);

  useEffect(() => {
    if (!user) return;
    fetch("/api/courses")
      .then((res) => res.json())
      .then((data) => setCourses(data.courses ?? []))
      .finally(() => setLoading(false));
  }, [user]);

  // Any course row added to Supabase's `courses` table (e.g. via a slug
  // insert script) appears here automatically on refresh, with zero code
  // change — merged with the legacy demo slugs that predate that table.
  useEffect(() => {
    fetch("/api/courses/list")
      .then((res) => res.json())
      .then((data: { courses?: SupabaseCourseListItem[] }) => {
        const fetched = data.courses ?? [];
        const merged = [
          ...fetched,
          ...LEGACY_GASTRO_SOURCES.filter((legacy) => !fetched.some((c) => c.slug === legacy.slug)),
        ];
        setGastroSources(merged);
      })
      .catch(() => {
        // Keep the legacy fallback list already in state.
      });
  }, []);

  // Instant-insert architecture: the upload itself never calls the AI, so the
  // course is immediately ready to open — send the student straight there,
  // where each Studio tab generates its own content on demand (LazySection).
  function handleUploaded(slug: string) {
    router.push(`/dashboard/demo/${slug}`);
  }

  async function handleDelete(id: string) {
    const previous = courses;
    setCourses((prev) => prev.filter((c) => c.id !== id));

    const res = await fetch(`/api/courses/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Roll back on failure so the card doesn't silently vanish.
      setCourses(previous);
    }
  }

  const firstName = profile?.fullName?.split(" ")[0] || "Étudiant(e)";
  const activeModuleData = MOCK_MODULES.find((m) => m.id === activeModule) ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Bonjour, {firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Tes espaces de travail.</p>
        </div>

        <Link
          href="/dashboard/demo"
          className="flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        >
          👀 Voir la Démo
        </Link>
      </div>

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

          {courses.map((course) => (
            <div key={course.id} className="h-40">
              <CourseGridCard course={course} onDelete={handleDelete} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-10">
        {activeModuleData ? (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModule(null)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition-all duration-200 hover:border-orange-300 hover:text-orange-600 hover:shadow-md"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Retour
                </button>
                <h3 className="text-lg font-semibold text-slate-900">{activeModuleData.title}</h3>
              </div>
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-orange-500 hover:shadow-md"
              >
                <Plus className="h-4 w-4" />
                Ajouter un cours à ce module
              </button>
            </div>

            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Sources
            </p>

            <div className="space-y-3">
              {gastroSources.map((source) => (
                <Link
                  key={source.slug}
                  href={`/dashboard/demo/${source.slug}`}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:border-teal-300 hover:shadow-md"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{source.title}</p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
                    Prêt pour révision
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-4 text-lg font-semibold text-slate-900">Mes modules</h3>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {MOCK_MODULES.map((module) => (
                <button
                  key={module.id}
                  type="button"
                  disabled={!module.available}
                  onClick={() => module.available && setActiveModule(module.id)}
                  className={cn(
                    "flex min-h-[200px] flex-col rounded-2xl border border-slate-200/80 bg-white p-6 text-left shadow-sm transition-all duration-200",
                    module.available
                      ? "hover:border-orange-300 hover:shadow-md"
                      : "cursor-not-allowed opacity-60"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex w-fit items-center justify-center rounded-xl p-3 text-2xl",
                      module.iconStyles
                    )}
                  >
                    {module.emoji}
                  </span>
                  <p className="mt-4 text-lg font-bold text-slate-900">{module.title}</p>
                  <p className="mt-auto pt-6 text-xs text-slate-500">
                    {module.id === "gastro" ? gastroSources.length : module.courseCount} Cours • {module.updatedLabel}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <UploadModal open={modalOpen} onOpenChange={setModalOpen} onUploaded={handleUploaded} />
    </div>
  );
}
