"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Apple, BrainCircuit, Layers, Play, Pause, RotateCcw, Timer } from "lucide-react";
import { StudyDashboard } from "@/components/study/StudyDashboard";
import { WeaknessRemediationPlan } from "@/components/study/WeaknessRemediationPlan";
import { ActiveFlashcardsDeck } from "@/components/study/ActiveFlashcardsDeck";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import { usePomodoro } from "@/providers/PomodoroProvider"; // 👈 استيراد المخ العالمي للبومودورو
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudy } from "@/lib/translations/study";

// Moved here from the old app/study/page.tsx (outside the (shell) route
// group, so Sidebar/Topbar/MobileBottomNav never rendered on it at all —
// not hidden by any condition, just a different route tree entirely). The
// old /study path now just redirects here (see app/study/page.tsx). The
// outer full-viewport wrapper (`min-h-screen`, its own bg color, its own
// `mx-auto max-w-5xl`) is dropped on the move: the shell's own <main> in
// app/dashboard/(shell)/layout.tsx already provides the scroll region,
// background, max-width and padding for every page in this group — keeping
// this page's own copy would have doubled up on all four.
function StudyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "session" ? "session" : tabParam === "flashcards" ? "flashcards" : "revision";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isPending, startTransition] = useTransition();
  const { language } = useLanguage();

  // 👈 جلب حالة العداد العالمي لكي يصبح متزامناً مع الـ Topbar والتطبيق كامل
  const { seconds, isActive, toggleActive, resetTimer } = usePomodoro();

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;

  function handleTabChange(value: string) {
    startTransition(() => {
      setActiveTab(value);
      router.replace(`/dashboard/study?tab=${value}`, { scroll: false });
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        {/* 👈 شريط تحكم سريع للبومودورو هنا في صفحة الدراسة متزامن مع الـ Topbar */}
        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <Timer className="h-4 w-4 text-emerald-500 animate-pulse" />
          <span className="font-mono text-sm font-bold text-gray-800 dark:text-gray-100">
            {formattedTime}
          </span>
          <button
            onClick={toggleActive}
            className={`rounded-lg p-1 text-white transition-colors ${
              isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
            title={isActive ? tStudy("pause", language) : tStudy("start", language)}
          >
            {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={resetTimer}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
            title={tStudy("reset", language)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <PushOptInButton />
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="revision">
            <BrainCircuit className="h-4 w-4" />
            {tStudy("weakPoints", language)}
          </TabsTrigger>
          <TabsTrigger value="flashcards">
            <Layers className="h-4 w-4" />
            {tStudy("flashcards", language)}
          </TabsTrigger>
          <TabsTrigger value="session">
            <Apple className="h-4 w-4" />
            {tStudy("pomodoro", language)}
          </TabsTrigger>
        </TabsList>

        <div className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <TabsContent value="revision" className="space-y-6">
            <WeaknessRemediationPlan />
          </TabsContent>

          <TabsContent value="flashcards">
            <ActiveFlashcardsDeck />
          </TabsContent>

          <TabsContent value="session">
            <StudyDashboard />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default function StudyPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-muted" />}>
      <StudyPageContent />
    </Suspense>
  );
}
