"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import { ArrowDownRight, BarChart3, BookOpen, Brain, CircleCheck, Target, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { ErrorState } from "@/components/ui/ErrorState";
import { computeGlobalScore, scoreColorTier, type CourseStats } from "@/lib/course-stats";
import { resolveWeakChapters, type WeakChapter, type WeakQcmRow } from "@/lib/weak-points";

/**
 * "Statistiques" modal for one course — a Radial (donut) score for the
 * global mastery composite, three Linear bars for its sub-metrics, and a
 * "Points faibles" section, all counting up from 0 the moment the modal
 * opens (Framer Motion `animate()` drives a single live number per metric;
 * the donut's SVG stroke-dashoffset and each bar's width both read straight
 * off that same live value, so everything fills in lockstep with the number
 * rather than via separate, possibly-desynced CSS transitions).
 *
 * Deliberately monochrome (Enterprise/Senior style, not a rainbow of
 * per-metric colors): every icon and fill bar uses the same royal-blue
 * accent. The ONE exception is the radial score's color, which shifts by
 * threshold (emerald/blue/orange) — that's functional data-encoding (a
 * status gauge), not decoration, so it stays.
 *
 * `stats` is intentionally a plain, flat interface (lib/course-stats.ts) —
 * today it's fed a mix of real data (QCM success + SRS via the
 * `course_mastery` SQL function) and a demo seed (chapter reading, which has
 * no real per-user tracking yet). Swapping any one field for a fully real
 * source later needs zero changes here.
 */

