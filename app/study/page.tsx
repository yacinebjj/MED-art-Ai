import { StudyDashboard } from "@/components/study/StudyDashboard";

/**
 * Temporary, isolated testing route for the Gamification & Study Timer
 * prototype — no auth gate, no layout dependency on the dashboard shell.
 * Safe to delete once the component is reviewed/merged into the real app.
 */
export default function StudyTestPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-10">
      <div className="mx-auto max-w-5xl">
        <StudyDashboard />
      </div>
    </div>
  );
}
