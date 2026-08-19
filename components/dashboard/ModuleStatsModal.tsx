"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BarChart3, CircleCheck, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";

interface ModuleCourseProgress {
  id: number;
  title: string;
  generatedSections: number;
  totalSections: number;
  progressPct: number;
  /** Real qcm_attempts-derived mastery % (via the course_mastery SQL function) — undefined means no QCM attempted yet in this course, rendered as an honest "—", never a fabricated 0%. */
  qcmSuccessPct?: number;
}

interface ModuleStatsResponse {
  success: boolean;
  courseCount: number;
  courses: ModuleCourseProgress[];
  needsReview: ModuleCourseProgress[];
}

/**
 * "Voir statistiques" for a whole curriculum module (Anatomie, Cytologie...)
 * — aggregates every course the student uploaded into it. Two real signals:
 * QCM mastery from qcm_attempts (via the course_mastery SQL function — same
 * source as the Dashboard's own course cards), shown as an honest "—" for a
 * course with zero attempts yet; and Studio-content generation progress,
 * which doubles as a priority signal even before any QCM has been attempted.
 */
export function ModuleStatsModal({
  open,
  onOpenChange,
  moduleTitle,
  moduleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleTitle: string;
  moduleId: number;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ModuleStatsResponse | null>(null);
  // Distinct from `data === null && !loading` (genuinely 0 courses) — a
  // failed fetch used to fall through to the exact same "Aucun cours" empty
  // state, silently telling a student they have no data when the request
  // actually failed. Found during a security audit.
  const [loadError, setLoadError] = useState(false);
  // Keyed by moduleId — re-opening this same module's stats within the page
  // visit (e.g. closing then reopening the dropdown) is then instant.
  const cacheRef = useRef<Map<number, ModuleStatsResponse>>(new Map());
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!open) return;

    const cached = cacheRef.current.get(moduleId);
    if (cached) {
      setData(cached);
      setLoading(false);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setData(null);
    setLoadError(false);

    fetch(`/api/studio/courses/stats?moduleId=${moduleId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body: ModuleStatsResponse) => {
        if (cancelled) return;
        if (!body.success) throw new Error("La réponse indique un échec.");
        cacheRef.current.set(moduleId, body);
        setData(body);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[ModuleStatsModal] Échec du chargement des statistiques:", error);
        setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, moduleId, retryToken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <TrendingUp className="h-4 w-4" />
            <p className="text-xs font-bold uppercase tracking-wider">Statistiques du module</p>
          </div>
          <DialogTitle className="line-clamp-2">{moduleTitle}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState message="Échec du chargement des statistiques du module." onRetry={() => setRetryToken((t) => t + 1)} />
        ) : !data || data.courseCount === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <BarChart3 className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            </motion.div>
            <p className="max-w-[220px] text-sm text-slate-500 dark:text-slate-400">
              Aucun cours ajouté dans ce module pour l'instant.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {data.courseCount} cours ajouté{data.courseCount > 1 ? "s" : ""} dans ce module.
            </p>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Réussite QCM</p>
              {data.courses.map((course) => (
                <div key={course.id} className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{course.title}</p>
                  <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    {course.qcmSuccessPct !== undefined && (
                      <div
                        className={cn("h-full rounded-full", course.qcmSuccessPct >= 50 ? "bg-blue-500" : "bg-amber-500")}
                        style={{ width: `${course.qcmSuccessPct}%` }}
                      />
                    )}
                  </div>
                  <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-500 dark:text-slate-400">
                    {course.qcmSuccessPct !== undefined ? `${Math.round(course.qcmSuccessPct)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Progression du contenu généré
              </p>
              {data.courses.map((course) => (
                <div key={course.id} className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{course.title}</p>
                  <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={cn("h-full rounded-full", course.progressPct >= 50 ? "bg-blue-500" : "bg-amber-500")}
                      style={{ width: `${course.progressPct}%` }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-slate-500 dark:text-slate-400">
                    {course.progressPct}%
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Cours à compléter en priorité
                </p>
              </div>
              {data.needsReview.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/30">
                  <CircleCheck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <p className="text-sm text-slate-600 dark:text-slate-300">Tous les cours ont un contenu bien avancé.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.needsReview.slice(0, 4).map((course) => (
                    <div
                      key={course.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30"
                    >
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{course.title}</p>
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        {course.qcmSuccessPct !== undefined
                          ? `${Math.round(course.qcmSuccessPct)}% de réussite`
                          : `${course.generatedSections}/${course.totalSections} générées`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
