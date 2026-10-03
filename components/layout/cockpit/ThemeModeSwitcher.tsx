"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, Moon, MoonStar, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/providers/LanguageProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";

/**
 * "Mode Nuit Médical" = the dark theme PLUS a warm, low-blue filter over the
 * whole app (see NightModeOverlay) — for late-night revision after a shift.
 * Kept as a separate per-device flag next to next-themes' own light/dark
 * value, so it needs no third theme in the global stylesheet.
 */
const NIGHT_STORAGE_KEY = "medart-night-mode";
const NIGHT_EVENT = "medart-night-mode-change";

function readNight(): boolean {
  try {
    return localStorage.getItem(NIGHT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNight(value: boolean) {
  try {
    localStorage.setItem(NIGHT_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked: the change still applies to open views via the event.
  }
  window.dispatchEvent(new Event(NIGHT_EVENT));
}

function subscribeNight(callback: () => void) {
  window.addEventListener(NIGHT_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(NIGHT_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useNightMode(): boolean {
  return useSyncExternalStore(subscribeNight, readNight, () => false);
}

/** Warm amber veil + slight dimming, only while night mode is on. Pointer-events none: purely visual. */
export function NightModeOverlay() {
  const night = useNightMode();
  const { resolvedTheme } = useTheme();
  if (!night || resolvedTheme !== "dark") return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[2000] bg-[rgb(255_140_40/0.08)]"
      style={{ boxShadow: "inset 0 0 0 100vmax rgb(0 0 0 / 0.12)" }}
    />
  );
}

export type ThemeMode = "light" | "dark" | "night";
type Mode = ThemeMode;

export const THEME_MODE_LABELS: Record<Mode, { fr: string; en: string }> = {
  light: { fr: "Clair", en: "Light" },
  dark: { fr: "Sombre", en: "Dark" },
  night: { fr: "Nuit médicale", en: "Medical night" },
};

export const THEME_MODE_ICONS = { light: Sun, dark: Moon, night: MoonStar } as const;
const ICONS = THEME_MODE_ICONS;
const LABELS = THEME_MODE_LABELS;

/** Current light / dark / medical-night mode and a setter (next-themes + the night flag). */
export function useThemeMode(): { current: Mode; select: (mode: Mode) => void } {
  const { resolvedTheme, setTheme } = useTheme();
  const night = useNightMode();
  const current: Mode = resolvedTheme === "dark" ? (night ? "night" : "dark") : "light";
  function select(mode: Mode) {
    setTheme(mode === "light" ? "light" : "dark");
    writeNight(mode === "night");
  }
  return { current, select };
}

export function ThemeModeSwitcher({ className }: { className?: string }) {
  const { language } = useLanguage();
  const { current, select } = useThemeMode();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className={cn("h-9 w-9 rounded-xl bg-muted", className)} />;

  const Icon = ICONS[current];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={language === "fr" ? "Changer de thème" : "Change theme"}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          current === "night" && "text-amber-500",
          className
        )}
      >
        <Icon className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{language === "fr" ? "Apparence" : "Appearance"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(LABELS) as Mode[]).map((mode) => {
          const ItemIcon = ICONS[mode];
          return (
            <DropdownMenuItem key={mode} onSelect={() => select(mode)}>
              <ItemIcon className={cn("h-4 w-4", mode === "night" && "text-amber-500")} />
              <span className="flex-1">{LABELS[mode][language]}</span>
              {current === mode && <Check className="h-3.5 w-3.5 text-primary-500" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
