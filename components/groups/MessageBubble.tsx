"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, Copy, Pin, PinOff, RotateCcw, SmilePlus } from "lucide-react";
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
}

function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

/**
 * Avatar-per-row bubble layout (adapted from a supplied HTML mockup):
 * a colored initial-letter avatar next to every message, white/card bubble
 * for others, themed bubble for mine, shadow + rounded-xl throughout.
 * No "Seen" read-receipt — deliberately omitted, this app has no per-
 * recipient read tracking, and fabricating one would be a fake UI signal.
 */
export function MessageBubble({ message, isMine, isFirstInGroup, theme, onRetry, onReact, isPinned, onTogglePin }: MessageBubbleProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [hovered, setHovered] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);

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
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className={cn("flex items-end gap-2", isMine && "flex-row-reverse")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm ring-2 ring-background transition-transform duration-300",
          isMine ? cn(theme.bubble) : "bg-muted text-foreground"
        )}
      >
        {initial(message.senderName)}
      </div>

      <div className={cn("flex max-w-[85%] flex-col sm:max-w-[70%]", isMine && "items-end")}>
        {!isMine && isFirstInGroup && <p className="mb-1 px-1 text-xs font-semibold text-muted-foreground">{message.senderName ?? "Étudiant(e)"}</p>}

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
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                    transition={{ duration: 0.12 }}
                    className={cn(
                      "absolute bottom-full z-50 mb-1.5 flex items-center gap-0.5 rounded-full border border-border/60 bg-card/95 p-1 shadow-glass backdrop-blur-xl dark:shadow-glass-dark",
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
                "rounded-full p-1.5 transition-colors hover:bg-accent",
                isPinned ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground hover:text-foreground"
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
                className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Copier le message"
                title="Copier"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div
            className={cn(
              "relative text-sm transition-all duration-300",
              message.type === "text" && "whitespace-pre-wrap",
              // Image messages show the picture alone — no bubble background/padding/rounded-xl,
              // since ChatImage already carries its own rounded corners + lightbox chrome and a
              // wrapper bubble around it would double up as a visible frame.
              message.type !== "image" &&
                cn(
                  "rounded-xl px-4 py-2 shadow-card hover:shadow-glow",
                  isMine ? cn(theme.bubble) : "bg-card text-foreground",
                  message.status === "failed" && "bg-destructive/90 text-destructive-foreground"
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
                    "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold shadow-sm transition-transform duration-150 hover:scale-105",
                    mine
                      ? "border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                      : "border-border/60 bg-card text-muted-foreground"
                  )}
                >
                  <span>{emoji}</span>
                  <span>{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-1 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          {TIME_FORMAT.format(new Date(message.createdAt))}
          {isMine && <StatusIcon status={message.status} />}
        </p>

        {message.status === "failed" && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="mt-1 flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/20"
          >
            <RotateCcw className="h-3 w-3" />
            Réessayer
          </button>
        )}
      </div>
    </motion.div>
  );
}

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "sending") return <Clock className="h-2.5 w-2.5 animate-pulse" />;
  if (status === "sent") return <Check className="h-2.5 w-2.5" />;
  return null;
}
