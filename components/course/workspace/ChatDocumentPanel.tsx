"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Check, Columns2, Copy, Info, MoreVertical, Pin, Quote, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";
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
  /**
   * Multi-select variant of the badge above (Point 2 — desktop only): when
   * both are provided, the dropdown renders a checkbox per source (several
   * can be checked at once) instead of a single-select Check-mark list, and
   * the badge shows "N source(s)" from `selectedSourceIds.size` rather than
   * the plain `sourceCount` prop. Takes priority over
   * activeSourceId/onSelectSource when both are present. Optional: the
   * mobile caller keeps the original single-select pair above untouched.
   */
  selectedSourceIds?: Set<number>;
  onToggleSource?: (id: number) => void;
  /** Passed straight through to TextSelectionToolbar's "Add Note" — see that component's own doc comment. Optional: omitted by callers with no module in scope. `courseTitle` is the active SOURCE's title (not `title` above, which is this panel's module-level heading) so an aggregated note correctly tags which course an excerpt came from. */
  moduleId?: number;
  courseTitle?: string;
  /** Passed straight through to TextSelectionToolbar for highlight persistence (POST /api/highlights) — without this, a highlight applies visually but silently never saves (handlePickColor bails out early with no courseSlug). Was previously never passed by this panel at all — see that component's own comment on why this must be the SAME synthetic "studio-course-{id}" slug already used for course_chat_history/semantic-cache scoping elsewhere (app/dashboard/module/[id]/page.tsx's own courseChatSlug). */
  courseSlug?: string;
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
    selectedSourceIds,
    onToggleSource,
    moduleId,
    courseTitle,
    courseSlug,
    sourceTextLength,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { containerRef, container, tooltipRef, selection, clearSelection } = useTextSelection();

  // Per-message reaction/pin/copy state for the action row below each
  // assistant reply. Keyed by message.id (not a flat boolean) so a new
  // reply never inherits the previous one's "liked"/"pinned"/"copied"
  // look — only that row is ever shown at once (index === last message),
  // but keying by id keeps this correct even if that changes later.
  // Session-local only: no feedback API exists yet for message reactions
  // (checked app/api/**) and no pinned-messages store exists elsewhere in
  // this component or its callers, so this mirrors the same session-local
  // pattern already shipped for the assistant page's chat toolbar
  // (app/dashboard/(shell)/assistant/page.tsx) instead of inventing a
  // parallel persistence mechanism.
  const [messageReactions, setMessageReactions] = useState<Record<string, "up" | "down">>({});
  const [pinnedMessageIds, setPinnedMessageIds] = useState<Set<string>>(() => new Set());
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
  }));

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping]);

  // Cleanup only — avoids setState on an unmounted panel if the student
  // navigates away right after copying.
  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
    };
  }, []);

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

  function handleCopy(messageId: string, text: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedMessageId(messageId);
        if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 1500);
      })
      .catch(() => {});
  }

  function toggleReaction(messageId: string, value: "up" | "down") {
    setMessageReactions((prev) => {
      const next = { ...prev };
      if (next[messageId] === value) {
        delete next[messageId];
      } else {
        next[messageId] = value;
      }
      return next;
    });
  }

  function togglePinned(messageId: string) {
    setPinnedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          MedArt Assistant
        </h2>
        <div className="flex items-center gap-1">
          {showSplitScreenToggle && (
          <button
            type="button"
            onClick={onToggleSplitScreen}
            aria-label={isSplitScreen ? "Quitter l'écran partagé" : "Activer l'écran partagé"}
            aria-pressed={isSplitScreen}
            className={cn(
              "rounded-full p-1.5 transition-all duration-300 active:scale-[0.94]",
              isSplitScreen
                ? "bg-primary-600 text-white shadow-glow dark:bg-primary-500"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
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
                className="rounded-full p-1.5 text-muted-foreground transition-all duration-300 hover:bg-accent hover:text-foreground active:scale-[0.94]"
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
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {(() => {
              const count = selectedSourceIds ? selectedSourceIds.size : sourceCount;
              return `${count} source${count > 1 ? "s" : ""}`;
            })()} · {dateLabel}
          </p>
        </div>

        {sourceTextLength !== undefined && sourceTextLength > CHAT_MAX_CONTEXT_CHARS && (
          <div className="animate-fade-in flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>Ce cours est très long. L&apos;IA se concentrera sur les parties les plus pertinentes.</p>
          </div>
        )}

        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Pose une question sur ce cours pour commencer la discussion.
          </p>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <p key={message.id} className="text-base font-medium leading-relaxed text-foreground md:text-lg">
              {message.content}
            </p>
          ) : (
            <div key={message.id} className="animate-fade-in space-y-3">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={pinnedMessageIds.has(message.id) ? "Retirer l'épingle" : "Épingler ce message"}
                    aria-pressed={pinnedMessageIds.has(message.id)}
                    onClick={() => togglePinned(message.id)}
                  >
                    <Pin
                      className={cn(
                        "h-4 w-4 transition-colors",
                        pinnedMessageIds.has(message.id) ? "text-primary-600 dark:text-primary-400" : "text-muted-foreground"
                      )}
                      fill={pinnedMessageIds.has(message.id) ? "currentColor" : "none"}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={copiedMessageId === message.id ? "Copié" : "Copier"}
                    onClick={() => handleCopy(message.id, message.content)}
                  >
                    {copiedMessageId === message.id ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Bonne réponse"
                    aria-pressed={messageReactions[message.id] === "up"}
                    onClick={() => toggleReaction(message.id, "up")}
                  >
                    <ThumbsUp
                      className={cn(
                        "h-4 w-4 transition-colors",
                        messageReactions[message.id] === "up" ? "text-emerald-500" : "text-muted-foreground"
                      )}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Mauvaise réponse"
                    aria-pressed={messageReactions[message.id] === "down"}
                    onClick={() => toggleReaction(message.id, "down")}
                  >
                    <ThumbsDown
                      className={cn(
                        "h-4 w-4 transition-colors",
                        messageReactions[message.id] === "down" ? "text-rose-500" : "text-muted-foreground"
                      )}
                    />
                  </Button>
                </div>
              ) : null}
            </div>
          )
        )}

        {isTyping && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500" />
            </span>
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
          courseSlug={courseSlug}
          container={container}
        />
      )}

      <div className="border-t border-border bg-card p-4">
        {quotedText && (
          <div className="animate-fade-in mb-2 flex items-start gap-2 rounded-xl border-l-4 border-primary-400 bg-accent px-3 py-2 dark:border-primary-500">
            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="line-clamp-2 flex-1 text-xs italic text-muted-foreground">{quotedText}</p>
            <button
              type="button"
              onClick={onClearQuote}
              aria-label="Retirer la citation"
              className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent-foreground/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 rounded-3xl bg-muted p-2 transition-shadow duration-300 focus-within:shadow-glow"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="Type..."
            className="flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {sources && sources.length > 0 && (onToggleSource || onSelectSource) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex shrink-0 items-center gap-1.5">
                  <Pin className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <Badge variant="neutral" className="cursor-pointer transition-colors hover:bg-accent">
                    {selectedSourceIds ? selectedSourceIds.size : sourceCount} source
                    {(selectedSourceIds ? selectedSourceIds.size : sourceCount) > 1 ? "s" : ""}
                  </Badge>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {sources.map((source) =>
                  onToggleSource && selectedSourceIds ? (
                    <DropdownMenuItem
                      key={source.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        onToggleSource(source.id);
                      }}
                    >
                      <span
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border",
                          selectedSourceIds.has(source.id)
                            ? "border-primary-500 bg-primary-500 text-white"
                            : "border-muted-foreground/40"
                        )}
                      >
                        {selectedSourceIds.has(source.id) && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span className="truncate">{source.title}</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem key={source.id} onSelect={() => onSelectSource?.(source.id)}>
                      {source.id === activeSourceId && <Check className="h-4 w-4" />}
                      <span className="truncate">{source.title}</span>
                    </DropdownMenuItem>
                  )
                )}
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
