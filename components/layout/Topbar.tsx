"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Settings, LogOut, PlayCircle, Play, Pause, RotateCcw, EyeOff, Timer } from "lucide-react";
import { AnimatedBrandMark } from "./AnimatedBrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar";
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
import { useLanguage } from "@/providers/LanguageProvider";
import { t } from "@/lib/translations";
import { PLEURESIE_DEMO_SLUG } from "@/lib/constants";

// Focus ring shared by every icon-only control in this widget — keyboard
// users get the same visible affordance mouse users get from hover.
const ICON_BUTTON_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// 👈 ويدجت البومودورو مدمج مباشرة هنا بدون الحاجة لملف خارجي
function PomodoroWidget() {
  const { seconds, isActive, isVisible, toggleActive, toggleVisible, resetTimer } = usePomodoro();

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const formattedTime = `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!isVisible ? (
        <motion.button
          key="collapsed"
          type="button"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.15 }}
          onClick={toggleVisible}
          title="Afficher le chronomètre"
          aria-label="Afficher le chronomètre d'étude"
          className={cn(
            "flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent/70 hover:text-foreground",
            ICON_BUTTON_FOCUS
          )}
        >
          <Timer className="h-4 w-4 text-primary-500" />
          <span className="hidden sm:inline">Chrono</span>
        </motion.button>
      ) : (
        <motion.div
          key="expanded"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.15 }}
          className="glass-card flex items-center gap-1.5 rounded-2xl px-2.5 py-1 shadow-soft sm:gap-2"
        >
          {/* Pulses only while the timer is actually running — a
              permanently-pulsing icon reads as ambient urgency, which is
              exactly the "extra pressure" feeling a study-wellbeing tool
              should never add. Paused/idle stays calm and static. */}
          <Timer className={cn("h-4 w-4 shrink-0 text-primary-500", isActive && "animate-pulse")} />
          <span className="font-mono text-xs sm:text-sm font-bold text-foreground">{formattedTime}</span>

          <button
            type="button"
            onClick={toggleActive}
            title={isActive ? "Pause" : "Démarrer"}
            aria-label={isActive ? "Mettre en pause le chrono" : "Démarrer le chrono"}
            className={cn(
              "rounded-lg p-1 text-white transition-colors duration-200",
              isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700",
              ICON_BUTTON_FOCUS
            )}
          >
            {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>

          <button
            type="button"
            onClick={resetTimer}
            title="Réinitialiser"
            aria-label="Réinitialiser le chrono"
            className={cn(
              "rounded-lg p-1 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground",
              ICON_BUTTON_FOCUS
            )}
          >
            <RotateCcw className="h-3 w-3" />
          </button>

          <button
            type="button"
            onClick={toggleVisible}
            title="Masquer le chrono"
            aria-label="Masquer le chrono"
            className={cn(
              "rounded-lg border-l border-border p-1 pl-1 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground",
              ICON_BUTTON_FOCUS
            )}
          >
            <EyeOff className="h-3 w-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Topbar({ title }: { title: string }) {
  const router = useRouter();
  const { profile, signOut, trial, isSubscribed } = useAuth();
  const { language } = useLanguage();

  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";
  const showTrialBadge = !isSubscribed && trial?.active && trial.daysRemaining > 0;

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="glass-panel z-20 flex h-14 shrink-0 items-center justify-between rounded-2xl px-3 shadow-glass dark:shadow-glass-dark sm:h-16 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <AnimatedBrandMark size="sm" className="lg:hidden" />
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* 👈 ويدجت البومودورو العالمي يظهر هنا في كل التطبيق */}
        <PomodoroWidget />

        {/* TEMPORAIRE — masqué pour l'enregistrement de la vidéo promo (demande
            explicite du client). Retirer ce commentaire et restaurer le
            <Link> ci-dessous juste après le tournage — rien d'autre n'a
            changé, ce lien fonctionne normalement dès qu'il est restauré. */}
        {/* <Link
          href={`/dashboard/demo/${PLEURESIE_DEMO_SLUG}`}
          className="hidden items-center gap-2 rounded-full border border-cyan-200/70 bg-cyan-50/70 px-3.5 py-1.5 text-xs font-bold text-cyan-700 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-cyan-100/80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300 dark:hover:bg-cyan-950/50 sm:flex"
        >
          <PlayCircle className="h-3.5 w-3.5" />
          Voir la Démo
        </Link> */}
        {showTrialBadge && (
          <Badge variant="warning" className="hidden sm:inline-flex">
            Essai gratuit : {trial.daysRemaining} jour{trial.daysRemaining > 1 ? "s" : ""} restant
            {trial.daysRemaining > 1 ? "s" : ""}
          </Badge>
        )}
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <Avatar>
              {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
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
    </header>
  );
}