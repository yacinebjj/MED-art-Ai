"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PageTransition } from "@/components/layout/PageTransition";
import { SidebarProvider } from "@/providers/SidebarProvider";
import { cn } from "@/lib/utils";

// Only the assistant page goes full-bleed (no max-width cap, no py-8/px
// padding around it) — every other page in this shell (dashboard list,
// billing, settings) keeps the centered, padded reading-width treatment.
// Branching on pathname here, in the ONE shared layout every (shell) page
// already goes through, avoids duplicating Sidebar/Topbar wiring into a
// second layout just for this one route.
const FULL_BLEED_ROUTES = ["/dashboard/assistant"];

/**
 * Chrome (Sidebar + Topbar) for the dashboard list, settings, billing, and
 * assistant pages. Deliberately NOT applied to full-screen workspaces like
 * app/dashboard/demo/[slug] — those live as siblings outside this group so
 * they don't inherit this shell (see app/dashboard/layout.tsx).
 */
export default function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const isFullBleed = FULL_BLEED_ROUTES.includes(pathname);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar title="Espace Étudiant" onMenuClick={() => setSidebarOpen(true)} />
          <main
            className={cn(
              "clinical-canvas-bg relative flex-1",
              isFullBleed ? "overflow-hidden" : "px-4 py-8 sm:px-6 lg:px-8"
            )}
          >
            <div
              aria-hidden
              className="clinical-mesh-bg animate-mesh-pulse pointer-events-none absolute inset-0 -z-10"
            />
            <div className={cn(isFullBleed ? "h-full" : "mx-auto w-full max-w-7xl")}>
              <PageTransition className={isFullBleed ? "block h-full" : undefined}>{children}</PageTransition>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
