"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Settings, CreditCard, Brain, NotebookPen, LogOut, ChevronsUpDown, Sparkles, ListTodo, Users } from "lucide-react";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { useSidebarState } from "@/providers/SidebarProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { t } from "@/lib/translations";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

const NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard" as const, icon: LayoutDashboard },
  { href: "/dashboard/assistant", key: "assistant" as const, icon: Sparkles },
  { href: "/dashboard/study", key: "studySpace" as const, icon: Brain },
  { href: "/dashboard/todo", key: "todo" as const, icon: ListTodo },
  { href: "/dashboard/groups", key: "groups" as const, icon: Users },
  { href: "/dashboard/notes", key: "notes" as const, icon: NotebookPen },
  { href: "/dashboard/billing", key: "billing" as const, icon: CreditCard },
  { href: "/dashboard/settings", key: "settings" as const, icon: Settings },
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
  const { language } = useLanguage();
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
              // "Tableau de bord" also covers the course-workspace routes
              // (/dashboard/module/[id], /dashboard/audio-workspace) —
              // neither has its own sidebar entry (they're reached BY
              // clicking a card ON the dashboard), so without this the whole
              // sidebar went blank the moment a student opened one, making it
              // look like they'd left the app's main section rather than
              // being in its most-used feature. Every other item keeps
              // strict equality — this must never also light up while on
              // e.g. /dashboard/notes or /dashboard/settings.
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard" ||
                    pathname.startsWith("/dashboard/module/") ||
                    pathname.startsWith("/dashboard/audio-workspace")
                  : pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isActive
                      ? "font-semibold text-primary-700 dark:text-primary-300"
                      : "font-medium text-muted-foreground hover:translate-x-0.5 hover:bg-white/40 hover:text-foreground dark:hover:bg-white/5"
                  )}
                >
                  {isActive && (
                    <>
                      {/* Colored fill + icon/text tone already say "active" —
                          this rail is the extra glanceable cue that reads
                          instantly even in peripheral vision while scanning
                          down the list, without adding any new copy/clutter. */}
                      <motion.span
                        layoutId="sidebar-active-rail"
                        className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-primary-400 to-violet-400"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                      <motion.span
                        layoutId="sidebar-active-pill"
                        className="absolute inset-0 rounded-2xl bg-gradient-to-r from-primary-500/15 to-violet-500/10 shadow-glow"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    </>
                  )}
                  <Icon className="relative z-10 h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-110" />
                  <span className="relative z-10">{t(item.key, language)}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5">
                {/* Real photo when Settings > profile upload has set one
                    (profile.avatarUrl, from AuthProvider) — Radix's
                    AvatarPrimitive.Image falls back to AvatarFallback's
                    initial automatically on an empty/broken src, so no
                    manual error handling is needed here. */}
                <Avatar>
                  {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
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
                    {t("settings", language)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut className="h-4 w-4" />
                  {t("signOut", language)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </aside>
  );
}
