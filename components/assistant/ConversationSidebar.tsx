"use client";

/**
 * Gemini-style conversation history rail for MedArt Assistant — deliberately
 * a SEPARATE component from components/layout/Sidebar.tsx (the shared
 * dashboard nav), not an addition to it: that component renders on
 * Settings/Billing/the dashboard list too, none of which have any notion
 * of "conversations." Bolting chat-history state onto a component every
 * other page also renders would leak assistant-only concerns into pages
 * that have nothing to do with it.
 *
 * Collapsible independently from the main dashboard sidebar (see
 * providers/SidebarProvider.tsx for that one) — the two toggle separately
 * on purpose, matching how Gemini's own left rail collapses independently
 * of any OS/browser chrome around it.
 */

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StoredConversation } from "@/hooks/useAssistantConversations";

const GROUP_ORDER = ["Aujourd'hui", "Hier", "7 derniers jours", "Plus ancien"] as const;

function getDateGroup(timestamp: number): (typeof GROUP_ORDER)[number] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (timestamp >= startOfToday) return "Aujourd'hui";
  if (timestamp >= startOfToday - oneDayMs) return "Hier";
  if (timestamp >= startOfToday - 7 * oneDayMs) return "7 derniers jours";
  return "Plus ancien";
}

export function ConversationSidebar({
  isOpen,
  onToggle,
  conversations,
  activeId,
  onSelect,
  onNewConversation,
  onDelete,
}: {
  isOpen: boolean;
  onToggle: () => void;
  conversations: StoredConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onDelete: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, StoredConversation[]>();
    for (const conversation of conversations) {
      const group = getDateGroup(conversation.updatedAt);
      const bucket = groups.get(group);
      if (bucket) bucket.push(conversation);
      else groups.set(group, [conversation]);
    }
    return groups;
  }, [conversations]);

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-gray-200 bg-gray-50/60 transition-[width] duration-300 dark:border-gray-800 dark:bg-gray-900/40",
        isOpen ? "w-72" : "w-0 border-r-0"
      )}
    >
      {/* Fixed-width inner content so the outer container's width transition clips it smoothly instead of the content reflowing/wrapping mid-animation. */}
      <div className="flex h-full w-72 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
          <button
            type="button"
            onClick={onNewConversation}
            className="flex flex-1 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Nouvelle conversation
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label="Réduire l'historique"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <PanelLeftClose className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-gray-400 dark:text-gray-500">Aucune conversation pour l&apos;instant.</p>
          ) : (
            GROUP_ORDER.map((group) => {
              const items = grouped.get(group);
              if (!items || items.length === 0) return null;
              return (
                <div key={group} className="mb-3">
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{group}</p>
                  {items.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={cn(
                        "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors",
                        conversation.id === activeId
                          ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      )}
                    >
                      <button type="button" onClick={() => onSelect(conversation.id)} className="flex flex-1 items-center gap-2 overflow-hidden text-left">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{conversation.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(conversation.id);
                        }}
                        aria-label="Supprimer la conversation"
                        className="shrink-0 rounded-md p-1 text-gray-400 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100 dark:text-gray-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Rendered instead of the panel itself when collapsed — a slim, always-visible reopen affordance so closing the history rail is never a dead end. */
export function ConversationSidebarCollapsedToggle({ onToggle }: { onToggle: () => void }) {
  return (
    <AnimatePresence>
      <motion.button
        type="button"
        onClick={onToggle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        aria-label="Afficher l'historique des conversations"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        <PanelLeftOpen className="h-[18px] w-[18px]" />
      </motion.button>
    </AnimatePresence>
  );
}
