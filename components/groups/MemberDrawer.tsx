"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crown, Loader2, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import { useLanguage } from "@/providers/LanguageProvider";
import { tGroups } from "@/lib/translations/groups";
import type { ChatMember } from "@/types/group-chat";

interface MemberDrawerProps {
  groupId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Real presence — see ChatRoom.tsx's own comment on why this is never fabricated. */
  onlineUserIds: Set<string>;
  adminId: string | null;
}

function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

/**
 * Member roster — desktop: slide-in panel docked to the right edge.
 * Mobile: bottom sheet, matching this app's other mobile drawer patterns
 * (e.g. ChatRoom's own fixed-inset mobile takeover). Fetches
 * GET /api/groups/[id]/members (already existed, unchanged) only while
 * open, not eagerly on every ChatRoom mount — this is a secondary panel a
 * student may never open in a given session.
 */
export function MemberDrawer({ groupId, isOpen, onClose, onlineUserIds, adminId }: MemberDrawerProps) {
  const { language } = useLanguage();
  const [members, setMembers] = useState<ChatMember[] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setMembers(null);

    fetch(`/api/groups/${groupId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        setMembers((data.members as ChatMember[]).filter((m) => m.status === "accepted"));
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, groupId]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="glass-card fixed inset-x-0 bottom-0 z-[61] max-h-[75vh] rounded-t-3xl border-t border-white/20 p-4 shadow-glass dark:shadow-glass-dark sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:bottom-auto sm:h-full sm:w-80 sm:max-h-none sm:rounded-l-3xl sm:rounded-t-none sm:border-l sm:border-t-0"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
                {tGroups("membersDrawerTitle", language)}
                {members && <span className="text-xs font-medium text-muted-foreground">({members.length})</span>}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={tGroups("closeMembersAriaLabel", language)}
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-90"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!members ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tGroups("loadingMembers", language)}
              </div>
            ) : (
              <ul className="max-h-[calc(75vh-4rem)] space-y-1.5 overflow-y-auto sm:max-h-[calc(100%-3rem)]">
                {members.map((member) => {
                  const isOnline = onlineUserIds.has(member.userId);
                  const isMemberAdmin = member.userId === adminId;
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 rounded-2xl px-2.5 py-2 transition-colors hover:bg-accent/60"
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs font-bold">{initial(member.displayName)}</AvatarFallback>
                        </Avatar>
                        {/* Real presence dot — grey (not "offline"-labeled red) when
                            not currently connected, since "offline" for a student
                            just means their tab is closed, not an alarming state. */}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${isOnline ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                          aria-hidden
                        />
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {member.displayName ?? tGroups("unnamedMember", language)}
                      </span>
                      {isMemberAdmin && (
                        <span
                          className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          title={tGroups("adminBadge", language)}
                        >
                          <Crown className="h-2.5 w-2.5" />
                          {tGroups("adminBadge", language)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
