"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, Presentation, FileType, MoreVertical, Trash2, AlertTriangle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { Course } from "@/lib/types";

const FILE_ICONS = {
  pdf: FileText,
  pptx: Presentation,
  docx: FileType,
  txt: FileText,
};

export function CourseGridCard({
  course,
  onDelete,
}: {
  course: Course;
  onDelete: (id: string) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const Icon = FILE_ICONS[course.fileType];
  const isReady = course.status === "ready";
  const isError = course.status === "error";

  async function handleDelete() {
    setIsDeleting(true);
    await onDelete(course.id);
  }

  const body = (
    <div className="flex h-full flex-col rounded-xl bg-gradient-to-br from-white to-sky-50 p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <Icon className="h-5 w-5" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={isDeleting}
              onSelect={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-gray-900">{course.title}</h3>

      {isError && course.errorMessage && (
        <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{course.errorMessage}</span>
        </p>
      )}

      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="text-xs text-gray-500">{course.uploadedAt}</span>
        {course.status === "processing" && (
          <span className="text-xs font-medium text-amber-600">Analyse…</span>
        )}
      </div>
    </div>
  );

  if (!isReady) {
    return <div className="h-full cursor-not-allowed opacity-90">{body}</div>;
  }

  return (
    <Link href={`/dashboard/course/${course.id}`} className="block h-full">
      {body}
    </Link>
  );
}
