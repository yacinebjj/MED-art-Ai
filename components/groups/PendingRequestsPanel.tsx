"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import type { ChatMember } from "@/types/group-chat";

interface PendingRequestsPanelProps {
  groupId: string;
  onCountChange: (count: number) => void;
}

/** Admin-only "Demandes en attente" — accept/reject each pending join request. */
export function PendingRequestsPanel({ groupId, onCountChange }: PendingRequestsPanelProps) {
  const { toast } = useToast();
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/groups/${groupId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          const pending = (data.members as ChatMember[]).filter((m) => m.status === "pending");
          setMembers(pending);
          onCountChange(pending.length);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function respond(member: ChatMember, accept: boolean) {
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/groups/${groupId}/members/${member.id}`, {
        method: accept ? "PATCH" : "DELETE",
        headers: accept ? { "Content-Type": "application/json" } : undefined,
        body: accept ? JSON.stringify({ status: "accepted" }) : undefined,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Une erreur est survenue.");

      setMembers((prev) => {
        const next = (prev ?? []).filter((m) => m.id !== member.id);
        onCountChange(next.length);
        return next;
      });
      toast({ variant: "success", title: accept ? `${member.displayName ?? "Étudiant(e)"} a rejoint le groupe.` : "Demande refusée." });
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "Une erreur est survenue." });
    } finally {
      setBusyId(null);
    }
  }

  if (!members) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des demandes...
      </div>
    );
  }

  if (members.length === 0) {
    return <p className="animate-in fade-in py-4 text-sm text-muted-foreground duration-300">Aucune demande en attente.</p>;
  }

  return (
    <ul className="space-y-2 py-2">
      <AnimatePresence initial={false}>
        {members.map((member) => (
          <motion.li
            key={member.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2 backdrop-blur-sm"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="text-xs font-bold">
                  {(member.displayName ?? "?").trim().charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-medium text-foreground">{member.displayName ?? "Étudiant(e)"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => respond(member, true)}
                disabled={busyId === member.id}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-all duration-200 hover:scale-105 hover:bg-primary/20 active:scale-90 disabled:opacity-50"
                aria-label="Accepter"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => respond(member, false)}
                disabled={busyId === member.id}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive transition-all duration-200 hover:scale-105 hover:bg-destructive/20 active:scale-90 disabled:opacity-50"
                aria-label="Refuser"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
