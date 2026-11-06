"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Link2 } from "lucide-react";
import { AnimatedBrandMark } from "@/components/layout/AnimatedBrandMark";
import { TopbarCluster } from "@/components/layout/Topbar";
import { NightModeOverlay } from "@/components/layout/cockpit/ThemeModeSwitcher";
import { useToast } from "@/components/ui/Toast";
import { useLanguage } from "@/providers/LanguageProvider";
import { tWorkspaceTopbar } from "@/lib/translations/workspaceTopbar";
import { cn } from "@/lib/utils";

interface WorkspaceTopbarProps {
  title: string;
  /** Page-specific controls (e.g. the "?" guide button), shown right after the title — where the main top bar keeps its own. */
  actions?: ReactNode;
}

/** Same footprint as the bar's other small controls (TourReplayButton). */
const BAR_ICON_BUTTON_CLASSES =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Top bar of the full-screen module pages (Examen de module, Résumé de
 * module), which live outside the dashboard shell. It is the main app bar
 * (components/layout/Topbar.tsx): the same glass pill — flush with the top on
 * phones, floating from sm — the same height, padding and title type, and
 * the same right-hand cluster (chrono, language, appearance, notifications,
 * account). A back arrow leads the left side, since these pages have no
 * sidebar.
 */
export function WorkspaceTopbar({ title, actions }: WorkspaceTopbarProps) {
  const { toast } = useToast();
  const { language } = useLanguage();

  /** Copies the current page URL so a student can share/bookmark this exact module page. */
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
    <>
      <header
        className={cn(
          // Main top bar recipe; in this page's flow (not floating over a
          // scrolling shell), so its offsets are margins, lined up with the panels below.
          "glass-chrome relative z-30 flex h-[var(--topbar-height)] shrink-0 items-center justify-between gap-3 pl-3 pr-2",
          "rounded-none border-x-0 border-t-0 pt-[env(safe-area-inset-top)] sm:mx-3 sm:mt-3 sm:rounded-2xl sm:border sm:px-5 sm:pt-0 sm:shadow-glass sm:dark:shadow-glass-dark md:mx-4 md:mt-4"
        )}
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link
            href="/dashboard"
            aria-label={tWorkspaceTopbar("backToDashboard", language)}
            title={tWorkspaceTopbar("backToDashboard", language)}
            className={BAR_ICON_BUTTON_CLASSES}
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
          <AnimatedBrandMark size="sm" className="hidden sm:flex" />
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
              {title || tWorkspaceTopbar("courseFallbackTitle", language)}
            </h1>
            {actions}
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label={tWorkspaceTopbar("copyLinkAriaLabel", language)}
              title={tWorkspaceTopbar("copyLinkAriaLabel", language)}
              className={cn(BAR_ICON_BUTTON_CLASSES, "h-8 w-8")}
            >
              <Link2 className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        <TopbarCluster standalone />
      </header>
      {/* « Nuit médicale » from this bar's appearance menu needs its veil here
          too (the dashboard shell mounts its own). Outside the header: the
          header's backdrop-filter would make it the veil's containing block. */}
      <NightModeOverlay />
    </>
  );
}
