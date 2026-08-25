"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutDashboard, Sparkles, Brain, NotebookPen, MoreHorizontal, Settings, CreditCard, LogOut, ListTodo, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/AuthProvider";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
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
  { href: "/dashboard", label: "Accueil", icon: LayoutDashboard },
  { href: "/dashboard/assistant", label: "Assistant", icon: Sparkles },
  { href: "/study", label: "Étude", icon: Brain },
  { href: "/dashboard/notes", label: "Notes", icon: NotebookPen },
];

/**
 * Native-app-style bottom tab bar — replaces the slide-in drawer on mobile
 * (< lg) entirely; Sidebar.tsx now renders desktop-only. `fixed bottom-0`,
 * safe-area padding for iOS home-indicator devices, and each tap target is
 * a full flex-1 column (well over the 44px/h-12 minimum) rather than a
 * bare icon, per the redesign's "large touch targets" requirement.
 */
export function MobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const isMoreActive = ["/dashboard/billing", "/dashboard/settings", "/dashboard/todo", "/dashboard/groups"].some((p) => pathname.startsWith(p));

  return (
    <nav
      className="glass-panel shadow-glass dark:shadow-glass-dark fixed inset-x-3 bottom-3 z-40 flex items-stretch justify-around rounded-3xl px-1 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {PRIMARY_ITEMS.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard" || pathname.startsWith("/dashboard/module/") || pathname.startsWith("/dashboard/demo/")
            : pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2.5 text-[11px] font-medium transition-colors"
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
              {item.label}
            </span>
          </Link>
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-2.5 text-[11px] font-medium outline-none">
          {isMoreActive && (
            <motion.span
              layoutId="bottom-nav-active-pill"
              className="absolute inset-1 rounded-2xl bg-primary-500/15 dark:bg-primary-400/15"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <MoreHorizontal className={cn("relative z-10 h-5 w-5", isMoreActive ? "text-primary-600 dark:text-primary-300" : "text-muted-foreground")} />
          <span className={cn("relative z-10", isMoreActive ? "font-semibold text-primary-600 dark:text-primary-300" : "text-muted-foreground")}>Plus</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="mb-2 w-56">
          <DropdownMenuLabel className="flex items-center gap-2 truncate">
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-[10px]">{initial}</AvatarFallback>
            </Avatar>
            <span className="truncate">{profile?.fullName || profile?.email || "Étudiant(e)"}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard/todo">
              <ListTodo className="h-4 w-4" />
              To-Do List
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/groups">
              <Users className="h-4 w-4" />
              Groupes de Révision
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/billing">
              <CreditCard className="h-4 w-4" />
              Abonnement
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings">
              <Settings className="h-4 w-4" />
              Paramètres
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
