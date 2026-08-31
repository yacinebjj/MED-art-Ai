"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { FolderInput, MoreVertical, Pencil, Trash2, TrendingUp } from "lucide-react";
import { getCourseEmoji } from "@/lib/utils";
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

/**
 * One course card for the dashboard's "Mes cours" / "Mes modules" sections —
 * the kebab button is a SIBLING of the <Link>, not nested inside it, so
 * opening the menu never triggers navigation (no stopPropagation hack needed).
 *
 * Wrapped in React.memo: this renders once per course in the "Mes cours
 * indépendants" grid, and the dashboard page re-renders on every keystroke
 * in its (unrelated) search box — without memoization every card would
 * re-mount its own dialogs and re-run its own hooks on every keystroke, for
 * no visible reason. Effective as long as the callback props stay
 * referentially stable — see the useCallback wrappers on the dashboard
 * page's onDeleted/onRenamed/onModuleChanged/onModuleCreated handlers.
 */
export const PublicCourseCard = memo(function PublicCourseCard({
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
    <div className="glass-card group relative flex h-36 flex-col overflow-hidden rounded-2xl shadow-glass transition-all duration-300 ease-out hover:shadow-emerald-500/20 active:scale-[0.98] dark:shadow-glass-dark sm:h-40 sm:rounded-3xl lg:h-44">
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-700 dark:bg-slate-800/80 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-100"
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
              Voir statistiques
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Supprimer toutes les sources
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/dashboard/demo/${course.slug}`} className="flex h-full flex-col justify-between p-4 sm:p-5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-gradient-to-br from-teal-400/25 to-emerald-500/10 text-lg shadow-inner backdrop-blur-sm transition-transform duration-300 group-hover:scale-110 dark:border-white/10 sm:h-12 sm:w-12 sm:rounded-2xl sm:text-xl"
          aria-hidden="true"
        >
          {getCourseEmoji(course.title)}
        </div>
        <div>
          <p className="line-clamp-2 pr-6 text-sm font-semibold text-foreground sm:text-base">{course.title}</p>
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
});
