"use client";

import { ChevronRight } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { openInstallGuide, useInstallState } from "@/lib/pwa-install";
import { tInstall } from "@/lib/translations/install";
import { useLanguage } from "@/providers/LanguageProvider";

/**
 * « Installer l'application » — where a student finds the install guide
 * (components/pwa/InstallAppModal.tsx): a row at the foot of the desktop
 * sidebar, a button in the top bar below lg (where there is no sidebar), and
 * an item in both account menus (the top bar's, the phone dock's Profil
 * sheet). The glyph glows softly and breathes until the guide has been opened
 * once on this device. Nothing shows once MedArt runs as the installed app:
 * the `install-entry` class hides them from the first paint there
 * (app/globals.css), and the store hides them after an install.
 */

/** A phone with an arrow coming down into it: install the app. */
export function InstallGlyph({ className, strokeWidth = 2 }: { className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="5.5" y="2" width="13" height="20" rx="3" />
      <path d="M12 6.5v7.5" />
      <path d="m8.75 11 3.25 3.25L15.25 11" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

/** The soft light behind the glyph — a radial gradient (no blur filter: iOS boxes those); it breathes until the guide has been seen. */
function Glow({ breathing, className }: { breathing: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.55),transparent_68%)]",
        breathing ? "install-breathe" : "opacity-60",
        className
      )}
    />
  );
}

function useEntry() {
  const { language } = useLanguage();
  const { installed, guideSeen } = useInstallState();
  return { label: tInstall("entry", language), hidden: installed, breathing: !guideSeen };
}

/** The desktop sidebar's row (components/layout/Sidebar.tsx), above the quota gauge; icon only, with a tooltip, in rail mode. */
export function InstallAppSidebarEntry({ collapsed }: { collapsed: boolean }) {
  const { label, hidden, breathing } = useEntry();
  if (hidden) return null;
  const control = (
    <button
      type="button"
      onClick={() => openInstallGuide()}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "install-entry group relative flex w-full items-center gap-3 rounded-xl py-[clamp(0.125rem,0.55vh,0.375rem)] text-[13px] font-medium text-muted-foreground transition-all duration-200 hover:bg-white/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] dark:hover:bg-white/5",
        collapsed ? "justify-center px-0" : "px-2.5"
      )}
    >
      <span className="relative z-10 flex h-[clamp(1.5rem,3.6vh,2rem)] w-[clamp(1.5rem,3.6vh,2rem)] shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_12px_-4px_rgba(14,165,233,0.7)] ring-1 ring-inset ring-white/25 transition-transform duration-200 ease-out group-hover:scale-[1.06] motion-reduce:transform-none">
        <Glow breathing={breathing} className="-inset-2" />
        <InstallGlyph className="relative h-[17px] w-[17px]" strokeWidth={2.2} />
      </span>
      {!collapsed && <span className="relative z-10 truncate">{label}</span>}
    </button>
  );
  if (!collapsed) return control;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The top bar's button (components/layout/Topbar.tsx), below lg. */
export function InstallAppHeaderButton({ className }: { className?: string }) {
  const { label, hidden, breathing } = useEntry();
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        openInstallGuide();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "install-entry touch-target relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-sky-600 transition-colors duration-200 hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 dark:text-sky-300",
        className
      )}
    >
      <Glow breathing={breathing} className="inset-0.5" />
      <InstallGlyph className="relative h-5 w-5" strokeWidth={2.1} />
    </button>
  );
}

/** An item of the top bar's account menu; it takes that menu's row and icon classes. */
export function InstallAppMenuItem({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  const { label, hidden, breathing } = useEntry();
  if (hidden) return null;
  return (
    // Opened on the next frame: the menu hands the focus back before the guide takes it.
    <DropdownMenuItem onSelect={() => window.requestAnimationFrame(() => openInstallGuide())} className={cn("install-entry", className)}>
      <span className={cn(iconClassName, "relative text-sky-600 dark:text-sky-300")}>
        <Glow breathing={breathing} className="-inset-1" />
        <InstallGlyph className="relative h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenuItem>
  );
}

/** A row of the phone dock's Profil sheet (components/layout/MobileBottomNav.tsx), in the style of its other rows. */
export function InstallAppSheetEntry({ onOpen }: { onOpen?: () => void }) {
  const { label, hidden, breathing } = useEntry();
  if (hidden) return null;
  return (
    <button
      type="button"
      onClick={() => {
        haptic();
        onOpen?.();
        openInstallGuide();
      }}
      className="install-entry press-feedback flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-left text-[15px] font-semibold text-foreground active:bg-accent"
    >
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-sm">
        <Glow breathing={breathing} className="-inset-2" />
        <InstallGlyph className="relative h-5 w-5" />
      </span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
