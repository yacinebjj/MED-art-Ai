"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Clock, Copy, MessageCircle, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import { PendingRequestsPanel } from "./PendingRequestsPanel";
import type { MyChatGroup } from "@/types/group-chat";

interface GroupCardProps {
  group: MyChatGroup;
}

// A few gradient pairs (same palette family as the app's other icon badges)
// cycled by a cheap string hash — purely cosmetic, gives each group card a
// distinct identity color instead of every avatar looking identical.
const AVATAR_GRADIENTS = [
  "from-teal-500 to-cyan-500",
  "from-violet-500 to-fuchsia-500",
  "from-blue-500 to-indigo-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-emerald-500 to-teal-600",
];

function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function GroupCard({ group }: GroupCardProps) {
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
          <Avatar className="h-10 w-10 shrink-0 sm:h-11 sm:w-11">
            <AvatarFallback className={cn("bg-gradient-to-br text-sm font-bold", gradientFor(group.id))}>
              {group.name.trim().charAt(0).toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-sm font-bold text-foreground">{group.name}</p>
              {group.isAdmin && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  <ShieldCheck className="h-3 w-3" />
                  Admin
                </span>
              )}
            </div>
            {group.isAdmin && (
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

        {group.myStatus === "accepted" ? (
          <Link
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

      {group.isAdmin && (
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
