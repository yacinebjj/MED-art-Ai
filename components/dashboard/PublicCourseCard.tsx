"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, FileText, FolderInput, MoreVertical, Pencil, Target, Trash2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { RenameCourseDialog } from "./RenameCourseDialog";
import { DeleteCourseDialog } from "./DeleteCourseDialog";
import { MoveToModuleDialog } from "./MoveToModuleDialog";
import { CourseStatsModal } from "./CourseStatsModal";
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";

/** One "Lecture" or "Préparation Examen" row — a tiny icon, a slim fill bar, and a "N%" or "—" label. */
function CourseMetricRow({
  icon: Icon,
  pct,
  barClassName,
  iconClassName,
  label,
}: {
  icon: typeof BookOpen;
  pct: number | undefined;
  barClassName: string;
  iconClassName: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <Icon className={cn("h-3 w-3 shrink-0", iconClassName)} />
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
        {pct !== undefined && (
          <div
            className={cn("h-full rounded-full transition-all duration-500", barClassName)}
            style={{ width: `${Math.round(pct)}%` }}
          />
        )}
      </div>
      <span className="w-8 shrink-0 text-right text-[10px] font-semibold text-slate-500">
        {pct !== undefined ? `${Math.round(pct)}%` : "—"}
      </span>
    </div>
  );
}

/**
 * The two performance indicators shown under a course's title:
 * 1. Lecture/Étude — reading progress (currently always a demo seed, see
 *    lib/mock-course-progress.ts — no real per-user reading tracking exists
 *    yet anywhere in the app).
 * 2. Préparation Examen — real QCM mastery from qcm_attempts via the
 *    `course_mastery` SQL function (app/dashboard/(shell)/page.tsx), falling
 *    back to the same mock seed only when a course has zero real attempts.
 * `undefined` on either metric renders an honest "—", never a fabricated 0%.
 */
function CoursePerformanceIndicators({ readingPct, examReadinessPct }: { readingPct: number | undefined; examReadinessPct: number | undefined }) {
  return (
    <div className="space-y-1 pr-6">
      <CourseMetricRow
        icon={BookOpen}
        pct={readingPct}
        barClassName="bg-teal-500"
        iconClassName="text-teal-500"
        label="Progression des cours (lecture)"
      />
      <CourseMetricRow
        icon={Target}
        pct={examReadinessPct}
        barClassName="bg-gradient-to-r from-blue-500 to-cyan-400"
        iconClassName="text-blue-500"
        label="Indice de préparation à l'examen (QCMs)"
      />
    </div>
  );
}

/**
 * One course card for the dashboard's "Mes cours" / "Mes modules" sections —
 * the kebab button is a SIBLING of the <Link>, not nested inside it, so
 * opening the menu never triggers navigation (no stopPropagation hack needed).
 */
export function PublicCourseCard({
  course,
  modules,
  onDeleted,
  onRenamed,
  onModuleChanged,
  onModuleCreated,
  readingPct,
  examReadinessPct,
  srsMasteryPct,
}: {
  course: PublicCourseSummary;
  modules: ModuleSummary[];
  onDeleted: (slug: string) => void;
  onRenamed: (slug: string, title: string) => void;
  onModuleChanged: (slug: string, moduleId: number) => void;
  onModuleCreated: (newModule: ModuleSummary) => void;
  /** Reading/study progress % for this course — see lib/mock-course-progress.ts. */
  readingPct?: number;
  /** Real (or demo-fallback) QCM mastery % for this course. */
  examReadinessPct?: number;
  /** Real (or demo-fallback) SRS/memorization % for this course — powers the "Statistiques" modal only (not shown on the card face). */
  srsMasteryPct?: number;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  return (
    <div className="group relative h-40 rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 group-hover:opacity-100"
            aria-label="Options du cours"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Renommer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
              <FolderInput className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Ajouter à un module
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setStatsOpen(true)}>
              <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Statistiques
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/dashboard/demo/${course.slug}`} className="flex h-full flex-col justify-between p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
          <FileText className="h-5 w-5" />
        </div>
        <div className="space-y-1.5">
          <p className="line-clamp-2 pr-6 text-sm font-semibold text-slate-900">{course.title}</p>
          <CoursePerformanceIndicators readingPct={readingPct} examReadinessPct={examReadinessPct} />
        </div>
      </Link>

      <RenameCourseDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        course={course}
        onRenamed={(title) => onRenamed(course.slug, title)}
      />
      <DeleteCourseDialog open={deleteOpen} onOpenChange={setDeleteOpen} course={course} onDeleted={() => onDeleted(course.slug)} />
      <MoveToModuleDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        course={course}
        modules={modules}
        onModuleChanged={(moduleId) => onModuleChanged(course.slug, moduleId)}
        onModuleCreated={onModuleCreated}
      />
      <CourseStatsModal
        open={statsOpen}
        onOpenChange={setStatsOpen}
        courseTitle={course.title}
        courseSlug={course.slug}
        stats={{ qcmSuccessPct: examReadinessPct, srsMasteryPct, readingPct }}
      />
    </div>
  );
}
