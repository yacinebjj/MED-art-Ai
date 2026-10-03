"use client";

import { motion } from "framer-motion";
import { BarChart3, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { pollVoteKey, type ChatPoll } from "@/lib/group-chat-envelope";
import type { MessageReactions } from "@/types/group-chat";

/**
 * Live poll: votes come from the message's reactions map ("poll:<optionId>"
 * keys), so every member sees results move in real time. Tap to vote; tap
 * again to withdraw; single-choice polls move the vote.
 */
export function PollCard({
  poll,
  reactions,
  currentUserId,
  onVote,
  onColoredBubble,
}: {
  poll: ChatPoll;
  reactions: MessageReactions;
  currentUserId: string | null;
  onVote: (optionId: string) => void;
  onColoredBubble: boolean;
}) {
  const voters = new Set<string>();
  const counts = poll.options.map((option) => {
    const ids = reactions[pollVoteKey(option.id)] ?? [];
    ids.forEach((id) => voters.add(id));
    return ids.length;
  });
  const totalVotes = counts.reduce((sum, n) => sum + n, 0);
  const maxCount = Math.max(0, ...counts);

  return (
    <div className="w-[min(18rem,70vw)] space-y-2">
      <div className="flex items-start gap-2">
        <BarChart3 className={cn("mt-0.5 h-4 w-4 shrink-0", onColoredBubble ? "text-white" : "text-cyan-600 dark:text-cyan-400")} />
        <p className="text-[15px] font-bold leading-snug">{poll.question}</p>
      </div>
      <p className={cn("text-[11px]", onColoredBubble ? "text-white/75" : "text-zinc-500 dark:text-zinc-400")}>
        {poll.multi ? "Plusieurs choix possibles" : "Un seul choix"} · {voters.size} votant{voters.size > 1 ? "s" : ""}
      </p>
      <div className="space-y-1.5">
        {poll.options.map((option, index) => {
          const count = counts[index];
          const mine = currentUserId !== null && (reactions[pollVoteKey(option.id)] ?? []).includes(currentUserId);
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const leading = count > 0 && count === maxCount;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onVote(option.id)}
              className={cn(
                "relative flex w-full items-center gap-2 overflow-hidden rounded-xl border px-3 py-2 text-left text-sm transition-all duration-150 active:scale-[0.98]",
                onColoredBubble
                  ? cn("border-white/25", mine ? "bg-white/25" : "bg-white/10 hover:bg-white/20")
                  : cn(
                      "border-zinc-200 dark:border-white/10",
                      mine ? "bg-cyan-50 dark:bg-cyan-500/10" : "bg-white hover:bg-zinc-50 dark:bg-zinc-900/60 dark:hover:bg-white/5"
                    )
              )}
            >
              <motion.span
                aria-hidden
                className={cn("absolute inset-y-0 left-0", onColoredBubble ? "bg-white/20" : leading ? "bg-cyan-500/20" : "bg-zinc-400/15")}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ type: "spring", stiffness: 220, damping: 30 }}
              />
              <span
                className={cn(
                  "relative flex h-4 w-4 shrink-0 items-center justify-center border",
                  poll.multi ? "rounded" : "rounded-full",
                  mine
                    ? onColoredBubble
                      ? "border-white bg-white text-cyan-700"
                      : "border-cyan-600 bg-cyan-600 text-white"
                    : onColoredBubble
                      ? "border-white/70"
                      : "border-zinc-400"
                )}
              >
                {mine && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="relative min-w-0 flex-1 truncate font-medium">{option.label}</span>
              <span className="relative shrink-0 text-xs font-bold tabular-nums">{totalVotes > 0 ? `${pct}%` : ""}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
