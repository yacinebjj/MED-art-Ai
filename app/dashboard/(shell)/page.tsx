"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { UploadModal } from "@/components/dashboard/UploadModal";
import { CourseGridCard } from "@/components/dashboard/CourseGridCard";
import { useAuth } from "@/providers/AuthProvider";
import type { Course } from "@/lib/types";

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch("/api/courses")
      .then((res) => res.json())
      .then((data) => setCourses(data.courses ?? []))
      .finally(() => setLoading(false));
  }, [user]);

  function handleUploaded(course: Course) {
    setCourses((prev) => [course, ...prev]);
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

      <UploadModal open={modalOpen} onOpenChange={setModalOpen} onUploaded={handleUploaded} />
    </div>
  );
}
