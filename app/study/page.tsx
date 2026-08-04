"use client";

import { Trophy, BrainCircuit } from "lucide-react";
import { StudyDashboard } from "@/components/study/StudyDashboard";
import { WeaknessRadar } from "@/components/study/WeaknessRadar";
import { SpacedRepetitionReview } from "@/components/study/SpacedRepetitionReview";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

/**
 * "Espace Étude" — the /study nav entry (see components/layout/Sidebar.tsx).
 * Two tabs: the pre-existing gamification/timer prototype (local state only,
 * no backend), and the real Supabase-backed Weakness Radar + spaced-
 * repetition review session (qcm_attempts, see supabase/schema.sql and
 * app/api/srs/*). Both need a signed-in session for their data to mean
 * anything, which this route gets for free — it's only ever reached via the
 * sidebar link, itself only rendered inside the authenticated dashboard shell.
 */
export default function StudyTestPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <Tabs defaultValue="revision">
          <TabsList>
            <TabsTrigger value="revision">
              <BrainCircuit className="h-4 w-4" />
              Révision &amp; Points Faibles
            </TabsTrigger>
            <TabsTrigger value="session">
              <Trophy className="h-4 w-4" />
              Ma Session
            </TabsTrigger>
          </TabsList>

          <TabsContent value="revision" className="space-y-6">
            <SpacedRepetitionReview />
            <WeaknessRadar />
          </TabsContent>

          <TabsContent value="session">
            <StudyDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
