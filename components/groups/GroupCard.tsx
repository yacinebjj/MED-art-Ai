"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock, Copy, MessageCircle, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { PendingRequestsPanel } from "./PendingRequestsPanel";
import type { MyChatGroup } from "@/types/group-chat";

interface GroupCardProps {
  group: MyChatGroup;
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
    <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-bold text-foreground">
            {group.name}
            {group.isAdmin && (
              <span title="Tu es administrateur">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
              </span>
            )}
          </p>
          {group.isAdmin && (
            <button
              type="button"
              onClick={copyJoinCode}
              className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Code : <span className="font-mono font-semibold tracking-wider">{group.joinCode}</span>
              <Copy className="h-3 w-3" />
            </button>
          )}
        </div>

        {group.myStatus === "accepted" ? (
          <Link
            href={`/dashboard/groups/${group.id}`}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Ouvrir
          </Link>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            En attente
          </span>
        )}
      </div>

      {group.isAdmin && (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setRequestsOpen((o) => !o)}
            className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Demandes en attente
              {pendingCount > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">{pendingCount}</span>
              )}
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", requestsOpen && "rotate-180")} />
          </button>
          {requestsOpen && <PendingRequestsPanel groupId={group.id} onCountChange={setPendingCount} />}
        </div>
      )}
    </div>
  );
}
