"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, FileQuestion, FolderOpen, Search, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { useLanguage } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useCockpitUi } from "@/store/useCockpitUi";
import { getLabTool } from "@/lib/workspace-lab";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import { tCockpit } from "@/lib/translations/cockpit";
import { cn } from "@/lib/utils";

const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
const normalize = (text: string) => text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();

/**
 * The Lab tools (Patient virtuel, Matrice, Carte mentale) work ON a course,
 * and a mock exam ON a module — so launching them from the dashboard, the
 * sidebar or Spotlight first asks which one. Opens the module workspace with
 * ?course=<id>&lab=<tool> (handled by app/dashboard/module/[id]/page.tsx) or
 * the module's exam page.
 */
export function LabLauncher() {
  const router = useRouter();
  const { language } = useLanguage();
  const launcher = useCockpitUi((state) => state.launcher);
  const closeLauncher = useCockpitUi((state) => state.closeLauncher);
  const overview = useCockpitStore((state) => state.overview);
  const status = useCockpitStore((state) => state.status);
  const [query, setQuery] = useState("");

  const isExam = launcher?.kind === "exam";
  const tool = launcher?.kind === "lab" ? getLabTool(launcher.tool) : null;
  const Icon = tool?.icon ?? FileQuestion;

  const groups = useMemo(() => {
    const courses = overview?.courses ?? [];
    const q = normalize(query.trim());
    const byModule = new Map<number, { moduleId: number; title: string; courses: typeof courses }>();
    for (const course of courses) {
      const moduleTitle = course.moduleTitle ? translateCurriculumName(course.moduleTitle, language) : `Module ${course.moduleId}`;
      if (q && !normalize(`${course.title} ${moduleTitle}`).includes(q)) continue;
      const group = byModule.get(course.moduleId) ?? { moduleId: course.moduleId, title: moduleTitle, courses: [] };
      group.courses.push(course);
      byModule.set(course.moduleId, group);
    }
    return Array.from(byModule.values());
  }, [overview, query, language]);

  function go(href: string) {
    closeLauncher();
    setQuery("");
    router.push(href);
  }

  const loading = !overview && (status === "syncing" || status === "idle");

  return (
    <Dialog
      open={launcher !== null}
      onOpenChange={(open) => {
        if (!open) {
          closeLauncher();
          setQuery("");
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                tool ? tool.tint.bg : "border-primary-200/60 bg-primary-50/80 dark:border-primary-900/40 dark:bg-primary-950/30"
              )}
            >
              <Icon className={cn("h-5 w-5", tool ? tool.tint.icon : "text-primary-600 dark:text-primary-400")} />
            </span>
            <div className="min-w-0">
              <DialogTitle>{tool ? tCockpit(`lab_${tool.id}`, language) : tCockpit("navEvaluation", language)}</DialogTitle>
              <DialogDescription>{isExam ? tCockpit("launcherExamHint", language) : tCockpit("launcherLabHint", language)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isExam ? tCockpit("launcherSearchModule", language) : tCockpit("launcherSearchCourse", language)}
            className="h-10 w-full rounded-xl border border-border bg-background/70 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20"
          />
        </div>

        <div className="max-h-[55vh] min-h-[160px] space-y-3 overflow-y-auto pr-1">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Upload className="h-8 w-8 text-muted-foreground/60" />
              <p className="max-w-xs text-sm text-muted-foreground">
                {query.trim() ? tCockpit("launcherNoMatch", language) : tCockpit("launcherEmpty", language)}
              </p>
            </div>
          ) : isExam ? (
            groups.map((group) => (
              <button
                key={group.moduleId}
                type="button"
                onClick={() => go(`/dashboard/module/${group.moduleId}/exam`)}
                className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-50/60 dark:hover:border-primary-800 dark:hover:bg-primary-950/30"
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-primary-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{group.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {group.courses.length} {tCockpit(group.courses.length > 1 ? "coursesPlural" : "courseSingular", language)}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary-500" />
              </button>
            ))
          ) : (
            groups.map((group) => (
              <div key={group.moduleId}>
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{group.title}</p>
                <div className="space-y-1.5">
                  {group.courses.map((course) => (
                    <button
                      key={course.id}
                      type="button"
                      onClick={() => go(`/dashboard/module/${course.moduleId}?course=${course.id}&lab=${launcher?.kind === "lab" ? launcher.tool : ""}`)}
                      className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:border-primary-300 hover:bg-primary-50/60 dark:hover:border-primary-800 dark:hover:bg-primary-950/30"
                    >
                      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary-500" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{course.title}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary-500" />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
