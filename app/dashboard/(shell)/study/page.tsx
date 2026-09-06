"use client";

import { Suspense, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Apple, BrainCircuit, Layers, Play, Pause, RotateCcw, Sparkles, Timer } from "lucide-react";
import { StudyDashboard } from "@/components/study/StudyDashboard";
import { WeaknessRemediationPlan } from "@/components/study/WeaknessRemediationPlan";
import { ActiveFlashcardsDeck } from "@/components/study/ActiveFlashcardsDeck";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import { usePomodoro } from "@/providers/PomodoroProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudy } from "@/lib/translations/study";
import { cn } from "@/lib/utils";

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

  // Global Pomodoro state (see providers/PomodoroProvider.tsx) — kept in
  // sync with the Topbar's own mini-widget automatically since both read
  // the same context.
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
    <div className="mx-auto max-w-4xl">
      {/* Page header — this space had none before; every other page in the
          shell (billing, exam, ...) opens with an icon + title + subtitle,
          this one jumped straight to controls. */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-600 text-white shadow-[0_0_20px_rgba(20,184,166,0.4)]">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
              {tStudy("pageTitle", language)}
            </h1>
            <p className="text-xs text-muted-foreground sm:text-sm">{tStudy("pageSubtitle", language)}</p>
          </div>
        </div>
      </div>

      {/* Quick Pomodoro control — mirrors the Topbar's own mini-widget, same
          global state (see usePomodoro's own comment above), just reachable
          without leaving this page. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="glass-card flex items-center gap-2.5 rounded-2xl px-3.5 py-2 shadow-soft">
          <span className={cn("relative flex h-2 w-2 shrink-0 rounded-full", isActive ? "bg-emerald-500" : "bg-muted-foreground/40")}>
            {isActive && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500" />}
          </span>
          <Timer className="h-4 w-4 text-primary-600 dark:text-primary-400" />
          <span className="font-mono text-sm font-bold tabular-nums text-foreground">{formattedTime}</span>
          <button
            onClick={toggleActive}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-white shadow-sm transition-all duration-200 active:scale-90",
              isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-primary-600 hover:bg-primary-700"
            )}
            title={isActive ? tStudy("pause", language) : tStudy("start", language)}
          >
            {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={resetTimer}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:scale-90"
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
            <span className="hidden sm:inline">{tStudy("weakPoints", language)}</span>
          </TabsTrigger>
          <TabsTrigger value="flashcards">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">{tStudy("flashcards", language)}</span>
          </TabsTrigger>
          <TabsTrigger value="session">
            <Apple className="h-4 w-4" />
            <span className="hidden sm:inline">{tStudy("pomodoro", language)}</span>
          </TabsTrigger>
        </TabsList>

        <div className={cn("transition-opacity duration-200", isPending && "opacity-60")}>
          {/* Each panel gets its own entrance animation via data-state
              (tailwindcss-animate), not an AnimatePresence+key remount —
              Radix keeps all 3 panels mounted simultaneously (only toggling
              which is visible), and StudyDashboard/ActiveFlashcardsDeck both
              hold real local/session state that must survive switching away
              and back, so a remount-on-switch would silently reset it. */}
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
