"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Brain, History, Mic, Network, PlayCircle, Sparkles, Stethoscope, Table2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage, type Language } from "@/providers/LanguageProvider";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useCockpitUi } from "@/store/useCockpitUi";
import { readFlashcardSession, readLastOpenedCourse, type FlashcardSessionSummary, type LastOpenedCourse } from "@/lib/dashboard/local-activity";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import { tCockpit, type CockpitKey } from "@/lib/translations/cockpit";
import type { LabToolId } from "@/lib/workspace-lab";
import type { DashboardLabItem } from "@/types/dashboard-overview";
import { CARD_ENTRANCE, Skeleton } from "./primitives";

function relativeTime(iso: string, language: Language): string {
  const diffMinutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(language === "fr" ? "fr" : "en", { numeric: "auto" });
  if (Math.abs(diffMinutes) < 60) return rtf.format(-diffMinutes, "minute");
  const hours = Math.round(diffMinutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

function labToolOf(toolType: string): LabToolId | null {
  if (toolType.startsWith("case:")) return "case-simulator";
  if (toolType.startsWith("matrix:")) return "matrix";
  if (toolType.startsWith("mindmap")) return "mindmap";
  return null;
}

interface LaunchTile {
  id: string;
  icon: LucideIcon;
  titleKey: CockpitKey;
  subtitleKey: CockpitKey;
  gradient: string;
  glow: string;
  tool?: LabToolId;
  href?: string;
}

const TILES: LaunchTile[] = [
  { id: "case", icon: Stethoscope, titleKey: "lab_case-simulator", subtitleKey: "tileCaseSub", gradient: "from-rose-500 to-pink-500", glow: "hover:shadow-rose-500/20", tool: "case-simulator" },
  { id: "matrix", icon: Table2, titleKey: "lab_matrix", subtitleKey: "tileMatrixSub", gradient: "from-violet-500 to-indigo-500", glow: "hover:shadow-violet-500/20", tool: "matrix" },
  { id: "mindmap", icon: Network, titleKey: "lab_mindmap", subtitleKey: "tileMindmapSub", gradient: "from-cyan-500 to-sky-500", glow: "hover:shadow-cyan-500/20", tool: "mindmap" },
  { id: "audio", icon: Mic, titleKey: "navAudio", subtitleKey: "tileAudioSub", gradient: "from-orange-500 to-amber-500", glow: "hover:shadow-orange-500/20", href: "/dashboard/audio-workspace" },
];

function LaunchCard({ tile, last, language }: { tile: LaunchTile; last: { label: string; href: string; when: string } | null; language: Language }) {
  const openLauncher = useCockpitUi((state) => state.openLauncher);
  const Icon = tile.icon;
  const body = (
    <>
      <div aria-hidden className={cn("pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40", tile.gradient)} />
      <span className={cn("relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:rotate-[-6deg] group-hover:scale-110", tile.gradient)}>
        <Icon className="h-5 w-5" />
      </span>
      <p className="relative mt-3 text-sm font-bold text-foreground">{tCockpit(tile.titleKey, language)}</p>
      <p className="relative mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tCockpit(tile.subtitleKey, language)}</p>
      <span className="relative mt-3 inline-flex items-center gap-1 text-xs font-bold text-foreground/80 transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400">
        {tCockpit("launch", language)}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </>
  );
  const cardClass = cn(
    "group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/30 p-4 text-left shadow-glass transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-white/[0.06] dark:shadow-glass-dark glass-card",
    tile.glow
  );

  return (
    <motion.div variants={CARD_ENTRANCE} className="flex flex-col gap-1.5">
      {tile.href ? (
        <Link href={tile.href} className={cardClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={() => tile.tool && openLauncher({ kind: "lab", tool: tile.tool })} className={cardClass}>
          {body}
        </button>
      )}
      {last && (
        <Link
          href={last.href}
          className="flex items-center gap-1.5 truncate rounded-xl px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-white/40 hover:text-foreground dark:hover:bg-white/5"
          title={last.label}
        >
          <History className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {last.label} · {last.when}
          </span>
        </Link>
      )}
    </motion.div>
  );
}

/** Featured "Reprendre la révision": the course actually opened last, the open flashcard batch, the latest audio note. */
function ResumeCard() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const overview = useCockpitStore((state) => state.overview);
  const [lastOpened, setLastOpened] = useState<LastOpenedCourse | null | undefined>(undefined);
  const [session, setSession] = useState<FlashcardSessionSummary | null>(null);

  useEffect(() => {
    setLastOpened(user?.id ? readLastOpenedCourse(user.id) : null);
    setSession(user?.id ? readFlashcardSession(user.id) : null);
  }, [user?.id]);

  const course = useMemo(() => {
    if (!overview) return null;
    // A locally remembered course only counts if it still exists.
    if (lastOpened && overview.courses.some((c) => c.id === lastOpened.courseId)) {
      const match = overview.courses.find((c) => c.id === lastOpened.courseId)!;
      return { ...match, when: lastOpened.openedAt };
    }
    const latest = overview.courses[0];
    return latest ? { ...latest, when: latest.updatedAt } : null;
  }, [overview, lastOpened]);

  if (!overview || lastOpened === undefined) {
    return (
      <div className="glass-card rounded-3xl p-5">
        <Skeleton className="mb-3 h-4 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="mt-3 h-9 w-36" />
      </div>
    );
  }

  const audio = overview.lectureNotes[0] ?? null;

  return (
    <motion.div
      variants={CARD_ENTRANCE}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-teal-600 to-violet-700 p-[1.5px] shadow-xl shadow-primary-500/20"
    >
      <div className="relative h-full overflow-hidden rounded-[calc(1.5rem-1.5px)] bg-gradient-to-br from-primary-600/95 via-teal-700/95 to-violet-800/95 p-5 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 left-1/3 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" />
        <p className="relative flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
          <PlayCircle className="h-3.5 w-3.5" />
          {tCockpit("resumeHeading", language)}
        </p>

        {course ? (
          <>
            <p className="relative mt-2 line-clamp-2 text-lg font-extrabold leading-snug">{course.title}</p>
            <p className="relative mt-0.5 text-xs text-white/75">
              {course.moduleTitle ? translateCurriculumName(course.moduleTitle, language) : ""} · {relativeTime(course.when, language)}
            </p>
            {course.qcmMasteryPct !== null && (
              <div className="relative mt-3 max-w-xs">
                <div className="mb-1 flex justify-between text-[10px] font-semibold text-white/75">
                  <span>{tCockpit("qcmMastery", language)}</span>
                  <span>{course.qcmMasteryPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                  <motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width: `${course.qcmMasteryPct}%` }} transition={{ duration: 0.8 }} />
                </div>
              </div>
            )}
            <Link
              href={`/dashboard/module/${course.moduleId}?course=${course.id}`}
              className="relative mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-primary-700 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl active:scale-95"
            >
              <BookOpen className="h-4 w-4" />
              {tCockpit("resumeCta", language)}
            </Link>
          </>
        ) : (
          <>
            <p className="relative mt-2 text-lg font-extrabold">{tCockpit("resumeEmptyTitle", language)}</p>
            <p className="relative mt-1 max-w-sm text-xs text-white/80">{tCockpit("resumeEmptyBody", language)}</p>
            <a
              href="#curriculum"
              className="relative mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-primary-700 shadow-lg transition-all hover:-translate-y-0.5"
            >
              <Sparkles className="h-4 w-4" />
              {tCockpit("resumeEmptyCta", language)}
            </a>
          </>
        )}

        {(session && session.remainingInBatch > 0) || audio ? (
          <div className="relative mt-4 flex flex-wrap gap-2 border-t border-white/15 pt-3">
            {session && session.remainingInBatch > 0 && (
              <Link href="/dashboard/study?tab=flashcards" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur transition-colors hover:bg-white/25">
                <Brain className="h-3.5 w-3.5" />
                {tCockpit("resumeFlashcards", language).replace("{n}", String(session.remainingInBatch))}
              </Link>
            )}
            {audio && (
              <Link href={`/dashboard/audio-workspace?jobId=${audio.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur transition-colors hover:bg-white/25">
                <Mic className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{audio.title}</span>
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

/** Quick-Launch Hub: the MedArt Lab tools + Audio Smart Notes, each with the student's last use of it, and the Resume card. */
export function QuickLaunchHub() {
  const { language } = useLanguage();
  const overview = useCockpitStore((state) => state.overview);

  const lastByTool = useMemo(() => {
    const map = new Map<string, { label: string; href: string; when: string }>();
    for (const item of overview?.lab ?? ([] as DashboardLabItem[])) {
      const tool = labToolOf(item.toolType);
      if (!tool || map.has(tool)) continue;
      map.set(tool, {
        label: item.title || item.courseTitle,
        href: `/dashboard/module/${item.moduleId}?course=${item.courseId}&lab=${tool}`,
        when: relativeTime(item.lastOpenedAt, language),
      });
    }
    const audio = overview?.lectureNotes[0];
    if (audio) map.set("audio", { label: audio.title, href: `/dashboard/audio-workspace?jobId=${audio.id}`, when: relativeTime(audio.updatedAt, language) });
    return map;
  }, [overview, language]);

  return (
    <section aria-labelledby="quicklaunch-heading">
      <div className="mb-3">
        <h2 id="quicklaunch-heading" className="text-base font-bold tracking-tight text-foreground sm:text-lg">
          {tCockpit("quickLaunchHeading", language)}
        </h2>
        <p className="text-xs text-muted-foreground">{tCockpit("quickLaunchSub", language)}</p>
      </div>
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2fr)]"
      >
        <ResumeCard />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
          {TILES.map((tile) => (
            <LaunchCard key={tile.id} tile={tile} last={lastByTool.get(tile.tool ?? tile.id) ?? null} language={language} />
          ))}
        </div>
      </motion.div>
    </section>
  );
}
