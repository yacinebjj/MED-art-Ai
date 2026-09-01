"use client";

/**
 * Ad-hoc "pick 2-3 specific courses for this session" picker — additive to
 * (never a replacement for) CurriculumView's whole-module "Activer les
 * Flashcards" toggle. Backed by profiles.flashcard_active_course_ids (see
 * supabase/schema.sql's own comment): /api/flashcards/pool and
 * /api/flashcards/generate union both sources, so a course is eligible the
 * moment EITHER its whole module is active OR it's individually picked
 * here.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ListChecks, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface PickerCourse {
  id: number;
  title: string;
  moduleId: number;
  moduleName: string;
  active: boolean;
}

export function FlashcardCoursePicker({ onSelectionChanged }: { onSelectionChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [courses, setCourses] = useState<PickerCourse[]>([]);
  const [query, setQuery] = useState("");
  // Tracks whether ANY toggle actually changed this open — only fires the
  // parent's reload once, on close, rather than once per checkbox click.
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetch("/api/flashcards/course-picker")
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (cancelled) return;
        if (!body?.success) throw new Error(body?.error ?? "Erreur inconnue.");
        setCourses(Array.isArray(body.courses) ? body.courses : []);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Impossible de contacter le serveur.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleToggle(course: PickerCourse) {
    const nextActive = !course.active;
    setCourses((prev) => prev.map((c) => (c.id === course.id ? { ...c, active: nextActive } : c)));
    setChanged(true);

    try {
      const res = await fetch(`/api/flashcards/course-picker/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) throw new Error(body?.error ?? "Erreur inconnue.");
    } catch (error) {
      // Optimistic revert — the checkbox never silently lies about the saved state.
      setCourses((prev) => prev.map((c) => (c.id === course.id ? { ...c, active: course.active } : c)));
      toast({
        variant: "error",
        title: "Échec de la mise à jour",
        description: error instanceof Error ? error.message : "Impossible de contacter le serveur.",
      });
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && changed) {
      onSelectionChanged();
      setChanged(false);
    }
  }

  const filtered = query.trim()
    ? courses.filter(
        (c) => c.title.toLowerCase().includes(query.trim().toLowerCase()) || c.moduleName.toLowerCase().includes(query.trim().toLowerCase())
      )
    : courses;

  const activeCount = courses.filter((c) => c.active).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ListChecks className="h-3.5 w-3.5" />
        Choisir des cours
        {activeCount > 0 && ` (${activeCount})`}
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choisir des cours pour les flashcards</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un cours ou un module..."
            className="w-full rounded-xl border border-input bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Chargement...</span>
            </div>
          ) : loadError ? (
            <p className="py-6 text-center text-sm text-destructive">{loadError}</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {courses.length === 0 ? "Aucun cours avec une Explication générée pour l'instant." : "Aucun résultat."}
            </p>
          ) : (
            filtered.map((course) => (
              <button
                key={course.id}
                type="button"
                onClick={() => handleToggle(course)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
              >
                {course.active ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{course.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{course.moduleName}</p>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
