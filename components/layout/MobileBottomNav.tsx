"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutDashboard, Sparkles, Brain, NotebookPen, MoreHorizontal, Settings, CreditCard, LogOut, ListTodo, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
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

// 4 primary destinations get their own tap target — mirrors the top 4 of
// Sidebar.tsx's NAV_ITEMS. Abonnement/Paramètres/Déconnexion move into the
// 5th "Plus" slot's dropdown instead of competing for thumb space; native
// iOS/Android bottom bars rarely exceed 5 items for the same reason.
const PRIMARY_ITEMS = [
  { href: "/dashboard", key: "home" as const, icon: LayoutDashboard },
  { href: "/dashboard/assistant", key: "assistant" as const, icon: Sparkles },
  { href: "/dashboard/study", key: "study" as const, icon: Brain },
  { href: "/dashboard/notes", key: "notes" as const, icon: NotebookPen },
];

/**
 * Native-app-style bottom tab bar — replaces the slide-in drawer on mobile
 * (< lg) entirely; Sidebar.tsx now renders desktop-only. `fixed bottom-0`,
 * safe-area padding for iOS home-indicator devices, and each tap target is
 * a full flex-1 column (well over the 44px/h-12 minimum) rather than a
 * bare icon, per the redesign's "large touch targets" requirement.
 */
export function MobileBottomNav({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname();
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { language } = useLanguage();
  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const isMoreActive = ["/dashboard/billing", "/dashboard/settings", "/dashboard/todo", "/dashboard/groups"].some((p) => pathname.startsWith(p));

  return (
    <nav
      aria-hidden={hidden}
      className={cn(
        "glass-panel shadow-glass dark:shadow-glass-dark fixed inset-x-3 bottom-3 z-40 flex items-stretch justify-around rounded-3xl px-1 lg:hidden",
        !prefersReducedMotion && "transition-[transform,opacity] duration-200 ease-out",
        hidden ? "pointer-events-none translate-y-[calc(100%+2rem)] opacity-0" : "translate-y-0 opacity-100"
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {PRIMARY_ITEMS.map((item) => {
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
            className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2.5 text-[11px] font-medium transition-all duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isActive && (
              <motion.span
                layoutId="bottom-nav-active-pill"
                className="absolute inset-1 rounded-2xl bg-primary-500/15 dark:bg-primary-400/15"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <Icon className={cn("relative z-10 h-5 w-5", isActive ? "text-primary-600 dark:text-primary-300" : "text-muted-foreground")} />
            <span className={cn("relative z-10", isActive ? "font-semibold text-primary-600 dark:text-primary-300" : "text-muted-foreground")}>
              {t(item.key, language)}
            </span>
          </Link>
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2.5 text-[11px] font-medium outline-none transition-transform duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          {isMoreActive && (
            <motion.span
              layoutId="bottom-nav-active-pill"
              className="absolute inset-1 rounded-2xl bg-primary-500/15 dark:bg-primary-400/15"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <MoreHorizontal className={cn("relative z-10 h-5 w-5", isMoreActive ? "text-primary-600 dark:text-primary-300" : "text-muted-foreground")} />
          <span className={cn("relative z-10", isMoreActive ? "font-semibold text-primary-600 dark:text-primary-300" : "text-muted-foreground")}>{t("more", language)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="mb-2 w-56">
          <DropdownMenuLabel className="flex items-center gap-2 truncate">
            <Avatar className="h-6 w-6">
              {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
              <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
            </Avatar>
            <span className="truncate">{profile?.fullName || profile?.email || "Étudiant(e)"}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard/todo">
              <ListTodo className="h-4 w-4" />
              {t("todo", language)}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/groups">
              <Users className="h-4 w-4" />
              {t("groups", language)}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/billing">
              <CreditCard className="h-4 w-4" />
              {t("billing", language)}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings">
              <Settings className="h-4 w-4" />
              {t("settings", language)}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOut}>
            <LogOut className="h-4 w-4" />
            {t("signOut", language)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
