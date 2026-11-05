"use client";

import { forwardRef, memo } from "react";
import { motion } from "framer-motion";
import { Folder, LayoutGrid, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileWorkspaceTab = "sources" | "chat" | "studio";

// "Chat" carries `Sparkles` — the same glyph the app's primary nav
// (components/layout/Sidebar.tsx, MobileBottomNav.tsx) already uses for
// "MedArt Assistant" — so this tab reads as the same assistant identity
// everywhere it appears instead of a one-off `MessageCircle`. "Studio" takes
// `LayoutGrid` (its own grid-of-study-modes identity, see StudioPanel.tsx) so
// the two tabs stay visually distinct rather than both claiming Sparkles.
const TABS: { id: MobileWorkspaceTab; label: string; icon: typeof Folder }[] = [
  { id: "sources", label: "Sources", icon: Folder },
  { id: "chat", label: "Chat", icon: Sparkles },
  { id: "studio", label: "Studio", icon: LayoutGrid },
];

interface MobileWorkspaceTabBarProps {
  active: MobileWorkspaceTab;
  onChange: (tab: MobileWorkspaceTab) => void;
  /** Slid down out of view: the student is reading down the chat, or typing. */
  hidden?: boolean;
}

/**
 * The phone workspace's bottom tab bar (app/dashboard/module/[id]/page.tsx).
 *
 * A glass sheet flush with the screen's bottom edge, laid OVER the pane
 * (absolute, inside the mobile column) rather than below it: the Co-pilot's
 * canvas runs on underneath and shows through the blur, and when the bar
 * slides away (`hidden`, a transform only) the space it leaves is really
 * the chat's. The page reserves the bar's measured height for the other
 * panes, and lifts the chat's composer by it while it is shown.
 *
 * Wrapped in React.memo — the caller passes a useCallback-stabilized
 * `onChange`. The active pill slides between tabs with the same layoutId
 * animation as components/layout/MobileBottomNav.tsx, in the same
 * primary-600/300 active colour.
 */
export const MobileWorkspaceTabBar = memo(
  forwardRef<HTMLElement, MobileWorkspaceTabBarProps>(function MobileWorkspaceTabBar({ active, onChange, hidden = false }, ref) {
    return (
      <nav
        ref={ref}
        aria-hidden={hidden || undefined}
        className={cn(
          "glass-chrome absolute inset-x-0 bottom-0 z-30 flex items-stretch justify-around gap-1 border-x-0 border-b-0 px-1 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-1",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          hidden ? "pointer-events-none translate-y-full" : "translate-y-0"
        )}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              aria-pressed={isActive}
              tabIndex={hidden ? -1 : undefined}
              data-tour={`ws-tab-${tab.id}`}
              className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl py-1.5 text-xs font-medium"
            >
              {isActive && (
                <motion.span
                  layoutId="workspace-tab-active-pill"
                  className="absolute inset-1 rounded-2xl bg-primary-500/15 dark:bg-primary-400/15"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon
                className={cn("relative z-10 h-5 w-5", isActive ? "fill-primary-100 text-primary-600 dark:fill-primary-950 dark:text-primary-300" : "text-muted-foreground")}
                strokeWidth={isActive ? 2.25 : 2}
              />
              <span className={cn("relative z-10", isActive ? "font-semibold text-primary-600 dark:text-primary-300" : "text-muted-foreground")}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    );
  })
);
