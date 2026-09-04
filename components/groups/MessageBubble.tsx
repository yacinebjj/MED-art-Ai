"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Check, Clock, Copy, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { AudioPlayer } from "./AudioPlayer";
import { ChatImage } from "./ChatImage";
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
export function MessageBubble({ message, isMine, isFirstInGroup, theme, onRetry }: MessageBubbleProps) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [hovered, setHovered] = useState(false);

  function copyText() {
    if (!message.contentText) return;
    navigator.clipboard.writeText(message.contentText).then(() => toast({ variant: "success", title: "Message copié." }));
  }

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
          {/* Hover-revealed quick action — a real, working "copy" utility rather than a decorative placeholder. */}
          {message.type === "text" && (
            <button
              type="button"
              onClick={copyText}
              className={cn(
                "order-first rounded-full p-1.5 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
                isMine && "order-last",
                hovered ? "opacity-100" : "pointer-events-none opacity-0"
              )}
              aria-label="Copier le message"
              title="Copier"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}

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
