"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Clock, Copy, Loader2, MessageCircle, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { PendingRequestsPanel } from "./PendingRequestsPanel";
import { gradientFor } from "@/lib/group-avatar-gradient";
import type { MyChatGroup } from "@/types/group-chat";

interface GroupCardProps {
  group: MyChatGroup;
  /** Optimistic card shown the instant "Créer" is clicked, before the server confirms. */
  creating?: boolean;
}

export function GroupCard({ group, creating = false }: GroupCardProps) {
  const { toast } = useToast();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(group.pendingCount);

  function copyJoinCode() {
    navigator.clipboard.writeText(group.joinCode).then(() => {
      toast({ variant: "success", title: "Code d'invitation copié." });
    });
  }

  return (
    <div className="glass-card rounded-2xl p-4 shadow-glass transition-all duration-300 ease-out hover:-translate-y-0.5 dark:shadow-glass-dark sm:rounded-3xl sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <Avatar className="h-10 w-10 sm:h-11 sm:w-11">
              <AvatarFallback className={cn("bg-gradient-to-br text-sm font-bold", gradientFor(group.id))}>
                {group.name.trim().charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            {/* Telegram-style unread badge, overlapping the avatar's corner —
                only ever a real count from GET /api/groups (messages from
                OTHERS since my last_read_at), never shown for a pending
                membership since RLS blocks reading messages until accepted. */}
            {group.unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow-soft ring-2 ring-background">
                {group.unreadCount > 99 ? "99+" : group.unreadCount}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-sm font-bold text-foreground">{group.name}</p>
              {group.isAdmin && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <ShieldCheck className="h-3 w-3" />
                  Admin
                </span>
              )}
            </div>
            {group.lastMessage ? (
              <p className={cn("truncate text-xs", group.unreadCount > 0 ? "font-semibold text-foreground/80" : "text-muted-foreground")}>
                {group.lastMessage.preview}
              </p>
            ) : (
              <p className="truncate text-xs italic text-muted-foreground/70">Aucun message pour le moment</p>
            )}
            {group.isAdmin && !creating && (
              <button
                type="button"
                onClick={copyJoinCode}
                className="-ml-2 mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
              >
                Code : <span className="font-mono font-semibold tracking-wider">{group.joinCode}</span>
                <Copy className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {group.lastMessage && (
            <RelativeTime timestamp={group.lastMessage.createdAt} className="text-[10px] text-muted-foreground" />
          )}
          {creating ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Création…
            </span>
          ) : group.myStatus === "accepted" ? (
            <Link
              prefetch
              href={`/dashboard/groups/${group.id}`}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-soft transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-glow active:scale-95"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Ouvrir
            </Link>
          ) : (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3.5 py-2 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              En attente
            </span>
          )}
        </div>
      </div>

      {group.isAdmin && !creating && (
        <div className="mt-3 border-t border-border pt-1">
          <button
            type="button"
            onClick={() => setRequestsOpen((o) => !o)}
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Demandes en attente
              {pendingCount > 0 && (
                <span className="animate-in zoom-in-95 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground duration-200">
                  {pendingCount}
                </span>
              )}
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform duration-300", requestsOpen && "rotate-180")} />
          </button>
          <AnimatePresence initial={false}>
            {requestsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <PendingRequestsPanel groupId={group.id} onCountChange={setPendingCount} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
