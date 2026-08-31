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

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
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

/** Short, glanceable "il y a…" label so a long list stays scannable without opening each conversation. Deliberately coarse (minutes/hours/days) — this is a scan aid, not a precise clock. */
function formatRelativeTime(timestamp: number): string {
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} h`;
  const diffD = Math.round(diffH / 24);
  return `${diffD} j`;
}

function ConversationRow({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: {
  conversation: StoredConversation;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  // Deleting a whole conversation (and its history) is high-regret and, on
  // this row, a single click away — so a click first ARMS the button
  // (distinct destructive styling + tooltip) and only a second click within
  // the window actually deletes. Purely local UI state; the delete itself
  // still goes through the same onDelete the parent already provides.
  const [confirming, setConfirming] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  function handleDeleteClick(e: MouseEvent) {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      confirmTimeoutRef.current = setTimeout(() => setConfirming(false), 2800);
      return;
    }
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirming(false);
    onDelete(conversation.id);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors duration-200",
        isActive
          ? "bg-emerald-50 text-emerald-800 shadow-[inset_2px_0_0_0_theme(colors.emerald.500)] dark:bg-emerald-500/10 dark:text-emerald-300"
          : "text-foreground/80 hover:bg-accent hover:text-foreground"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-current={isActive ? "true" : undefined}
        className="flex flex-1 items-center gap-2 overflow-hidden text-left"
      >
        <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", isActive ? "opacity-90" : "opacity-50")} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate" title={conversation.title}>
            {conversation.title}
          </span>
          <span className="text-[10.5px] leading-tight text-muted-foreground/80">{formatRelativeTime(conversation.updatedAt)}</span>
        </span>
      </button>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleDeleteClick}
            onBlur={() => setConfirming(false)}
            aria-label={confirming ? "Confirmer la suppression" : "Supprimer la conversation"}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md opacity-100 transition-all duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
              confirming
                ? "scale-105 bg-destructive/15 text-destructive opacity-100 ring-1 ring-destructive/40"
                : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{confirming ? "Cliquer à nouveau pour confirmer" : "Supprimer"}</TooltipContent>
      </Tooltip>
    </motion.div>
  );
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, StoredConversation[]>();
    for (const conversation of filtered) {
      const group = getDateGroup(conversation.updatedAt);
      const bucket = groups.get(group);
      if (bucket) bucket.push(conversation);
      else groups.set(group, [conversation]);
    }
    return groups;
  }, [filtered]);

  const hasAnyConversations = conversations.length > 0;
  const hasNoResults = hasAnyConversations && filtered.length === 0;

  return (
    <>
      {/* Mobile-only backdrop: below lg the sidebar is a fixed overlay drawer, not an
          in-flow column, so a tap outside it needs an explicit dismiss surface. Hidden
          entirely at lg+ (lg:hidden) where the sidebar goes back to being a static
          column and never overlays the chat. */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="conversation-sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onToggle}
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      <div
        className={cn(
          "glass-panel fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] shrink-0 flex-col overflow-hidden border-r border-l-0 border-y-0 shadow-glass transition-transform duration-300 dark:shadow-glass-dark lg:static lg:z-auto lg:max-w-none lg:translate-x-0 lg:transition-[width]",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isOpen ? "lg:w-72" : "lg:w-0 lg:border-r-0"
        )}
      >
      {/* Fixed-width inner content so the outer container's width transition clips it smoothly instead of the content reflowing/wrapping mid-animation. */}
      <div className="flex h-full w-72 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
          <button
            type="button"
            onClick={onNewConversation}
            className="flex flex-1 items-center gap-2 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-6px_rgba(16,185,129,0.55)] active:scale-[0.98] active:translate-y-0"
          >
            <Plus className="h-4 w-4" />
            Nouvelle conversation
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggle}
                aria-label="Réduire l'historique"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <PanelLeftClose className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Réduire l&apos;historique</TooltipContent>
          </Tooltip>
        </div>

        {hasAnyConversations && (
          <div className="relative mt-3 shrink-0 px-3">
            <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher une conversation…"
              className="w-full rounded-lg border border-border bg-background/50 py-1.5 pl-8 pr-7 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/25 sm:text-xs"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Effacer la recherche"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!hasAnyConversations ? (
            <div className="flex flex-col items-center gap-2.5 px-3 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <MessagesSquare className="h-5 w-5" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Aucune conversation pour l&apos;instant.
                <br />
                Posez votre première question !
              </p>
            </div>
          ) : hasNoResults ? (
            <div className="flex flex-col items-center gap-2.5 px-3 py-10 text-center">
              <Search className="h-5 w-5 text-muted-foreground/60" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Aucun résultat pour «&nbsp;{query}&nbsp;»
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-xs font-medium text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
              >
                Réinitialiser la recherche
              </button>
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const items = grouped.get(group);
              if (!items || items.length === 0) return null;
              return (
                <div key={group} className="mb-3">
                  <p className="sticky top-0 z-10 bg-inherit px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 backdrop-blur-sm">
                    {group}
                  </p>
                  <AnimatePresence initial={false}>
                    {items.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        isActive={conversation.id === activeId}
                        onSelect={onSelect}
                        onDelete={onDelete}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>
      </div>
    </>
  );
}

/** Rendered instead of the panel itself when collapsed — a slim, always-visible reopen affordance so closing the history rail is never a dead end. */
export function ConversationSidebarCollapsedToggle({ onToggle }: { onToggle: () => void }) {
  return (
    <AnimatePresence>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            type="button"
            onClick={onToggle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            aria-label="Afficher l'historique des conversations"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          </motion.button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Afficher l&apos;historique</TooltipContent>
      </Tooltip>
    </AnimatePresence>
  );
}
