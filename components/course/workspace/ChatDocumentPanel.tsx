"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Columns2, Copy, Info, Loader2, MoreVertical, Pin, Quote, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PROSE_CLASSES,
  DARK_PROSE_CLASSES,
  MARKDOWN_COMPONENTS,
  DARK_MARKDOWN_COMPONENTS,
  normalizeCallouts,
} from "@/lib/markdown";
import { CHAT_MAX_CONTEXT_CHARS } from "@/lib/chat-constants";
import { useTextSelection } from "@/hooks/useTextSelection";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { TextSelectionToolbar } from "@/components/course/workspace/TextSelectionToolbar";
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
  /** Split-screen is a wide-viewport-only concept (there's no room for it on the mobile tabbed layout) — the mobile ChatDocumentPanel instance hides this button entirely rather than wiring it to a no-op, which would be a dead/confusing control. Defaults to true so every existing (desktop) caller is unaffected. */
  showSplitScreenToggle?: boolean;
  dark: boolean;
  /** The passage "Ask MedArt" inserted as a citation above the composer — shown as a dismissible blockquote-style chip, prepended to the actual message (as real markdown "> ...") only when the student sends. */
  quotedText: string | null;
  onClearQuote: () => void;
  /** Every course in the current module, for the composer's source-selector badge — lets the student switch which one they're chatting with without leaving the Chat tab. Optional: omitted, the badge stays a plain read-only count (its original behavior). */
  sources?: { id: number; title: string }[];
  activeSourceId?: number | null;
  onSelectSource?: (id: number) => void;
  /** Passed straight through to TextSelectionToolbar's "Add Note" — see that component's own doc comment. Optional: omitted by callers with no module in scope. `courseTitle` is the active SOURCE's title (not `title` above, which is this panel's module-level heading) so an aggregated note correctly tags which course an excerpt came from. */
  moduleId?: number;
  courseTitle?: string;
  /** Length (characters) of the active course's raw source text, if the caller has it client-side. The server hard-truncates context at CHAT_MAX_CONTEXT_CHARS with zero indication to the student (see app/api/courses/chat/route.ts) — when this is provided and exceeds that cap, a banner surfaces that truncation instead of leaving it silent. Optional: omitted by callers without a cheap client-side source length (e.g. the legacy demo pipeline, which never loads the full raw text into the browser). */
  sourceTextLength?: number;
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
    showSplitScreenToggle = true,
    dark,
    quotedText,
    onClearQuote,
    sources,
    activeSourceId,
    onSelectSource,
    moduleId,
    courseTitle,
    sourceTextLength,
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
    if ((input.trim().length === 0 && !quotedText) || isTyping) return;
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
          {showSplitScreenToggle && (
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
          )}
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
              <DropdownMenuItem>Personnaliser MedArt</DropdownMenuItem>
              <DropdownMenuItem onSelect={onClearHistory}>Nouvelle conversation</DropdownMenuItem>
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

        {sourceTextLength !== undefined && sourceTextLength > CHAT_MAX_CONTEXT_CHARS && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>Ce cours est très long. L&apos;IA se concentrera sur les parties les plus pertinentes.</p>
          </div>
        )}

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
        <TextSelectionToolbar
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
          moduleId={moduleId}
          courseTitle={courseTitle}
        />
      )}

      <div className="border-t border-gray-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        {quotedText && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-gray-400 bg-gray-100 px-3 py-2 dark:border-gray-500 dark:bg-neutral-800">
            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400" />
            <p className="line-clamp-2 flex-1 text-xs italic text-gray-600 dark:text-gray-400">{quotedText}</p>
            <button
              type="button"
              onClick={onClearQuote}
              aria-label="Retirer la citation"
              className="shrink-0 rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-3xl bg-gray-100 p-2 dark:bg-neutral-800"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={`Demande à ${sourceCount} source${sourceCount > 1 ? "s" : ""}...`}
            className="flex-1 bg-transparent px-3 text-sm text-gray-900 outline-none placeholder:text-gray-500 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          {sources && sources.length > 0 && onSelectSource ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="shrink-0">
                  <Badge variant="neutral" className="cursor-pointer hover:bg-gray-200 dark:hover:bg-neutral-700">
                    {sourceCount} source{sourceCount > 1 ? "s" : ""}
                  </Badge>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {sources.map((source) => (
                  <DropdownMenuItem key={source.id} onSelect={() => onSelectSource(source.id)}>
                    {source.id === activeSourceId && <Check className="h-4 w-4" />}
                    <span className="truncate">{source.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Badge variant="neutral" className="shrink-0">
              {sourceCount} source{sourceCount > 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            type="submit"
            size="icon"
            disabled={(input.trim().length === 0 && !quotedText) || isTyping}
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
