"use client";

import { useState } from "react";
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

type GroupPosition = "single" | "top" | "middle" | "bottom";

const MINE_RADIUS: Record<GroupPosition, string> = {
  single: "rounded-2xl rounded-br-md",
  top: "rounded-2xl rounded-br-md",
  middle: "rounded-2xl rounded-tr-md rounded-br-md",
  bottom: "rounded-2xl rounded-tr-md",
};

const OTHER_RADIUS: Record<GroupPosition, string> = {
  single: "rounded-2xl rounded-bl-md",
  top: "rounded-2xl rounded-bl-md",
  middle: "rounded-2xl rounded-tl-md rounded-bl-md",
  bottom: "rounded-2xl rounded-tl-md",
};

function groupPosition(isFirst: boolean, isLast: boolean): GroupPosition {
  if (isFirst && isLast) return "single";
  if (isFirst) return "top";
  if (isLast) return "bottom";
  return "middle";
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

interface MessageBubbleProps {
  message: LocalChatMessage;
  isMine: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  theme: ChatTheme;
  onRetry: (message: LocalChatMessage) => void;
}

export function MessageBubble({ message, isMine, isFirstInGroup, isLastInGroup, theme, onRetry }: MessageBubbleProps) {
  const { toast } = useToast();
  const [hovered, setHovered] = useState(false);
  const position = groupPosition(isFirstInGroup, isLastInGroup);

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
      className={cn("flex items-end gap-1.5", isMine ? "justify-end" : "justify-start")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Hover-revealed quick action — a real, working "copy" utility rather than a decorative placeholder. */}
      {message.type === "text" && (
        <button
          type="button"
          onClick={copyText}
          className={cn(
            "mb-1 rounded-full p-1.5 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
            hovered ? "opacity-100" : "pointer-events-none opacity-0",
            isMine ? "order-first" : "order-last"
          )}
          aria-label="Copier le message"
          title="Copier"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="max-w-[75%]">
        {!isMine && isFirstInGroup && <p className="mb-0.5 px-1 text-xs font-semibold text-muted-foreground">{message.senderName ?? "Étudiant(e)"}</p>}

        <div
          className={cn(
            "relative px-3.5 py-2 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-opacity",
            isMine ? cn(theme.bubble, MINE_RADIUS[position]) : cn("bg-muted text-foreground", OTHER_RADIUS[position]),
            message.status === "sending" && "opacity-70",
            message.status === "failed" && "bg-destructive/90 text-destructive-foreground"
          )}
        >
          {message.type === "text" && (
            <span className="whitespace-pre-wrap pr-9">
              {message.contentText}
              <span
                className={cn(
                  "absolute bottom-1.5 right-3 flex items-center gap-0.5 text-[10px]",
                  isMine ? "text-white/70" : "text-muted-foreground"
                )}
              >
                {TIME_FORMAT.format(new Date(message.createdAt))}
                {isMine && <StatusIcon status={message.status} />}
              </span>
            </span>
          )}

          {message.type === "image" && message.mediaUrl && <ChatImage src={message.mediaUrl} />}
          {message.type === "video" && message.mediaUrl && <video src={message.mediaUrl} controls className="max-h-64 max-w-full rounded-xl" />}
          {message.type === "audio" && message.mediaUrl && <AudioPlayer src={message.mediaUrl} onColoredBubble={isMine} />}
        </div>

        {message.type !== "text" && (
          <p className={cn("mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted-foreground", isMine ? "justify-end" : "justify-start")}>
            {TIME_FORMAT.format(new Date(message.createdAt))}
            {isMine && <StatusIcon status={message.status} />}
          </p>
        )}

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
