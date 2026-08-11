"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Settings, LogOut, PlayCircle } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useAuth } from "@/providers/AuthProvider";
import { PLEURESIE_DEMO_SLUG } from "@/lib/constants";

export function Topbar({
  title,
  onMenuClick,
}: {
  title: string;
  onMenuClick?: () => void;
}) {
  const router = useRouter();
  const { profile, signOut, trial, isSubscribed } = useAuth();

  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";
  const showTrialBadge = !isSubscribed && trial?.active && trial.daysRemaining > 0;

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/70 px-4 backdrop-blur-lg sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="text-muted-foreground lg:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href={`/dashboard/demo/${PLEURESIE_DEMO_SLUG}`}
          className="hidden items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50 sm:flex"
        >
          <PlayCircle className="h-3.5 w-3.5" />
          Voir la Démo
        </Link>
        {showTrialBadge && (
          <Badge variant="warning" className="hidden sm:inline-flex">
            Essai gratuit : {trial.daysRemaining} jour{trial.daysRemaining > 1 ? "s" : ""} restant
            {trial.daysRemaining > 1 ? "s" : ""}
          </Badge>
        )}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950">
            <Avatar>
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
    </header>
  );
}
