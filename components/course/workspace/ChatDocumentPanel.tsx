"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Columns2, Copy, Loader2, MoreVertical, Pin, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROSE_CLASSES,
  DARK_PROSE_CLASSES,
  MARKDOWN_COMPONENTS,
  DARK_MARKDOWN_COMPONENTS,
  normalizeCallouts,
} from "@/lib/markdown";
import { useTextSelection } from "@/hooks/useTextSelection";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { SelectionTooltip } from "@/components/course/workspace/SelectionTooltip";
import type { ChatMessage } from "@/lib/types";

export interface ChatDocumentPanelHandle {
  focusInput: () => void;
}

interface ChatDocumentPanelProps {
  title: string;
  dateLabel: string;
  sourceCount: number;
  messages: ChatMessage[];
  isTyping: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClearHistory: () => void;
  onAskSelection: (text: string) => void;
  onTranslateSelection: (text: string) => void;
  /** Set while a contextual action (a mind-map node, "Ask MedArt"...) is awaiting its reply, so the typing indicator can name what's being explained instead of a generic "MedArt écrit…". */
  pendingThinkingLabel: string | null;
  isSplitScreen: boolean;
  onToggleSplitScreen: () => void;
  dark: boolean;
}

/**
 * Center "Chat" panel, NotebookLM-style: no chat bubbles — the assistant's
 * reply reads as a flowing document (same PROSE_CLASSES/MARKDOWN_COMPONENTS
 * used everywhere else in the app), with the user's own question rendered as
 * a plain heading line above it instead of a bubble.
 */
export const ChatDocumentPanel = forwardRef<ChatDocumentPanelHandle, ChatDocumentPanelProps>(function ChatDocumentPanel(
  {
    title,
    dateLabel,
    sourceCount,
    messages,
    isTyping,
    input,
    onInputChange,
    onSend,
    onClearHistory,
    onAskSelection,
    onTranslateSelection,
    pendingThinkingLabel,
    isSplitScreen,
    onToggleSplitScreen,
    dark,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { containerRef, tooltipRef, selection, clearSelection } = useTextSelection();

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  // Merges the auto-scroll ref with useTextSelection's callback ref — both
  // need to observe the same messages container.
  function setMessagesRef(node: HTMLDivElement | null) {
    scrollRef.current = node;
    containerRef(node);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input.trim().length === 0 || isTyping) return;
    onSend();
  }

  function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Chat</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleSplitScreen}
            aria-label={isSplitScreen ? "Quitter l'écran partagé" : "Activer l'écran partagé"}
            aria-pressed={isSplitScreen}
            className={cn(
              "rounded-full p-1 transition-colors",
              isSplitScreen
                ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"
            )}
          >
            <Columns2 className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Options du chat"
                className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-neutral-800"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Customize notebook</DropdownMenuItem>
              <DropdownMenuItem onSelect={onClearHistory}>Delete chat history</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div ref={setMessagesRef} className="flex-1 space-y-8 overflow-y-auto p-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {sourceCount} source{sourceCount > 1 ? "s" : ""} · {dateLabel}
          </p>
        </div>

        {messages.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Pose une question sur ce cours pour commencer la discussion.
          </p>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <p key={message.id} className="text-base font-medium leading-relaxed text-gray-900 dark:text-gray-100 md:text-lg">
              {message.content}
            </p>
          ) : (
            <div key={message.id} className="space-y-3">
              <article className={cn(dark ? DARK_PROSE_CLASSES : PROSE_CLASSES, "max-w-none")}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={dark ? DARK_MARKDOWN_COMPONENTS : MARKDOWN_COMPONENTS}
                >
                  {normalizeCallouts(message.content || "…")}
                </ReactMarkdown>
              </article>
              {message.content && index === messages.length - 1 && !isTyping ? (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="Enregistrer dans une note">
                    <Pin className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copier"
                    onClick={() => copyToClipboard(message.content)}
                  >
                    <Copy className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Bonne réponse">
                    <ThumbsUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Mauvaise réponse">
                    <ThumbsDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                  </Button>
                </div>
              ) : null}
            </div>
          )
        )}

        {isTyping && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {pendingThinkingLabel ? `Thinking about ${pendingThinkingLabel}...` : "MedArt écrit…"}
          </div>
        )}
      </div>

      {selection && (
        <SelectionTooltip
          ref={tooltipRef}
          selection={selection}
          onAsk={(text) => {
            onAskSelection(text);
            clearSelection();
          }}
          onTranslate={(text) => {
            onTranslateSelection(text);
            clearSelection();
          }}
        />
      )}

      <div className="border-t border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-3xl bg-gray-100 p-2 dark:bg-neutral-800"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="Start typing..."
            className="flex-1 bg-transparent px-3 text-sm text-gray-900 outline-none placeholder:text-gray-500 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <button type="button" className="shrink-0">
            <Badge
              variant="neutral"
              className="cursor-pointer hover:bg-gray-200 dark:hover:bg-neutral-700"
            >
              {sourceCount} source{sourceCount > 1 ? "s" : ""}
            </Badge>
          </button>
          <Button
            type="submit"
            size="icon"
            disabled={input.trim().length === 0 || isTyping}
            className="shrink-0 rounded-full"
            aria-label="Envoyer"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </>
  );
});
