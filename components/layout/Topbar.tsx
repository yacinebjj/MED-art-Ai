"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Settings, LogOut, PlayCircle, Play, Pause, RotateCcw, EyeOff, Timer, Search, CreditCard, Crown, Cpu } from "lucide-react";
import { AnimatedBrandMark } from "./AnimatedBrandMark";
import { THEME_MODE_ICONS, THEME_MODE_LABELS, ThemeModeSwitcher, useThemeMode, type ThemeMode } from "./cockpit/ThemeModeSwitcher";
import { UnifiedLanguageSwitch } from "./cockpit/UnifiedLanguageSwitch";
import { NotificationCenter } from "./cockpit/NotificationCenter";
import { Kbd } from "@/components/course/workspace/os/Kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useCockpitStore } from "@/store/useCockpitStore";
import { useCockpitUi } from "@/store/useCockpitUi";
import { tCockpit } from "@/lib/translations/cockpit";
import { FLASHCARD_ENGINE_LABEL } from "@/lib/dashboard/engine";
import { PLEURESIE_DEMO_SLUG } from "@/lib/constants";
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

/** Plan badge: the real effective plan (lib/pricing.ts labels), trial countdown while trialing. */
function PlanBadge() {
  const { trial, isSubscribed } = useAuth();
  const { language } = useLanguage();
  const plan = useCockpitStore((state) => state.overview?.plan ?? null);

  if (!isSubscribed && trial?.active && trial.daysRemaining > 0) {
    return (
      <Badge variant="warning" className="hidden xl:inline-flex">
        {tCockpit("trialBadge", language).replace("{n}", String(trial.daysRemaining))}
      </Badge>
    );
  }
  if (!plan) return null;
  return (
    <Link
      href="/dashboard/billing"
      className={cn(
        "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-all duration-200 hover:-translate-y-0.5 xl:inline-flex",
        plan.paidActive
          ? "border-amber-300/70 bg-gradient-to-r from-amber-100 to-orange-100 text-amber-800 dark:border-amber-700/50 dark:from-amber-950/40 dark:to-orange-950/40 dark:text-amber-300"
          : "border-border/60 bg-background/60 text-muted-foreground"
      )}
    >
      {plan.paidActive ? <Crown className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
      {plan.paidActive ? `${plan.label} ⚡` : plan.label}
    </Link>
  );
}

/**
 * Shows the AI engine and whether this device can reach it right now
 * (navigator.onLine + the last dashboard sync). Deliberately says nothing it
 * can't know: it is a connectivity indicator, not a health check of the model.
 */
function EngineBadge() {
  const { language } = useLanguage();
  const status = useCockpitStore((state) => state.status);
  const offline = status === "offline";
  const degraded = status === "error";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground 2xl:inline-flex">
          <Cpu className="h-3 w-3 text-primary-500" />
          {FLASHCARD_ENGINE_LABEL}
          <span className="relative flex h-2 w-2">
            {!offline && !degraded && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", offline ? "bg-slate-400" : degraded ? "bg-amber-400" : "bg-emerald-500")} />
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{offline ? tCockpit("engineOffline", language) : degraded ? tCockpit("engineDegraded", language) : tCockpit("engineOnline", language)}</TooltipContent>
    </Tooltip>
  );
}

/** Spotlight trigger: a full search field on desktop, an icon on phones. */
function SpotlightTrigger() {
  const { language } = useLanguage();
  const setSpotlightOpen = useCockpitUi((state) => state.setSpotlightOpen);
  return (
    <>
      <button
        type="button"
        onClick={() => setSpotlightOpen(true)}
        className="group hidden h-10 w-full max-w-md items-center gap-2.5 rounded-xl border border-border/60 bg-background/50 px-3 text-left text-sm text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.4)] transition-all duration-200 hover:border-primary-300/70 hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none dark:hover:border-primary-800/70 md:flex"
      >
        <Search className="h-4 w-4 shrink-0 text-primary-500 transition-transform duration-200 group-hover:scale-110" />
        <span className="min-w-0 flex-1 truncate">{tCockpit("spotlightTrigger", language)}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setSpotlightOpen(true)}
        aria-label={tCockpit("spotlightTrigger", language)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
    </>
  );
}

export function Topbar({ title, className }: { title: string; className?: string }) {
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { language } = useLanguage();
  const themeMode = useThemeMode();

  const initial = (profile?.fullName ?? "").trim().charAt(0).toUpperCase() || "E";

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      className={cn(
        "glass-panel z-20 flex h-14 shrink-0 items-center justify-between gap-3 rounded-2xl px-3 shadow-glass dark:shadow-glass-dark sm:h-16 sm:px-5",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3 lg:w-48 lg:shrink-0 xl:w-56">
        <AnimatedBrandMark size="sm" className="lg:hidden" />
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
      </div>

      <div className="hidden min-w-0 flex-1 justify-center md:flex">
        <SpotlightTrigger />
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <EngineBadge />
        <PlanBadge />
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
        <div className="md:hidden">
          <SpotlightTrigger />
        </div>
        <UnifiedLanguageSwitch className="hidden sm:flex" />
        <ThemeModeSwitcher className="hidden sm:flex" />
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-0.5 rounded-full transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
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
            {/* Phones: language + appearance live here (no room for them in the bar). */}
            <div className="px-2 py-1.5 sm:hidden">
              <UnifiedLanguageSwitch />
            </div>
            {(Object.keys(THEME_MODE_LABELS) as ThemeMode[]).map((mode) => {
              const ModeIcon = THEME_MODE_ICONS[mode];
              return (
                <DropdownMenuItem key={mode} onSelect={() => themeMode.select(mode)} className="sm:hidden">
                  <ModeIcon className={cn("h-4 w-4", mode === "night" && "text-amber-500")} />
                  <span className="flex-1">{THEME_MODE_LABELS[mode][language]}</span>
                  {themeMode.current === mode && <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator className="sm:hidden" />
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
