"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Apple, BrainCircuit, Layers, Play, Pause, RotateCcw, Timer } from "lucide-react";
import { StudyDashboard } from "@/components/study/StudyDashboard";
import { WeaknessRemediationPlan } from "@/components/study/WeaknessRemediationPlan";
import { ActiveFlashcardsDeck } from "@/components/study/ActiveFlashcardsDeck";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import { usePomodoro } from "@/providers/PomodoroProvider"; // 👈 استيراد المخ العالمي للبومودورو

function StudyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "session" ? "session" : tabParam === "flashcards" ? "flashcards" : "revision";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isPending, startTransition] = useTransition();

  // 👈 جلب حالة العداد العالمي لكي يصبح متزامناً مع الـ Topbar والتطبيق كامل
  const { seconds, isActive, toggleActive, resetTimer } = usePomodoro();

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;

  function handleTabChange(value: string) {
    startTransition(() => {
      setActiveTab(value);
      router.replace(`/study?tab=${value}`, { scroll: false });
    });
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Link>

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
              title={isActive ? "Pause" : "Démarrer"}
            >
              {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={resetTimer}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
              title="Réinitialiser"
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
              Points Faibles
            </TabsTrigger>
            <TabsTrigger value="flashcards">
              <Layers className="h-4 w-4" />
              Flashcards
            </TabsTrigger>
            <TabsTrigger value="session">
              <Apple className="h-4 w-4" />
              Pomodoro
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
    </div>
  );
}

export default function StudyTestPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
      <StudyPageContent />
    </Suspense>
  );
}