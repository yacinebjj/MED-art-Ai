"use client";

import { memo } from "react";
import { Folder, MessageCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type MobileWorkspaceTab = "sources" | "chat" | "studio";

const TABS: { id: MobileWorkspaceTab; label: string; icon: typeof Folder }[] = [
  { id: "sources", label: "Sources", icon: Folder },
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "studio", label: "Studio", icon: Sparkles },
];

interface MobileWorkspaceTabBarProps {
  active: MobileWorkspaceTab;
  onChange: (tab: MobileWorkspaceTab) => void;
}

/**
 * NotebookLM-mobile-style bottom tab bar — a normal `shrink-0` flex sibling
 * at the bottom of the mobile column (see app/dashboard/module/[id]/page.tsx),
 * not `position: fixed`. The page root is already a `h-screen overflow-hidden`
 * flex column (same pattern WorkspaceTopbar uses at the top), so a flex
 * sibling is always visible without any of `fixed`'s usual mobile quirks
 * (browser address-bar resize jitter, needing a safe-area padding hack on the
 * scrollable content below it) while looking and behaving identically to a
 * "fixed" nav from the user's perspective.
 *
 * Wrapped in React.memo — cheap to render on its own (3 buttons), but the
 * caller passes a useCallback-stabilized `onChange`, so this also skips
 * re-rendering on unrelated parent state changes for free.
 */
export const MobileWorkspaceTabBar = memo(function MobileWorkspaceTabBar({ active, onChange }: MobileWorkspaceTabBarProps) {
  return (
    <nav className="flex shrink-0 items-stretch border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-neutral-800 dark:bg-neutral-900">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={isActive}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors",
              isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-400 dark:text-neutral-500"
            )}
          >
            <Icon className={cn("h-5 w-5", isActive && "fill-blue-100 dark:fill-blue-950")} strokeWidth={isActive ? 2.25 : 2} />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
});
