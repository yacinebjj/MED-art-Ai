"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Crown, GraduationCap, Loader2, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/Avatar";
import { BottomSheetHandle, useBottomSheetMotion } from "@/components/ui/BottomSheet";
import { useLanguage } from "@/providers/LanguageProvider";
import { tGroups } from "@/lib/translations/groups";
import type { ChatMember } from "@/types/group-chat";

interface MemberDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Real presence — see ChatRoom.tsx's own comment on why this is never fabricated. */
  onlineUserIds: Set<string>;
  adminId: string | null;
  /** Lifted up to ChatRoom (fetched once via GET /api/groups/[id]/members) instead of this drawer fetching its own copy — the same roster now also drives each MessageBubble's academic-year badge, so one fetch serves both instead of two independent calls for the same data. Null while that fetch is still in flight. */
  members: ChatMember[] | null;
}

function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

/**
 * Member roster — desktop: slide-in panel docked to the right edge.
 * Mobile: bottom sheet, matching this app's other mobile drawer patterns
 * (e.g. ChatRoom's own fixed-inset mobile takeover).
 */
export function MemberDrawer({ isOpen, onClose, onlineUserIds, adminId, members }: MemberDrawerProps) {
  const { language } = useLanguage();
  const { sheetProps, startDrag } = useBottomSheetMotion(onClose);

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
            {...sheetProps}
            // Bespoke zinc/cyan "command center" palette — matching
            // ChatRoom/MessageBubble's own hardcoded tokens rather than the
            // app-wide `glass-card`/shadcn --foreground tokens (this drawer's
            // only consumer IS the chat room, so it can share its exact
            // language without creating an inconsistency anywhere else).
            className="fixed inset-x-0 bottom-0 z-[61] max-h-[75dvh] rounded-t-3xl border-t border-zinc-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-950 dark:shadow-black/40 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:bottom-auto sm:h-full sm:w-80 sm:max-h-none sm:rounded-l-2xl sm:rounded-t-none sm:border-l sm:border-t-0 sm:pb-4"
          >
            <BottomSheetHandle onPointerDown={startDrag} className="-mx-4 -mt-4" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-zinc-900 dark:text-white">
                {tGroups("membersDrawerTitle", language)}
                {members && <span className="text-xs font-medium tabular-nums text-zinc-500 dark:text-zinc-400">({members.length})</span>}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={tGroups("closeMembersAriaLabel", language)}
                className="touch-target relative rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-90 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!members ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tGroups("loadingMembers", language)}
              </div>
            ) : (
              <ul className="max-h-[calc(75dvh-6rem-env(safe-area-inset-bottom))] space-y-1.5 overflow-y-auto overscroll-contain sm:max-h-[calc(100%-3rem)]">
                {members.map((member) => {
                  const isOnline = onlineUserIds.has(member.userId);
                  const isMemberAdmin = member.userId === adminId;
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-white/5"
                    >
                      <div className="relative shrink-0">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs font-bold">{initial(member.displayName)}</AvatarFallback>
                        </Avatar>
                        {/* Real presence dot — grey (not "offline"-labeled red) when
                            not currently connected, since "offline" for a student
                            just means their tab is closed, not an alarming state. */}
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950 ${isOnline ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"}`}
                          aria-hidden
                        />
                      </div>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-white">
                          {member.displayName ?? tGroups("unnamedMember", language)}
                        </span>
                        {member.academicYearName && (
                          <span className="flex items-center gap-1 truncate text-[11px] text-cyan-700 dark:text-cyan-400">
                            <GraduationCap className="h-3 w-3 shrink-0" />
                            {member.academicYearName}
                          </span>
                        )}
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
