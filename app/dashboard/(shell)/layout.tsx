"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { PageTransition } from "@/components/layout/PageTransition";
import { SidebarProvider } from "@/providers/SidebarProvider";
import { cn } from "@/lib/utils";

// Only the assistant page goes full-bleed (no max-width cap, no padding
// around it) — every other page in this shell (dashboard list, billing,
// settings, notes, search) keeps the centered, padded reading-width
// treatment. Branching on pathname here, in the ONE shared layout every
// (shell) page already goes through, avoids duplicating Sidebar/Topbar
// wiring into a second layout just for this one route.
const FULL_BLEED_ROUTES = ["/dashboard/assistant"];

/**
 * "Native-app" no-scroll viewport architecture: the shell's own root is a
 * fixed `h-dvh` flex box that NEVER scrolls (`overflow-hidden`) — Topbar
 * and MobileBottomNav are `flex-none`/`fixed` so they stay permanently
 * pinned to the top and bottom of the screen, and ONLY the `<main>` region
 * between them scrolls (`flex-1 overflow-y-auto`). `min-h-0` on that
 * scrolling region (and on its flex-column parent) is load-bearing, not
 * decorative: a flex child with `overflow-y-auto` silently refuses to
 * actually clip/scroll without it, since flex items default to
 * `min-height: auto` — they'd grow to fit their content and push past the
 * parent's bound instead of containing + scrolling internally.
 *
 * This is deliberately scoped to THIS shell, not the true `<html>`/`<body>`
 * — the public landing page (app/page.tsx) and /login /register are
 * long-form scrolling pages entirely outside this route group; forcing
 * `overflow: hidden` on the real `<body>` would silently break scrolling on
 * those pages for zero benefit, since full containment here already
 * guarantees the outer document never needs to scroll on shell routes.
 */
export default function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isFullBleed = FULL_BLEED_ROUTES.includes(pathname);

  return (
    <SidebarProvider>
      <div className="aurora-canvas-bg relative flex h-dvh w-full overflow-hidden">
        <div aria-hidden className="aurora-mesh-bg animate-mesh-pulse pointer-events-none fixed inset-0 -z-10" />

        <div className="hidden shrink-0 lg:block lg:p-3">
          <Sidebar />
        </div>

        <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3 lg:pl-0">
          <Topbar title="Espace Étudiant" />

          <main
            className={cn(
              "relative min-h-0 flex-1 overscroll-y-contain",
              isFullBleed ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            <div className={cn(isFullBleed ? "h-full" : "mx-auto w-full max-w-7xl px-2 pb-24 pt-1 sm:px-4 sm:pb-6 lg:px-8")}>
              <PageTransition className={isFullBleed ? "block h-full" : undefined}>{children}</PageTransition>
            </div>
          </main>
        </div>

        <MobileBottomNav />
      </div>
    </SidebarProvider>
  );
}
