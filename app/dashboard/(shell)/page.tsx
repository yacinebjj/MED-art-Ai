"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { GraduationCap, Settings } from "lucide-react";
import { FloatingMedicalIcons } from "@/components/dashboard/FloatingMedicalIcons";
import { CockpitHeader } from "@/components/dashboard/os/CockpitHeader";
import { AnalyticsHub } from "@/components/dashboard/os/AnalyticsHub";
import { QuickLaunchHub } from "@/components/dashboard/os/QuickLaunchHub";
import { CurriculumHub, CurriculumHubSkeleton } from "@/components/dashboard/os/CurriculumHub";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tDashboard } from "@/lib/translations/dashboard";
import { tCockpit } from "@/lib/translations/cockpit";
import { translateCurriculumName } from "@/lib/translations/curriculumNames";
import type { CurriculumYearData } from "@/types/academic";

/**
 * MedArt "Medical OS 3.0" home: cockpit header → Analytics & Productivity Hub
 * → Quick-Launch (Lab tools, resume) → Curriculum 3.0. Every widget reads the
 * shared /api/dashboard/overview (store/useCockpitStore, fetched once by the
 * shell layout) or per-device data (Pomodoro focus log, flashcard session);
 * the curriculum itself still comes from /api/curriculum.
 */
export default function DashboardPage() {
  const auth = useAuth() ?? {};
  const curriculumProfile = auth.curriculumProfile;
  const { language } = useLanguage();

  const [curriculumData, setCurriculumData] = useState<CurriculumYearData | null>(null);
  const [curriculumLoading, setCurriculumLoading] = useState(false);
  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  const curriculumSpecialtyName = curriculumProfile?.specialty?.name ?? null;
  const curriculumLevel = curriculumProfile?.academicYear?.level ?? null;

  useEffect(() => {
    if (!curriculumSpecialtyName || curriculumLevel == null) {
      setCurriculumData(null);
      return;
    }

    let cancelled = false;
    setCurriculumLoading(true);
    setCurriculumError(null);

    fetch(`/api/curriculum?specialty=${encodeURIComponent(curriculumSpecialtyName)}&level=${curriculumLevel}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? tDashboard("curriculumLoadError", language));
        return body as CurriculumYearData;
      })
      .then((body) => {
        if (!cancelled) setCurriculumData(body);
      })
      .catch((err) => {
        if (!cancelled) {
          setCurriculumError(err instanceof Error ? err.message : tDashboard("curriculumLoadError", language));
          setCurriculumData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCurriculumLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `language` is intentionally omitted: it only picks the fallback error
    // string's locale and must not trigger a curriculum refetch on toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculumSpecialtyName, curriculumLevel]);

  return (
    // relative — anchors FloatingMedicalIcons' absolute inset-0 layer to this page's own content height.
    <div className="relative mx-auto max-w-[1600px] space-y-6 sm:space-y-8">
      <FloatingMedicalIcons />

      <CockpitHeader />
      <AnalyticsHub />
      <QuickLaunchHub />

      <motion.section
        id="curriculum"
        aria-labelledby="curriculum-heading"
        className="scroll-mt-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="curriculum-heading" className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground sm:text-lg">
              <GraduationCap className="h-5 w-5 text-primary-500" />
              {tCockpit("curriculumHeading", language)}
              {curriculumProfile?.academicYear ? (
                <span className="font-semibold text-muted-foreground">— {translateCurriculumName(curriculumProfile.academicYear.name, language)}</span>
              ) : null}
            </h2>
            <p className="text-xs text-muted-foreground">{tCockpit("curriculumSub", language)}</p>
          </div>
        </div>

        {curriculumProfile === null || curriculumLoading ? (
          <CurriculumHubSkeleton />
        ) : !curriculumProfile?.academicYear ? (
          <div className="glass-card flex flex-col items-center gap-3 rounded-3xl border-dashed p-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:p-6 sm:text-left">
            <div className="shrink-0 overflow-hidden rounded-2xl shadow-md">
              <Image
                src="/illustrations/dashboard-empty-state-mascot.jpeg"
                alt=""
                role="presentation"
                width={96}
                height={96}
                className="h-20 w-20 object-cover sm:h-24 sm:w-24"
              />
            </div>
            <div className="flex flex-col items-center gap-3 sm:items-start">
              <p className="text-sm text-muted-foreground">{tDashboard("chooseSpecialtyHelper", language)}</p>
              <Link
                href="/dashboard/settings"
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-xs font-bold text-white transition-all duration-300 active:scale-95"
              >
                <Settings className="h-3.5 w-3.5" />
                {tDashboard("goToSettings", language)}
              </Link>
            </div>
          </div>
        ) : curriculumError ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {curriculumError}
          </p>
        ) : curriculumData ? (
          <CurriculumHub data={curriculumData} />
        ) : null}
      </motion.section>
    </div>
  );
}
