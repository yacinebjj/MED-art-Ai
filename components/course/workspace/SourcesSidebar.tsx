"use client";

import Link from "next/link";
import { ArrowLeft, FileText, Presentation, FileType } from "lucide-react";
import type { Course } from "@/lib/types";

const FILE_ICONS = {
  pdf: FileText,
  pptx: Presentation,
  docx: FileType,
  txt: FileText,
};

export function SourcesSidebar({ course }: { course: Course | null }) {
  const Icon = course ? FILE_ICONS[course.fileType] : FileText;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-white p-4">
      <Link
        href="/dashboard"
        className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Mes cours
      </Link>

      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Sources
      </h2>

      {course ? (
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-blue-900">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{course.title}</p>
            <p className="text-xs text-blue-700/70">{course.fileSizeLabel}</p>
          </div>
        </div>
      ) : (
        <div className="h-14 animate-pulse rounded-lg bg-gray-100" />
      )}
    </aside>
  );
}
