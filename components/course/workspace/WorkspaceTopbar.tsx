"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowLeft, Copy, Moon, Settings, Sun } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tWorkspaceTopbar } from "@/lib/translations/workspaceTopbar";

interface WorkspaceTopbarProps {
  title: string;
}

/** NotebookLM-style topbar: logo + course title on the left, action cluster on the right. */
export function WorkspaceTopbar({ title }: WorkspaceTopbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();
  const { language } = useLanguage();
  const isDark = resolvedTheme === "dark";
  // next-themes only knows the real theme after mount (it reads
  // localStorage client-side) — rendering Sun/Moon from `isDark` before that
  // resolves means the server's default-theme guess can differ from the
  // client's first render, which React flags as a hydration mismatch. Same
  // guard as components/layout/ThemeToggle.tsx.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** Was a dead button (no onClick at all) — found during a static review pass. Copies the current workspace URL so a student can share/bookmark this exact course. */
  function handleCopyLink() {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => toast({ variant: "success", title: tWorkspaceTopbar("linkCopied", language) }))
      .catch(() =>
        toast({
          variant: "error",
          title: tWorkspaceTopbar("copyFailedTitle", language),
          description: tWorkspaceTopbar("copyFailedDescription", language),
        })
      );
  }

  return (
    <header className="glass-panel relative z-20 flex h-14 shrink-0 items-center justify-between rounded-b-3xl px-2 py-1 shadow-glass dark:shadow-glass-dark sm:h-16 sm:px-6 sm:py-2">
      <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
        {/* Explicit back control — distinct from the logo below, which reads
            as branding rather than navigation to a hurried student. Neither
            module/[id]/page.tsx nor demo/[slug]/page.tsx render any other
            "back to dashboard" affordance in their normal (loaded) state, so
            without this the only way out was the browser's own back button. */}
        <Link
          href="/dashboard"
          aria-label={tWorkspaceTopbar("backToDashboard", language)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-medium text-muted-foreground transition-all duration-300 hover:-translate-x-0.5 hover:bg-accent hover:text-foreground sm:px-2 sm:py-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{tWorkspaceTopbar("back", language)}</span>
        </Link>
        <span className="hidden h-6 w-px shrink-0 bg-border sm:block" />
        <Link href="/dashboard" className="hidden shrink-0 transition-transform duration-300 hover:scale-105 sm:flex">
          <Logo size="sm" />
        </Link>
        <span className="hidden h-6 w-px shrink-0 bg-border sm:block" />
        <h1 className="truncate text-sm font-semibold text-foreground sm:text-lg">
          {title || tWorkspaceTopbar("courseFallbackTitle", language)}
        </h1>
      </div>

      <div className="flex items-center gap-0.5 sm:gap-2">
        <Button variant="ghost" size="icon" aria-label={tWorkspaceTopbar("copyLinkAriaLabel", language)} onClick={handleCopyLink}>
          <Copy className="h-4 w-4 text-muted-foreground" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={
            isDark
              ? tWorkspaceTopbar("switchToLightMode", language)
              : tWorkspaceTopbar("switchToDarkMode", language)
          }
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {!mounted ? (
            <Moon className="h-4 w-4 text-muted-foreground" />
          ) : isDark ? (
            <Sun className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Moon className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={tWorkspaceTopbar("settings", language)}>
              <Settings className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{tWorkspaceTopbar("settings", language)}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Inertes de manière confirmée (aucune destination Aide/Feedback/Langue
                n'existe ailleurs dans le projet) — masqués plutôt que câblés
                sur un faux lien. Gardés dans le JSX (juste `hidden`) pour
                réactivation triviale une fois les vraies pages prêtes. */}
            <DropdownMenuItem className="hidden">Aide</DropdownMenuItem>
            <DropdownMenuItem className="hidden">Envoyer un avis</DropdownMenuItem>
            <DropdownMenuItem className="hidden">Langue de sortie</DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Same real destination as the main app's account dropdown
                (components/layout/Topbar.tsx) — reuses the existing
                /dashboard/settings page instead of leaving this leaf item inert. */}
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings">{tWorkspaceTopbar("accountSettings", language)}</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Was a hardcoded "ET" initial — not derived from the signed-in
            student's actual name (unlike components/layout/Topbar.tsx's real
            Avatar), just a static placeholder. Swapped for the official
            MedArt mark (same <Logo size="sm" /> instance already rendered on
            the left side of this header, for a guaranteed-consistent look)
            so this corner reads as the brand, not a fake/stale identity badge. */}
        <Logo size="sm" className="shrink-0" />
      </div>
    </header>
  );
}
