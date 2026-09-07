"use client";

import { memo } from "react";
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
}

/**
 * NotebookLM-mobile-style bottom tab bar — a normal `shrink-0` flex sibling
 * at the bottom of the mobile column (see app/dashboard/module/[id]/page.tsx),
 * not `position: fixed`. The page root is already a `h-dvh overflow-hidden`
 * flex column (same pattern WorkspaceTopbar uses at the top), so a flex
 * sibling is always visible without any of `fixed`'s usual mobile quirks
 * (browser address-bar resize jitter, needing a safe-area padding hack on the
 * scrollable content below it) while looking and behaving identically to a
 * "fixed" nav from the user's perspective.
 *
 * Wrapped in React.memo — cheap to render on its own (3 buttons), but the
 * caller passes a useCallback-stabilized `onChange`, so this also skips
 * re-rendering on unrelated parent state changes for free.
 *
 * Visual language matches components/layout/MobileBottomNav.tsx exactly (the
 * app-shell's own bottom tab bar) — same glass chrome, same
 * layoutId-animated active pill sliding between tabs, same primary-600/300
 * active color — so a student never has to relearn "which bar am I in":
 * Sources/Chat/Studio here reads as one more instance of the same bottom-nav
 * pattern used everywhere else in the app, not a bespoke one-off.
 */
export const MobileWorkspaceTabBar = memo(function MobileWorkspaceTabBar({ active, onChange }: MobileWorkspaceTabBarProps) {
  return (
    <nav className="glass-panel relative z-10 flex shrink-0 items-stretch justify-around gap-1 rounded-t-3xl px-1 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-1 shadow-glass dark:shadow-glass-dark">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={isActive}
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
});
