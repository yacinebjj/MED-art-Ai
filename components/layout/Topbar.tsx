"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Settings, LogOut, PlayCircle, CreditCard, Crown, Cpu } from "lucide-react";
import { AnimatedBrandMark } from "./AnimatedBrandMark";
import { PomodoroChip, PomodoroPill } from "./PomodoroPill";
import { THEME_MODE_ICONS, THEME_MODE_LABELS, ThemeModeSwitcher, useThemeMode, type ThemeMode } from "./cockpit/ThemeModeSwitcher";
import { UnifiedLanguageSwitch } from "./cockpit/UnifiedLanguageSwitch";
import { NotificationCenter } from "./cockpit/NotificationCenter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { TourReplayButton } from "@/components/onboarding/TourReplayButton";
import { useCockpitStore } from "@/store/useCockpitStore";
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

// The study chrono: one glass pill (components/layout/PomodoroPill.tsx), folded into
// a "Chrono" chip while hidden. Phones keep the idle chrono in Réviser → Pomodoro;
// it shows here only while running, compact (time + Play/Pause), so the page title
// stays readable.
function PomodoroWidget() {
  const { seconds, isActive, isVisible, toggleActive, toggleVisible, resetTimer } = usePomodoro();

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!isVisible ? (
        <motion.div
          key="collapsed"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.15 }}
          className="flex max-sm:hidden"
        >
          <PomodoroChip onShow={toggleVisible} />
        </motion.div>
      ) : (
        <motion.div
          key="expanded"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.15 }}
          className={cn("flex", !isActive && "max-sm:hidden")}
        >
          <PomodoroPill
            seconds={seconds}
            isActive={isActive}
            onToggle={toggleActive}
            onReset={resetTimer}
            onHide={toggleVisible}
            compactOnPhones
            labels={{ start: "Démarrer le chrono", pause: "Mettre en pause le chrono", reset: "Réinitialiser le chrono", hide: "Masquer le chrono" }}
          />
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
        "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-[filter] duration-200 hover:brightness-105 xl:inline-flex",
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
        // Glass chrome pages scroll under; height from --topbar-height (app/globals.css).
        "glass-chrome z-30 flex h-[var(--topbar-height)] shrink-0 items-center justify-between gap-3 pl-3 pr-2",
        // Phones: a full-width bar flush with the top edge — hairline at the bottom
        // only, the status-bar inset inside it. From sm: the floating pill.
        "rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)] sm:rounded-2xl sm:border sm:px-5 sm:pt-0 sm:shadow-glass sm:dark:shadow-glass-dark",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3 lg:w-48 lg:shrink-0 xl:w-56">
        <AnimatedBrandMark size="sm" className="lg:hidden" />
        <div className="flex min-w-0 items-center gap-1">
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
          <TourReplayButton className="h-8 w-8" />
        </div>
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
        {/* Below lg the bottom nav's Menu sheet carries language, appearance and
            the account — the bar keeps only notifications. */}
        <UnifiedLanguageSwitch className="hidden lg:flex" />
        <ThemeModeSwitcher className="hidden lg:flex" />
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-0.5 hidden rounded-full lg:block transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
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
                <DropdownMenuItem key={mode} onSelect={(event) => themeMode.select(mode, event.currentTarget as Element | null)} className="sm:hidden">
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
