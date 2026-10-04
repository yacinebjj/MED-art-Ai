"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Brain, Pause, Play, RotateCcw, Sparkles, Timer } from "lucide-react";
import { PushOptInButton } from "@/components/push/PushOptInButton";
import { CyberHeader, CyberStage, SegmentedControl } from "@/components/cyber/primitives";
import { usePomodoro } from "@/providers/PomodoroProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tStudy } from "@/lib/translations/study";
import { cn } from "@/lib/utils";

// Code-split: each tab is its own chunk, fetched only when first opened.
const ActiveFlashcardsDeck = dynamic(() => import("@/components/study/ActiveFlashcardsDeck").then((m) => m.ActiveFlashcardsDeck), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});
const StudyDashboard = dynamic(() => import("@/components/study/StudyDashboard").then((m) => m.StudyDashboard), {
  ssr: false,
  loading: () => <PanelSkeleton />,
});

type StudyTab = "flashcards" | "session";

function PanelSkeleton() {
  return <div className="h-[420px] animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.03]" />;
}

// Moved here from the old app/study/page.tsx (outside the (shell) route
// group). The shell's own <main> provides the scroll region and padding.
function StudyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: StudyTab = tabParam === "session" ? "session" : "flashcards";
  const [activeTab, setActiveTab] = useState<StudyTab>(initialTab);
  // A tab is mounted the first time it is opened and then KEPT mounted
  // (just hidden): both panels hold real session state (current card,
  // ambience, breathing guide…) that must survive switching away and back.
  const [visited, setVisited] = useState<Record<StudyTab, boolean>>({ flashcards: initialTab === "flashcards", session: initialTab === "session" });
  const [isPending, startTransition] = useTransition();
  const { language } = useLanguage();

  // Global Pomodoro state (providers/PomodoroProvider.tsx) — the same one the Topbar widget reads.
  const { seconds, isActive, toggleActive, resetTimer } = usePomodoro();
  const formattedTime = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  // The sidebar's Flashcards / Pomodoro links only change `?tab=` on this
  // same page — follow them instead of keeping the tab picked at mount.
  useEffect(() => {
    const next: StudyTab = tabParam === "session" ? "session" : "flashcards";
    setActiveTab(next);
    setVisited((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
  }, [tabParam]);

  function handleTabChange(value: StudyTab) {
    setVisited((prev) => ({ ...prev, [value]: true }));
    startTransition(() => {
      setActiveTab(value);
      router.replace(`/dashboard/study?tab=${value}`, { scroll: false });
    });
  }

  const isFlashcards = activeTab === "flashcards";

  return (
    // overflow-x-clip: FlipFlashcard's swipe flings the card past the page edge on grade.
    <CyberStage accent={isFlashcards ? "cyan" : "violet"} className="mx-auto max-w-5xl overflow-x-clip p-4 sm:p-6 lg:p-8">
      <CyberHeader
        icon={Sparkles}
        kicker={isFlashcards ? "Neuro-mémoire" : "Focus cockpit"}
        title={tStudy("pageTitle", language)}
        subtitle={tStudy("pageSubtitle", language)}
        actions={
          <>
            {/* Quick Pomodoro control — same global state as the Topbar widget. */}
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-1.5">
              <span className={cn("relative flex h-2 w-2 shrink-0 rounded-full", isActive ? "bg-emerald-400" : "bg-slate-600")}>
                {isActive && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400" />}
              </span>
              <Timer className="h-4 w-4 text-violet-300" />
              <span className="font-mono text-sm font-bold tabular-nums text-white">{formattedTime}</span>
              <button
                type="button"
                onClick={toggleActive}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl text-slate-950 transition-transform active:scale-90",
                  isActive ? "bg-amber-400" : "bg-gradient-to-br from-cyan-300 to-sky-400"
                )}
                title={isActive ? tStudy("pause", language) : tStudy("start", language)}
                aria-label={isActive ? tStudy("pause", language) : tStudy("start", language)}
              >
                {isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white active:scale-90"
                title={tStudy("reset", language)}
                aria-label={tStudy("reset", language)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
            <PushOptInButton />
          </>
        }
      />

      <SegmentedControl<StudyTab>
        className="mt-6 w-fit"
        ariaLabel={tStudy("pageTitle", language)}
        value={activeTab}
        onChange={handleTabChange}
        options={[
          { value: "flashcards", label: tStudy("flashcards", language), icon: Brain },
          { value: "session", label: tStudy("pomodoro", language), icon: Timer },
        ]}
      />

      <div className={cn("mt-6 transition-opacity duration-200", isPending && "opacity-60")}>
        {visited.flashcards && (
          <div hidden={!isFlashcards} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <ActiveFlashcardsDeck />
          </div>
        )}
        {visited.session && (
          <div hidden={isFlashcards} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <StudyDashboard />
          </div>
        )}
      </div>
    </CyberStage>
  );
}

export default function StudyPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-40 max-w-5xl animate-pulse rounded-[1.75rem] bg-slate-950" />}>
      <StudyPageContent />
    </Suspense>
  );
}
