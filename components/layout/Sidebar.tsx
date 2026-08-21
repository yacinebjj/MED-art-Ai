"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Settings, CreditCard, Brain, NotebookPen, LogOut, ChevronsUpDown, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useSidebarState } from "@/providers/SidebarProvider";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/dashboard/assistant", label: "MedArt Assistant", icon: Sparkles },
  { href: "/study", label: "Espace Étude", icon: Brain },
  { href: "/dashboard/notes", label: "Mes notes", icon: NotebookPen },
  { href: "/dashboard/billing", label: "Abonnement", icon: CreditCard },
  { href: "/dashboard/settings", label: "Paramètres", icon: Settings },
];

/**
 * Desktop-only floating glass sidebar (lg+) — mobile (< lg) uses
 * MobileBottomNav.tsx instead of a slide-in drawer, per the redesign
 * brief's "remove cluttered sidebars, use sleek drawer/bottom-bar on
 * mobile" direction. Inset from the viewport edges (m-3) with rounded-3xl
 * corners and .glass-panel, rather than the old edge-to-edge bordered
 * panel — the "floating sidebar" the brief asks for on desktop.
 */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { isDesktopSidebarOpen } = useSidebarState();
  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 transition-[width] duration-300 lg:block",
        isDesktopSidebarOpen ? "w-64" : "w-0"
      )}
    >
      {/* Fixed-width inner shell, same reasoning as before the redesign:
          the OUTER <aside> animates width (64 -> 0) on collapse; this inner
          content keeps a fixed width of its own so it appears to slide out
          of view via the outer's overflow-hidden clip, instead of
          reflowing/squishing as the outer shrinks. No more sticky/calc(100vh)
          hack — the shell's own root is now a fixed h-dvh flex box (see
          app/dashboard/(shell)/layout.tsx), so this just inherits h-full
          from its row-flex parent directly. */}
      <div className={cn("h-full w-64 overflow-hidden transition-opacity duration-200", !isDesktopSidebarOpen && "opacity-0")}>
        <div className="glass-panel shadow-glass dark:shadow-glass-dark flex h-full w-64 flex-col rounded-3xl">
          {/* Real logo.png replaces the old AnimatedBrandMark-icon + "Med
              Art AI"-text lockup here specifically — AnimatedBrandMark
              itself is untouched everywhere else it's used, this is the
              one spot that had its own separate text-based wordmark.
              Header row grown h-20 -> h-24 to comfortably fit the bigger
              size="lg" (80px) mark without touching the row's edges. */}
          <div className="flex h-24 items-center px-5">
            <Logo size="lg" />
          </div>

          <nav className="flex-1 space-y-1 px-3 py-2">
            {NAV_ITEMS.map((item) => {
              // "Tableau de bord" also covers the two course-workspace
              // routes (/dashboard/module/[id], /dashboard/demo/[slug]) —
              // neither has its own sidebar entry (they're reached BY
              // clicking a card ON the dashboard), so without this the whole
              // sidebar went blank the moment a student opened a course,
              // making it look like they'd left the app's main section
              // rather than being in its most-used feature. Every other item
              // keeps strict equality — this must never also light up while
              // on e.g. /dashboard/notes or /dashboard/settings.
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard" || pathname.startsWith("/dashboard/module/") || pathname.startsWith("/dashboard/demo/")
                  : pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200",
                    isActive
                      ? "font-semibold text-primary-700 dark:text-primary-300"
                      : "font-medium text-muted-foreground hover:translate-x-0.5 hover:bg-white/40 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-active-pill"
                      className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary-500/15 to-violet-500/10 shadow-[inset_0_0_0_1px_rgba(20,184,166,0.25)]"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon className="relative z-10 h-5 w-5 shrink-0" />
                  <span className="relative z-10">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5">
                {/* Initials only, no image — the user explicitly wants zero
                    image assets in the profile display. doctor-report.png
                    is now unused anywhere in the app. */}
                <Avatar>
                  <AvatarFallback>{initial}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {profile?.fullName || "Étudiant(e)"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuLabel className="truncate">
                  {profile?.fullName || profile?.email || "Étudiant(e)"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings">
                    <Settings className="h-4 w-4" />
                    Paramètres
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut className="h-4 w-4" />
                  Déconnexion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </aside>
  );
}
