"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, Check, Clock, Copy, GraduationCap, Pin, PinOff, RotateCcw, ShieldCheck, SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/providers/AuthProvider";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImage } from "./ChatImage";
import { QUICK_REACTIONS } from "@/lib/group-chat-reactions";
import type { ChatTheme } from "@/lib/chat-themes";
import type { ChatMessage } from "@/types/group-chat";

export type MessageStatus = "sending" | "sent" | "failed";

export interface LocalChatMessage extends ChatMessage {
  status: MessageStatus;
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

interface MessageBubbleProps {
  message: LocalChatMessage;
  isMine: boolean;
  /** Only used to decide whether to show the sender's name above the bubble — avatars themselves render on every row, per the adopted design. */
  isFirstInGroup: boolean;
  theme: ChatTheme;
  onRetry: (message: LocalChatMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  isPinned: boolean;
  onTogglePin: (messageId: string | null) => void;
  /** message.userId === the group's real admin_id — the ONLY role this app actually has (see supabase/schema.sql's chat_groups.admin_id). No "Tuteur"/moderator badge here: there's no such role in the data model, and inventing one would be exactly the kind of fake UI signal this file already avoids for read receipts. */
  isSenderAdmin: boolean;
  /** Real curriculum year (profiles.academic_year_id -> curriculum_academic_years.name), resolved by ChatRoom from GET /api/groups/[id]/members. Null when the sender hasn't set one. Never a "Professeur" badge — that role doesn't exist in this schema. */
  senderAcademicYear: string | null;
  isSaved: boolean;
  onToggleSave: (message: LocalChatMessage) => void;
}

function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

/**
 * Avatar-per-row bubble layout (adapted from a supplied HTML mockup):
 * a colored initial-letter avatar next to every message, neutral bubble
 * for others, themed bubble for mine, shadow + rounded-2xl throughout.
 * No "Seen" read-receipt — deliberately omitted, this app has no per-
 * recipient read tracking, and fabricating one would be a fake UI signal
 * (the single check below is real: it only ever means "saved server-side",
 * never "read by anyone").
 *
 * Every color here is a light/`dark:` PAIR, not a hardcoded always-dark
 * token — this bubble now follows the app's own light/dark toggle (see
 * ChatRoom.tsx, which no longer forces a literal `dark` class on this
 * subtree). `theme.bubble` (the user's chosen accent, see
 * lib/chat-themes.ts) still only ever colors MY OWN bubble; the
 * border/shadow/radius "premium glass" treatment around it is shared by
 * every theme, with the exact spec'd cyan glow reserved for the default
 * "neon" theme so a Midnight Rose/iMessage chooser doesn't get a
 * mismatched cyan shadow under a rose/blue gradient.
 */
export function MessageBubble({
  message,
  isMine,
  isFirstInGroup,
  theme,
  onRetry,
  onReact,
  isPinned,
  onTogglePin,
  isSenderAdmin,
  senderAcademicYear,
  isSaved,
  onToggleSave,
}: MessageBubbleProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [hovered, setHovered] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const isNeonTheme = theme.id === "neon";

  function copyText() {
    if (!message.contentText) return;
    navigator.clipboard.writeText(message.contentText).then(() => toast({ variant: "success", title: "Message copié." }));
  }

  function handlePickReaction(emoji: string) {
    onReact(message.id, emoji);
    setReactionPickerOpen(false);
  }

  const reactionEntries = Object.entries(message.reactions).filter(([, userIds]) => userIds.length > 0);

  return (
    <motion.div
      id={`chat-message-${message.id}`}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.008 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={cn("flex items-end gap-2", isMine && "flex-row-reverse")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-md ring-2 ring-white transition-transform duration-300 dark:ring-zinc-950",
          isMine ? cn(theme.bubble) : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        )}
      >
        {initial(message.senderName)}
      </div>

      <div className={cn("flex max-w-[85%] flex-col sm:max-w-[70%]", isMine && "items-end")}>
        {!isMine && isFirstInGroup && (
          <div className="mb-1 flex flex-wrap items-center gap-1.5 px-1">
            <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{message.senderName ?? "Étudiant(e)"}</p>
            {isSenderAdmin && (
              <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/40 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
                <ShieldCheck className="h-2.5 w-2.5" />
                Admin
              </span>
            )}
            {senderAcademicYear && (
              <span className="inline-flex max-w-[10rem] items-center gap-0.5 truncate rounded-full border border-cyan-400/40 bg-cyan-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300">
                <GraduationCap className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{senderAcademicYear}</span>
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          {/* Hover-revealed quick actions — reaction picker and pin toggle
              are real, working utilities (see ChatRoom.tsx's handleReact/
              handleTogglePin), same "no decorative placeholder" standard
              this file's own comment already holds the copy button to. */}
          <div
            className={cn(
              "relative order-first flex items-center gap-0.5 transition-opacity",
              isMine && "order-last",
              hovered || reactionPickerOpen ? "opacity-100" : "pointer-events-none opacity-0"
            )}
          >
            <button
              type="button"
              onClick={() => setReactionPickerOpen((v) => !v)}
              className="rounded-full p-1.5 text-zinc-400 transition-all duration-150 hover:scale-110 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-cyan-300"
              aria-label="Réagir"
              title="Réagir"
            >
              <SmilePlus className="h-3.5 w-3.5" />
            </button>

            <AnimatePresence>
              {reactionPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setReactionPickerOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.96 }}
                    transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                    className={cn(
                      "absolute bottom-full z-50 mb-1.5 flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white p-1 shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-900/95 dark:shadow-black/40",
                      isMine ? "right-0" : "left-0"
                    )}
                  >
                    {QUICK_REACTIONS.map((reaction) => (
                      <button
                        key={reaction.emoji}
                        type="button"
                        onClick={() => handlePickReaction(reaction.emoji)}
                        className="rounded-full p-1.5 text-base leading-none transition-transform duration-150 hover:scale-125"
                        aria-label={reaction.label}
                        title={reaction.label}
                      >
                        {reaction.emoji}
                      </button>
                    ))}
                  </motion.div>
                </>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={() => onTogglePin(isPinned ? null : message.id)}
              className={cn(
                "rounded-full p-1.5 transition-all duration-150 hover:scale-110 hover:bg-zinc-100 dark:hover:bg-white/10",
                isPinned ? "text-amber-600 dark:text-amber-400" : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-white"
              )}
              aria-label={isPinned ? "Désépingler" : "Épingler"}
              title={isPinned ? "Désépingler" : "Épingler"}
            >
              {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>

            {message.type === "text" && (
              <button
                type="button"
                onClick={copyText}
                className="rounded-full p-1.5 text-zinc-400 transition-all duration-150 hover:scale-110 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="Copier le message"
                title="Copier"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Real per-device bookmark toggle (hooks/useSavedMessages.ts,
                localStorage — never synced/fabricated as a shared signal). */}
            <button
              type="button"
              onClick={() => onToggleSave(message)}
              className={cn(
                "rounded-full p-1.5 transition-all duration-150 hover:scale-110 hover:bg-zinc-100 dark:hover:bg-white/10",
                isSaved ? "text-amber-500 dark:text-amber-400" : "text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-white"
              )}
              aria-label={isSaved ? "Retirer des messages enregistrés" : "Enregistrer le message"}
              title={isSaved ? "Retirer des messages enregistrés" : "Enregistrer"}
            >
              <Bookmark className={cn("h-3.5 w-3.5", isSaved && "fill-current")} />
            </button>
          </div>

          <div
            className={cn(
              "relative text-[16px] leading-relaxed transition-all duration-200",
              message.type === "text" && "whitespace-pre-wrap",
              // Image messages show the picture alone — no bubble background/padding/rounded-xl,
              // since ChatImage already carries its own rounded corners + lightbox chrome and a
              // wrapper bubble around it would double up as a visible frame.
              message.type !== "image" &&
                cn(
                  "rounded-2xl px-4 py-2",
                  isMine
                    ? cn(
                        "rounded-tr-sm border shadow-lg",
                        theme.bubble,
                        isNeonTheme ? "border-cyan-400/20 shadow-cyan-950/10 dark:shadow-cyan-950/50" : "border-white/20 shadow-black/10 dark:border-white/5 dark:shadow-black/40"
                      )
                    : "rounded-tl-sm border border-zinc-200 bg-zinc-100 text-zinc-900 shadow-sm dark:border-white/5 dark:bg-zinc-900/70 dark:text-zinc-100 dark:shadow-md dark:backdrop-blur-md",
                  message.status === "failed" && "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/80 dark:text-rose-100"
                ),
              message.status === "sending" && "opacity-70"
            )}
          >
            {message.type === "text" && message.contentText}
            {message.type === "image" && message.mediaUrl && <ChatImage src={message.mediaUrl} />}
            {message.type === "video" && message.mediaUrl && <video src={message.mediaUrl} controls className="max-h-64 max-w-full rounded-lg" />}
            {message.type === "audio" && message.mediaUrl && (
              // theme.isLight ("classic") now tracks bg-card/text-card-
              // foreground (see lib/chat-themes.ts) instead of a hardcoded
              // white — in dark mode that bubble is dark too, so it needs
              // AudioPlayer's "on a colored bubble" (light) controls just
              // like every other theme does, not the dark controls a truly
              // light bubble would need.
              <AudioPlayer src={message.mediaUrl} onColoredBubble={isMine && (!theme.isLight || isDark)} />
            )}
          </div>
        </div>

        {reactionEntries.length > 0 && (
          <div className={cn("mt-1 flex flex-wrap gap-1", isMine && "justify-end")}>
            {reactionEntries.map(([emoji, userIds]) => {
              const mine = !!user && userIds.includes(user.id);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(message.id, emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold transition-transform duration-150 hover:scale-105",
                    mine
                      ? "border-cyan-400/40 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-500/10 dark:text-cyan-300 dark:shadow-[0_0_8px_-2px_rgba(34,211,238,0.6)]"
                      : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-white/5 dark:bg-zinc-800/80 dark:text-zinc-300"
                  )}
                >
                  <span>{emoji}</span>
                  <span>{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-1 flex items-center gap-1 px-1 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
          {TIME_FORMAT.format(new Date(message.createdAt))}
          {isMine && <StatusIcon status={message.status} />}
        </p>

        {message.status === "failed" && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
          >
            <RotateCcw className="h-3 w-3" />
            Réessayer
          </button>
        )}
      </div>
    </motion.div>
  );
}

/** Real states only: "sending" (optimistic, not yet confirmed by the server) and "sent" (saved server-side). No "read" tick — this app has no per-recipient read tracking (see this file's own header comment), so a double-check would be a fabricated signal, not a design omission. */
function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "sending") return <Clock className="h-2.5 w-2.5 animate-pulse" />;
  if (status === "sent") return <Check className="h-2.5 w-2.5" />;
  return null;
}
