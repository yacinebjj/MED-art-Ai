"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, BarChart3, CircleCheck, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProgressRing } from "@/components/ui/ProgressRing";

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

const LIST_STAGGER_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const LIST_ITEM_VARIANTS = { hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } };

/** Animated fill bar — width itself is a real value (never invented), only the ENTRANCE (0 -> real width) is animated. */
function StatBar({ pct, tone }: { pct: number; tone: "primary" | "amber" | "muted" }) {
  return (
    <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "h-full rounded-full",
          tone === "primary" && "bg-gradient-to-r from-primary-500 to-violet-500",
          tone === "amber" && "bg-gradient-to-r from-amber-500 to-orange-500",
          tone === "muted" && "bg-muted-foreground/30"
        )}
      />
    </div>
  );
}

/**
 * "Voir statistiques" for a whole curriculum module (Anatomie, Cytologie...)
 * — aggregates every course the student uploaded into it. Two real signals:
 * QCM mastery from qcm_attempts (via the course_mastery SQL function — same
 * source as the Dashboard's own course cards), shown as an honest "—" for a
 * course with zero attempts yet; and Studio-content generation progress,
 * which doubles as a priority signal even before any QCM has been attempted.
 *
 * "God-Tier" pass: a performance-cockpit look (dual summary rings, an
 * insight line computed purely from the real per-course numbers already in
 * hand — never a new call, never a guess) layered over the exact same data
 * contract as before.
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

  // Every number below is derived straight from `data.courses` — no new
  // fetch, no fabricated fallback. `coursesWithMastery` only ever includes
  // courses with a REAL qcm_attempts-derived value; a module with zero QCM
  // data anywhere keeps `avgMasteryPct` genuinely undefined (rendered as an
  // honest ring-less state below), never a fake 0%.
  const coursesWithMastery = data?.courses.filter((c) => c.qcmSuccessPct !== undefined) ?? [];
  const avgMasteryPct =
    coursesWithMastery.length > 0
      ? Math.round(coursesWithMastery.reduce((sum, c) => sum + (c.qcmSuccessPct ?? 0), 0) / coursesWithMastery.length)
      : undefined;
  const avgProgressPct =
    data && data.courses.length > 0
      ? Math.round(data.courses.reduce((sum, c) => sum + c.progressPct, 0) / data.courses.length)
      : 0;
  const masteredCount = coursesWithMastery.filter((c) => (c.qcmSuccessPct ?? 0) >= 80).length;
  const weakCount = coursesWithMastery.filter((c) => (c.qcmSuccessPct ?? 0) < 50).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        {/* Cockpit accent glow — purely decorative, sits behind the header.
            No `overflow-hidden` on DialogContent itself: that class was
            silently overriding (via twMerge) the base component's own
            `overflow-y-auto max-h-[calc(100%-2rem)]`, which is what makes
            this modal scrollable at all — on a real phone screen (far
            shorter than this content) that left everything past the first
            couple of sections completely unreachable, with no scrollbar.
            Clipped instead to its own box so it can never bleed past the
            dialog's rounded corners without touching the shared scroll
            behavior. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-10 -top-16 h-40 w-64 rounded-full bg-primary-500/20 blur-3xl dark:bg-primary-400/10"
        />

        <DialogHeader className="relative">
          <div className="mb-1 flex items-center gap-2 text-primary-600 dark:text-primary-400">
            <TrendingUp className="h-4 w-4" />
            <p className="text-xs font-bold uppercase tracking-wider">Statistiques du module</p>
          </div>
          <DialogTitle className="line-clamp-2">{moduleTitle}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState message="Échec du chargement des statistiques du module." onRetry={() => setRetryToken((t) => t + 1)} />
        ) : !data || data.courseCount === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-accent/30 py-10 text-center">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
              <BarChart3 className="h-8 w-8 text-muted-foreground/50" />
            </motion.div>
            <p className="max-w-[220px] text-sm text-muted-foreground">Aucun cours ajouté dans ce module pour l'instant.</p>
          </div>
        ) : (
          <div className="relative space-y-6">
            {/* Cockpit summary — two rings + a computed insight line, all real. */}
            <div className="glass-card flex flex-col items-center gap-4 rounded-2xl border border-border p-4 shadow-soft sm:flex-row sm:justify-center sm:gap-8">
              <div className="flex flex-col items-center gap-1.5">
                {avgMasteryPct !== undefined ? (
                  <ProgressRing
                    completed={avgMasteryPct}
                    total={100}
                    size={72}
                    strokeWidth={6}
                    label={<span className="text-lg font-black text-foreground">{avgMasteryPct}%</span>}
                    aria-label={`Maîtrise QCM moyenne : ${avgMasteryPct}%`}
                  />
                ) : (
                  // Honest "no data yet" placeholder — an empty track, never
                  // a fabricated 0% ring (ProgressRing itself would render
                  // nothing at all for total=0, which reads as a layout bug
                  // next to the other real ring; this is the same "—"
                  // convention as the per-course rows below, just as a ring).
                  <div
                    role="img"
                    aria-label="Aucune donnée de maîtrise QCM"
                    className="relative inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center"
                  >
                    <svg width={72} height={72}>
                      <circle cx={36} cy={36} r={33} fill="none" strokeWidth={6} className="stroke-muted" />
                    </svg>
                    <span className="absolute text-lg font-black text-muted-foreground/50">—</span>
                  </div>
                )}
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Maîtrise QCM</p>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <ProgressRing
                  completed={avgProgressPct}
                  total={100}
                  size={72}
                  strokeWidth={6}
                  label={<span className="text-lg font-black text-foreground">{avgProgressPct}%</span>}
                  aria-label={`Contenu généré en moyenne : ${avgProgressPct}%`}
                />
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Contenu généré</p>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-accent/40 px-3 py-2.5 text-left sm:max-w-[180px]">
                <Sparkles className="h-4 w-4 shrink-0 text-primary-500 dark:text-primary-400" />
                <p className="text-xs leading-snug text-foreground">
                  {coursesWithMastery.length === 0
                    ? "Tente ton premier QCM pour débloquer ton score de maîtrise."
                    : weakCount === 0
                      ? `Tous les cours testés sont solides (≥ 50 %). ${masteredCount} maîtrisé${masteredCount > 1 ? "s" : ""} (≥ 80 %).`
                      : `${weakCount} cours à renforcer (< 50 %)${masteredCount > 0 ? ` · ${masteredCount} maîtrisé${masteredCount > 1 ? "s" : ""} (≥ 80 %)` : ""}.`}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Réussite QCM</p>
              {/* Proactive message when the WHOLE module has zero QCM data —
                  a wall of per-row "—" dashes with no explanation reads as
                  "broken" at a glance rather than "no data yet". Each row's
                  own "—" stays underneath for the (more common) mixed case
                  where only some courses in the module lack attempts. */}
              {coursesWithMastery.length === 0 && (
                <p className="rounded-lg border border-border bg-accent/30 px-3 py-2.5 text-sm text-muted-foreground">
                  Aucun QCM tenté dans ce module pour l&apos;instant.
                </p>
              )}
              <motion.div initial="hidden" animate="show" variants={LIST_STAGGER_VARIANTS} className="space-y-1">
                {data.courses.map((course) => (
                  <motion.div
                    key={course.id}
                    variants={LIST_ITEM_VARIANTS}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40"
                  >
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{course.title}</p>
                    <StatBar pct={course.qcmSuccessPct ?? 0} tone={course.qcmSuccessPct === undefined ? "muted" : course.qcmSuccessPct >= 50 ? "primary" : "amber"} />
                    <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">
                      {course.qcmSuccessPct !== undefined ? `${Math.round(course.qcmSuccessPct)}%` : "—"}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Progression du contenu généré</p>
              <motion.div initial="hidden" animate="show" variants={LIST_STAGGER_VARIANTS} className="space-y-1">
                {data.courses.map((course) => (
                  <motion.div
                    key={course.id}
                    variants={LIST_ITEM_VARIANTS}
                    className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40"
                  >
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{course.title}</p>
                    <StatBar pct={course.progressPct} tone={course.progressPct >= 50 ? "primary" : "amber"} />
                    <span className="w-9 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">{course.progressPct}%</span>
                  </motion.div>
                ))}
              </motion.div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cours à compléter en priorité</p>
              </div>
              {data.needsReview.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-accent/30 px-3 py-2.5">
                  <CircleCheck className="h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                  <p className="text-sm text-foreground">Tous les cours ont un contenu bien avancé.</p>
                </div>
              ) : (
                <motion.div initial="hidden" animate="show" variants={LIST_STAGGER_VARIANTS} className="space-y-2">
                  {data.needsReview.slice(0, 4).map((course) => (
                    <motion.div
                      key={course.id}
                      variants={LIST_ITEM_VARIANTS}
                      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/60 bg-amber-50/60 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/20"
                    >
                      <p className="truncate text-sm font-medium text-foreground">{course.title}</p>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        {course.qcmSuccessPct !== undefined
                          ? `${Math.round(course.qcmSuccessPct)}% de réussite`
                          : `${course.generatedSections}/${course.totalSections} générées`}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
