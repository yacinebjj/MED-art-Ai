"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronRight,
  ClipboardCheck,
  CloudOff,
  Copy,
  Focus,
  Layers,
  LayoutPanelLeft,
  Loader2,
  Moon,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  Rows3,
  Rows4,
  Search,
  Settings,
  SquarePen,
  Sun,
  Timer,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/layout/Logo";
import { useToast } from "@/components/ui/Toast";
import { usePomodoro } from "@/providers/PomodoroProvider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Kbd } from "@/components/course/workspace/os/Kbd";
import type { WorkspaceDensity } from "@/hooks/useWorkspaceLayout";

export type WorkspaceSyncState = "synced" | "working" | "offline";

interface WorkspaceCommandBarProps {
  moduleTitle: string;
  moduleId: number;
  courseTitle: string | null;
  sourceCount: number;
  contextCount: number;
  /** Notes saved for this module (Mes notes) — null while unknown. */
  notesCount: number | null;
  syncState: WorkspaceSyncState;
  syncDetail: string;
  density: WorkspaceDensity;
  onDensityChange: (density: WorkspaceDensity) => void;
  zen: boolean;
  onToggleZen: () => void;
  onOpenPalette: () => void;
  onQuickNote: () => void;
  modKey: string;
}

function BarButton({
  label,
  keys,
  onClick,
  active,
  children,
  className,
}: {
  label: string;
  keys?: string[];
  onClick?: () => void;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 520, damping: 30 }}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
            active && "bg-primary-600 text-white shadow-glow hover:bg-primary-600 hover:text-white dark:bg-primary-500",
            className
          )}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {keys && (
          <span className="flex items-center gap-0.5">
            {keys.map((key) => (
              <Kbd key={key} tone="inverse">
                {key}
              </Kbd>
            ))}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Isolated so the per-second Pomodoro tick re-renders only this chip, never the whole bar. */
const WorkspacePomodoro = memo(function WorkspacePomodoro() {
  const { seconds, isActive, toggleActive, resetTimer } = usePomodoro();
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return (
    <div className="hidden h-8 items-center gap-0.5 rounded-xl border border-[color-mix(in_oklab,var(--border)_70%,transparent)] bg-[color-mix(in_oklab,var(--background)_50%,transparent)] pl-2 pr-0.5 md:flex">
      <Timer className={cn("h-3.5 w-3.5 text-primary-500", isActive && "animate-pulse")} />
      <span className="w-11 text-center font-mono text-xs font-bold tabular-nums text-foreground">
        {String(minutes).padStart(2, "0")}:{String(remaining).padStart(2, "0")}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={toggleActive}
            aria-label={isActive ? "Mettre en pause le chrono d'étude" : "Démarrer le chrono d'étude"}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-lg text-white transition-colors",
              isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"
            )}
          >
            {isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{isActive ? "Pause" : "Démarrer le chrono d'étude"} — partagé avec l&apos;Espace d&apos;étude</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={resetTimer}
            aria-label="Réinitialiser le chrono d'étude"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Réinitialiser le chrono</TooltipContent>
      </Tooltip>
    </div>
  );
});

/**
 * MedArt OS command bar for the module workspace: breadcrumbs, live sync
 * status, context/notes counters, the shared Pomodoro chrono, and every
 * workspace-level control (palette, quick note, density, Zen, theme) — each
 * with a tooltip naming its keyboard shortcut.
 */
export function WorkspaceCommandBar({
  moduleTitle,
  moduleId,
  courseTitle,
  sourceCount,
  contextCount,
  notesCount,
  syncState,
  syncDetail,
  density,
  onDensityChange,
  zen,
  onToggleZen,
  onOpenPalette,
  onQuickNote,
  modKey,
}: WorkspaceCommandBarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";

  function handleCopyLink() {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => toast({ variant: "success", title: "Lien du workspace copié" }))
      .catch(() => toast({ variant: "error", title: "Copie impossible", description: "Ton navigateur a bloqué l'accès au presse-papiers." }));
  }

  return (
    <header className="glass-panel relative z-20 flex h-14 shrink-0 items-center gap-2 rounded-b-3xl px-2 shadow-glass dark:shadow-glass-dark sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/dashboard"
              aria-label="Retour au tableau de bord"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:-translate-x-0.5 hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Retour au tableau de bord</TooltipContent>
        </Tooltip>
        <Link href="/dashboard" className="hidden shrink-0 transition-transform duration-300 hover:scale-105 lg:flex" aria-label="MedArt — accueil">
          <Logo size="sm" />
        </Link>
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1 text-sm">
          <Link href="/dashboard" className="hidden shrink-0 text-muted-foreground transition-colors hover:text-foreground md:inline">
            Modules
          </Link>
          <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--muted-foreground)_60%,transparent)] md:inline" />
          <span className={cn("truncate font-semibold text-foreground", courseTitle && "max-md:hidden")} title={moduleTitle}>
            {moduleTitle}
          </span>
          {courseTitle && (
            <>
              <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-[color-mix(in_oklab,var(--muted-foreground)_60%,transparent)] md:inline" />
              <span className="truncate bg-gradient-to-r from-primary-600 to-sky-600 bg-clip-text font-semibold text-transparent dark:from-primary-300 dark:to-sky-300" title={courseTitle}>
                {courseTitle}
              </span>
            </>
          )}
        </nav>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Ouvrir la palette de commandes"
        className="hidden h-9 w-full max-w-[17rem] shrink items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_60%,transparent)] px-3 text-sm text-muted-foreground shadow-soft transition-all duration-200 hover:border-primary-300 hover:text-foreground hover:shadow-glow dark:bg-white/[0.03] dark:hover:border-primary-700 md:flex"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-left">Outils, sources, actions…</span>
        <span className="flex items-center gap-0.5">
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="status"
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-xl px-2 text-[11px] font-semibold",
                syncState === "synced" && "text-emerald-700 dark:text-emerald-300",
                syncState === "working" && "text-primary-700 dark:text-primary-300",
                syncState === "offline" && "text-amber-700 dark:text-amber-300"
              )}
            >
              {syncState === "working" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : syncState === "offline" ? (
                <CloudOff className="h-3.5 w-3.5" />
              ) : (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              <span className="hidden xl:inline">{syncState === "synced" ? "Synchronisé" : syncState === "working" ? "En cours" : "Hors ligne"}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs whitespace-normal">{syncDetail}</TooltipContent>
        </Tooltip>

        <div className="hidden items-center gap-1 lg:flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex h-8 items-center gap-1 rounded-xl border border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-2 text-xs font-semibold text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                <span className="tabular-nums text-foreground">{contextCount}</span>/<span className="tabular-nums">{sourceCount}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>Sources en contexte du co-pilote / sources du module</TooltipContent>
          </Tooltip>
          {notesCount !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/dashboard/notes"
                  className="flex h-8 items-center gap-1 rounded-xl border border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary-300 hover:text-foreground"
                >
                  <NotebookPen className="h-3.5 w-3.5" />
                  <span className="tabular-nums text-foreground">{notesCount}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent>Notes de ce module — ouvrir Mes notes</TooltipContent>
            </Tooltip>
          )}
        </div>

        <WorkspacePomodoro />

        <BarButton label="Note rapide" keys={["⇧", "N"]} onClick={onQuickNote}>
          <SquarePen className="h-4 w-4" />
        </BarButton>

        <BarButton label="Palette de commandes" keys={[modKey, "K"]} onClick={onOpenPalette} className="md:hidden">
          <Search className="h-4 w-4" />
        </BarButton>

        <div className="hidden items-center rounded-xl border border-[color-mix(in_oklab,var(--border)_70%,transparent)] p-0.5 sm:flex" role="group" aria-label="Densité de l'interface">
          <BarButton label="Densité confortable" active={density === "comfortable"} onClick={() => onDensityChange("comfortable")} className="h-7 px-1.5">
            <Rows3 className="h-3.5 w-3.5" />
          </BarButton>
          <BarButton label="Densité compacte" active={density === "compact"} onClick={() => onDensityChange("compact")} className="h-7 px-1.5">
            <Rows4 className="h-3.5 w-3.5" />
          </BarButton>
        </div>

        <BarButton label={zen ? "Quitter le mode Zen" : "Mode Zen (focus sur le co-pilote)"} keys={[modKey, "/"]} active={zen} onClick={onToggleZen}>
          <Focus className="h-4 w-4" />
        </BarButton>

        <BarButton label={isDark ? "Passer en mode clair" : "Passer en mode sombre"} keys={[modKey, "⇧", "L"]} onClick={() => setTheme(isDark ? "light" : "dark")}>
          {!mounted ? <Moon className="h-4 w-4" /> : isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </BarButton>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Plus d'options"
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Plus d&apos;options</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Module</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/module/${moduleId}/exam`}>
                <ClipboardCheck className="h-4 w-4" />
                Examen de module (Semaine Bloquée)
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/workspace/module/${moduleId}`}>
                <Workflow className="h-4 w-4" />
                Synthèse du module
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/notes">
                <NotebookPen className="h-4 w-4" />
                Mes notes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleCopyLink}>
              <Copy className="h-4 w-4" />
              Copier le lien
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleZen}>
              <LayoutPanelLeft className="h-4 w-4" />
              {zen ? "Afficher tous les panneaux" : "Mode Zen"}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">
                <Settings className="h-4 w-4" />
                Paramètres du compte
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
