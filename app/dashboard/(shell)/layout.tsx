"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PageTransition } from "@/components/layout/PageTransition";

/**
 * Chrome (Sidebar + Topbar) for the dashboard list, settings, and billing
 * pages. Deliberately NOT applied to /dashboard/course/[id] — that route is
 * a full-screen workspace and lives as a sibling outside this group so it
 * doesn't inherit this shell (see app/dashboard/layout.tsx).
 */
export default function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar title="Espace Étudiant" onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
