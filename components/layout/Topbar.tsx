"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Settings, LogOut } from "lucide-react";
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
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-3">
        <button onClick={onMenuClick} className="text-muted-foreground lg:hidden">
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
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
