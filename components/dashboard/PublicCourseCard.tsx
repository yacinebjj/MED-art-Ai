"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, MoreVertical } from "lucide-react";
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
import type { ModuleSummary, PublicCourseSummary } from "@/lib/dashboard-modules";

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
}: {
  course: PublicCourseSummary;
  modules: ModuleSummary[];
  onDeleted: (slug: string) => void;
  onRenamed: (slug: string, title: string) => void;
  onModuleChanged: (slug: string, moduleId: number) => void;
  onModuleCreated: (newModule: ModuleSummary) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

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
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>✏️ Renommer</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setMoveOpen(true)}>📁 Ajouter à un module</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)}>
              🔴 Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/dashboard/demo/${course.slug}`} className="flex h-full flex-col justify-between p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
          <FileText className="h-5 w-5" />
        </div>
        <p className="line-clamp-2 pr-6 text-sm font-semibold text-slate-900">{course.title}</p>
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
    </div>
  );
}