/** Animates a number from 0 to `target` — restarts whenever `active` flips true, so re-opening the modal always replays the "counting up" effect. */
function useCountUp(target: number | undefined, active: boolean, delay = 0, duration = 1.4) {
  const [value, setValue] = useState(0);
  const motionValue = useMotionValue(0);

  useEffect(() => {
    if (!active || target === undefined) {
      setValue(0);
      return;
    }
    motionValue.set(0);
    const controls = animate(motionValue, target, {
      duration,
      delay,
      ease: "easeOut",
      onUpdate: (latest) => setValue(latest),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, active, delay, duration]);

  return value;
}

const TIER_COLORS: Record<ReturnType<typeof scoreColorTier>, { stroke: string; text: string; glow: string }> = {
  emerald: {
    stroke: "#10b981",
    text: "text-emerald-600 dark:text-emerald-400",
    glow: "shadow-[0_0_40px_rgba(16,185,129,0.35)]",
  },
  blue: {
    stroke: "#3b82f6",
    text: "text-blue-600 dark:text-blue-400",
    glow: "shadow-[0_0_40px_rgba(59,130,246,0.35)]",
  },
  orange: {
    stroke: "#f97316",
    text: "text-orange-600 dark:text-orange-400",
    glow: "shadow-[0_0_40px_rgba(249,115,22,0.35)]",
  },
};

/** The central donut — fills in circularly as the count-up animates, color shifting live by tier threshold (emerald > 80, blue > 50, orange otherwise). */
function RadialScore({ target, active }: { target: number | undefined; active: boolean }) {
  const size = 168;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const animated = useCountUp(target, active && target !== undefined, 0, 1.6);
  const clamped = Math.min(100, Math.max(0, animated));
  const offset = circumference - (clamped / 100) * circumference;
  const colors = TIER_COLORS[scoreColorTier(clamped)];

  return (
    <div
      className={cn(
        "relative flex h-[168px] w-[168px] shrink-0 items-center justify-center rounded-full transition-shadow duration-700",
        target !== undefined && colors.glow
      )}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} fill="none" className="stroke-slate-100 dark:stroke-slate-800" />
        {target !== undefined && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={strokeWidth}
            fill="none"
            stroke={colors.stroke}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className={cn("text-4xl font-black tabular-nums", target !== undefined ? colors.text : "text-slate-300 dark:text-slate-700")}>
          {target !== undefined ? Math.round(animated) : "—"}
          {target !== undefined && <span className="text-xl">%</span>}
        </p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Score global</p>
      </div>
    </div>
  );
}

/** One linear sub-metric — icon, label, an animated fill bar, and the live counting percentage. Monochrome blue throughout, by design (see file header). */
function LinearStatRow({
  icon: Icon,
  label,
  pct,
  active,
  delay,
}: {
  icon: typeof BookOpen;
  label: string;
  pct: number | undefined;
  active: boolean;
  delay: number;
}) {
  const animated = useCountUp(pct, active && pct !== undefined, delay, 1.2);
  const clamped = Math.min(100, Math.max(0, animated));

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</p>
          <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-white">
            {pct !== undefined ? `${Math.round(animated)}%` : "—"}
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          {pct !== undefined && (
            <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400" style={{ width: `${clamped}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * "Points faibles" — the real weak chapters/notions for this course (see
 * lib/weak-points.ts), resolved from the actual QCM/QROC attempts stuck in
 * an early Leitner box or answered wrong (app/api/srs/course-weak-points).
 * Three states, all honest: a positive "nothing weak" message, a clean
 * ranked list when chapters could be resolved, or a simpler count-only
 * fallback when the course's content can't be parsed (e.g. the hardcoded
 * legacy Appendicite course, which has no real `courses` row).
 */
function WeakPointsSection({
  loading,
  loadError,
  chapters,
  fallbackCount,
  onRetry,
}: {
  loading: boolean;
  loadError: boolean;
  chapters: WeakChapter[] | null;
  fallbackCount: number;
  onRetry: () => void;
}) {
  return (
    <div className="mt-8 border-t border-slate-100 pt-6 dark:border-slate-800">
      <div className="mb-3 flex items-center gap-2">
        <ArrowDownRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Points faibles</p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : loadError ? (
        <ErrorState message="Échec du chargement des points faibles." onRetry={onRetry} />
      ) : chapters !== null && chapters.length > 0 ? (
        <div className="space-y-2">
          {chapters.slice(0, 4).map((chapter) => (
            <div
              key={chapter.label}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30"
            >
              <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{chapter.label}</p>
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                {chapter.count} question{chapter.count > 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : chapters === null && fallbackCount > 0 ? (
        <p className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/30 dark:text-slate-300">
          {fallbackCount} notion{fallbackCount > 1 ? "s" : ""} à revoir dans ce cours.
        </p>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/30">
          <CircleCheck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Aucun point faible identifié pour l&apos;instant.</p>
        </div>
      )}
    </div>
  );
}

export interface CourseStatsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string;
  courseSlug: string;
  stats: CourseStats;
}

export function CourseStatsModal({ open, onOpenChange, courseTitle, courseSlug, stats }: CourseStatsModalProps) {
  const globalScore = computeGlobalScore(stats);

  const [weakLoading, setWeakLoading] = useState(false);
  const [weakChapters, setWeakChapters] = useState<WeakChapter[] | null>(null);
  const [weakRawCount, setWeakRawCount] = useState(0);
  // Distinct from "chapters === [] " (genuinely zero weak points) — a
  // network failure previously fell through to the exact same "Aucun point
  // faible identifié" positive message a struggling student could see when
  // the request to find their weak points simply failed. Found during a
  // security audit.
  const [weakLoadError, setWeakLoadError] = useState(false);
  const [weakRetryToken, setWeakRetryToken] = useState(0);

  // One instance of this modal is reused across every course in the module
  // (see ModuleSourcesPanel) — caching by courseSlug means re-opening stats
  // for a course already viewed this page visit is instant, no network
  // roundtrip at all.
  const cacheRef = useRef<Map<string, { weakChapters: WeakChapter[] | null; weakRawCount: number }>>(new Map());

  // Fetched only when the modal actually opens — the weak-points list and
  // the course's own content (needed to resolve a qcm_id back to a chapter)
  // are both real network calls, no reason to pay for them before the
  // student asks to see this course's stats.
  useEffect(() => {
    if (!open) return;

    const cached = cacheRef.current.get(courseSlug);
    if (cached) {
      setWeakChapters(cached.weakChapters);
      setWeakRawCount(cached.weakRawCount);
      setWeakLoading(false);
      setWeakLoadError(false);
      return;
    }

    let cancelled = false;
    setWeakLoading(true);
    setWeakLoadError(false);

    (async () => {
      try {
        // Fired together (not weak-points-then-course, one-after-the-other):
        // the course's content is needed whenever there ARE weak points
        // (the common case), so paying for both requests' latency at once
        // beats paying for them back-to-back — the one wasted request in the
        // rare "zero weak points" case is a fair trade for that.
        const [weakRes, courseRes] = await Promise.all([
          fetch(`/api/srs/course-weak-points?courseSlug=${encodeURIComponent(courseSlug)}`),
          fetch(`/api/courses/slug/${courseSlug}`),
        ]);
        if (!weakRes.ok) throw new Error(`HTTP ${weakRes.status} sur course-weak-points`);
        const weakBody = await weakRes.json();
        const weakQcms: WeakQcmRow[] = weakBody.weakQcms ?? [];
        if (cancelled) return;

        let chapters: WeakChapter[] | null;
        if (weakQcms.length === 0) {
          chapters = [];
        } else {
          const courseBody = courseRes.ok ? await courseRes.json().catch(() => null) : null;
          if (cancelled) return;
          chapters = courseBody
            ? resolveWeakChapters(weakQcms, courseBody.qcms, typeof courseBody.explication === "string" ? courseBody.explication : null)
            : null;
        }

        cacheRef.current.set(courseSlug, { weakChapters: chapters, weakRawCount: weakQcms.length });
        setWeakRawCount(weakQcms.length);
        setWeakChapters(chapters);
      } catch (error) {
        if (cancelled) return;
        console.error("[CourseStatsModal] Échec du chargement des points faibles:", error);
        setWeakLoadError(true);
      } finally {
        if (!cancelled) setWeakLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, courseSlug, weakRetryToken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="backdrop-blur-md"
        className="max-w-md overflow-hidden border-slate-200 bg-white/95 p-0 shadow-2xl backdrop-blur-2xl dark:border-slate-700 dark:bg-slate-900/95"
      >
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="max-h-[85vh] overflow-y-auto p-6"
          >
            <div className="mb-1 flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <TrendingUp className="h-4 w-4" />
              <p className="text-xs font-bold uppercase tracking-wider">Statistiques du cours</p>
            </div>
            <h2 className="mb-6 line-clamp-2 pr-6 text-lg font-black text-slate-900 dark:text-white">{courseTitle}</h2>

            {globalScore === undefined ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center dark:border-slate-700 dark:bg-slate-800/40">
                <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
                  <BarChart3 className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                </motion.div>
                <p className="max-w-[220px] text-sm text-slate-500 dark:text-slate-400">
                  Pas encore assez de données — réponds à quelques QCM dans ce cours pour débloquer tes statistiques.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-8 flex justify-center">
                  <RadialScore target={globalScore} active={open} />
                </div>

                <div className="space-y-5">
                  <LinearStatRow icon={Target} label="Réussite aux QCM" pct={stats.qcmSuccessPct} active={open} delay={0.15} />
                  <LinearStatRow icon={Brain} label="Indice de mémorisation (SRS)" pct={stats.srsMasteryPct} active={open} delay={0.3} />
                  <LinearStatRow icon={BookOpen} label="Avancement des chapitres" pct={stats.readingPct} active={open} delay={0.45} />
                </div>

                <WeakPointsSection
                  loading={weakLoading}
                  loadError={weakLoadError}
                  chapters={weakChapters}
                  fallbackCount={weakRawCount}
                  onRetry={() => setWeakRetryToken((t) => t + 1)}
                />
              </>
            )}
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
}
