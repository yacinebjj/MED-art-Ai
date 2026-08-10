"use client";

import { GraduationCap } from "lucide-react";
import type { GastriteQcmsData } from "@/lib/course-slug-content";
import { InteractiveQuiz } from "@/components/course/workspace/InteractiveQuiz";

/**
 * `courseSlug` is passed separately from `data` — the JSON stored in
 * `courses.qcms` (this `data` prop) never contains the course's own slug,
 * only its own section content. The real slug lives on the page that
 * already has it in scope (app/dashboard/demo/[slug]/page.tsx's own `slug`
 * param) and must be threaded down explicitly, not read off `data.slug`
 * (which was always `undefined` — the exact bug that made every QCM click
 * fail with "Le champ 'courseSlug' est requis.").
 */
export function GastriteQcmsStudio({
  data,
  courseSlug,
  explicationMarkdown,
  isPreview,
}: {
  data: GastriteQcmsData;
  courseSlug: string;
  explicationMarkdown?: string;
  /** Threaded straight to InteractiveQuiz — see its own prop doc. Defaults to false (unchanged behavior for real courses). */
  isPreview?: boolean;
}) {
  return (
    <div className="w-full mx-auto space-y-8 font-sans text-slate-800 dark:text-slate-200 animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-700 to-cyan-900 dark:from-teal-950 dark:to-black p-8 shadow-xl border border-teal-400/30">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-white/10 blur-[80px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl text-white">
            <GraduationCap className="w-9 h-9" />
          </div>
          <div>
            <span className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white/20 text-white rounded-full border border-white/30">
              Niveau Faculté de Médecine — 4ème Année
            </span>
            <h1 className="text-2xl md:text-4xl font-black text-white uppercase tracking-tight mt-2">{data.titre_section}</h1>
            <p className="text-sm text-teal-100 mt-1 max-w-2xl">
              {data.qcms.length} QCM et {data.qrocs.length} QROC à difficulté extrême — physiopathologie, histologie, complications évolutives, éradication et maladie de Biermer. Aucune complaisance.
            </p>
          </div>
        </div>
      </div>

      <InteractiveQuiz
        qcms={data.qcms}
        qrocs={data.qrocs}
        courseSlug={courseSlug}
        explicationMarkdown={explicationMarkdown}
        isPreview={isPreview}
      />
    </div>
  );
}
