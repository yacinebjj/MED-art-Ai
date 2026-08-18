"use client";

import { Suspense, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Apple, BrainCircuit, Layers } from "lucide-react";
import { StudyDashboard } from "@/components/study/StudyDashboard";
import { WeaknessRemediationPlan } from "@/components/study/WeaknessRemediationPlan";
import { ActiveFlashcardsDeck } from "@/components/study/ActiveFlashcardsDeck";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { PushOptInButton } from "@/components/push/PushOptInButton";

/**
 * "Espace Étude" — the /study nav entry (see components/layout/Sidebar.tsx).
 * Three tabs, three independent features — deliberately NOT nested/gated
 * behind one another:
 * - "revision" (labeled "Points Faibles"): AI-generated "Points Faibles &
 *   Plan de Remédiation" (app/api/study/remediation-plan/*). Used to also
 *   host the real Leitner-box spaced-repetition review session
 *   (SpacedRepetitionReview, sourced from qcm_attempts via app/api/srs/*) —
 *   removed by direct request; that component and its due-review UI no
 *   longer exist anywhere in the app. The underlying attempt-recording and
 *   mastery/weakness tracking (app/api/srs/attempt, course-mastery,
 *   weakness-radar) are untouched and still power WeaknessRemediationPlan
 *   and CourseStatsModal elsewhere — only the "review your due items" UI
 *   itself was deleted, not the data.
 * - "flashcards": the separate AI-generated Q&A flashcards deck, pooled and
 *   shuffled across every activated module/course (app/api/flashcards/*).
 * - "session": the pre-existing gamification/timer prototype (local state
 *   only, no backend).
 * All three need a signed-in session for their data to mean anything, which
 * this route gets for free — it's only ever reached via the sidebar link,
 * itself only rendered inside the authenticated dashboard shell.
 *
 * Controlled (not `defaultValue`) specifically so a push notification's deep
 * link (`/study?tab=flashcards`, see public/sw.js's notificationclick
 * handler) reliably lands on the right tab regardless of whatever tab was
 * last active — explicit is safer than relying on a default that can change.
 *
 * Tab changes sync back into the URL (`router.replace`, not `push` — a tab
 * click isn't a new history entry, it'd make the browser's back button step
 * through every tab the student visited instead of leaving the page). Without
 * this, navigating away and back via the sidebar always reset to "revision"
 * regardless of which tab was open — which fought directly against
 * ActiveFlashcardsDeck's own localStorage "resume where I left off": the
 * deck would still resume correctly, but the student would have to notice
 * and manually re-click the Flashcards tab to see it every single time.
 */
function StudyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam === "session" ? "session" : tabParam === "flashcards" ? "flashcards" : "revision";
  const [activeTab, setActiveTab] = useState(initialTab);
  // Switching tabs mounts/unmounts a fairly heavy subtree (WeaknessRemediationPlan
  // vs. ActiveFlashcardsDeck vs. StudyDashboard) — marking the update as a
  // transition lets React keep the CURRENT tab's content interactive/visible
  // while it prepares the new one, instead of the click blocking on a
  // synchronous re-render.
  const [isPending, startTransition] = useTransition();

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

/** useSearchParams() (read by StudyPageContent, for the ?tab= deep link) requires a Suspense boundary at build time — this wrapper is purely that, no logic of its own. */
export default function StudyTestPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
      <StudyPageContent />
    </Suspense>
  );
}
