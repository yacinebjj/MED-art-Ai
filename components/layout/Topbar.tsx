"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Settings, LogOut, PlayCircle, Play, Pause, RotateCcw, EyeOff, Timer } from "lucide-react";
import { AnimatedBrandMark } from "./AnimatedBrandMark";
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
import { usePomodoro } from "@/providers/PomodoroProvider";
import { PLEURESIE_DEMO_SLUG } from "@/lib/constants";

// 👈 ويدجت البومودورو مدمج مباشرة هنا بدون الحاجة لملف خارجي
function PomodoroWidget() {
  const { seconds, isActive, isVisible, toggleActive, toggleVisible, resetTimer } = usePomodoro();

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;

  if (!isVisible) {
    return (
      <button
        onClick={toggleVisible}
        title="Afficher le chronomètre"
        className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-neutral-800 dark:text-gray-300 dark:hover:bg-neutral-700"
      >
        <Timer className="h-4 w-4 text-emerald-500" />
        <span className="hidden sm:inline">Chrono</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 rounded-2xl border border-gray-200 bg-white px-2.5 py-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <Timer className="h-4 w-4 text-emerald-500 animate-pulse shrink-0" />
      <span className="font-mono text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-100">
        {formattedTime}
      </span>

      <button
        onClick={toggleActive}
        className={`rounded-lg p-1 text-white transition-colors ${
          isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
        }`}
        title={isActive ? "Pause" : "Démarrer"}
      >
        {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
      </button>

      <button
        onClick={resetTimer}
        className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-gray-200"
        title="Réinitialiser"
      >
        <RotateCcw className="h-3 w-3" />
      </button>

      <button
        onClick={toggleVisible}
        className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-800 dark:hover:text-gray-200 border-l border-gray-200 dark:border-neutral-800 pl-1"
        title="Masquer le chrono"
      >
        <EyeOff className="h-3 w-3" />
      </button>
    </div>
  );
}

export function Topbar({ title }: { title: string }) {
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
    <header className="glass-panel z-20 flex h-14 shrink-0 items-center justify-between rounded-2xl px-3 shadow-glass dark:shadow-glass-dark sm:h-16 sm:px-6">
      <div className="flex items-center gap-3">
        <AnimatedBrandMark size="sm" className="lg:hidden" />
        <h1 className="text-base font-semibold text-foreground sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* 👈 ويدجت البومودورو العالمي يظهر هنا في كل التطبيق */}
        <PomodoroWidget />

        <Link
          href={`/dashboard/demo/${PLEURESIE_DEMO_SLUG}`}
          className="hidden items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50/70 px-3.5 py-1.5 text-xs font-bold text-blue-700 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-100/80 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-950/50 sm:flex"
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
          <DropdownMenuTrigger className="rounded-full transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950">
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