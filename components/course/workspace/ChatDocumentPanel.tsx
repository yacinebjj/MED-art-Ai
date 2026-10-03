"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Check,
  ChevronDown,
  Columns2,
  Copy,
  Download,
  FileUp,
  GraduationCap,
  Info,
  Layers,
  Loader2,
  MessageSquareText,
  Mic,
  MoreVertical,
  NotebookPen,
  Paperclip,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { stripReasoning } from "@/lib/strip-reasoning";
import { useLanguage } from "@/providers/LanguageProvider";
import {
  CHAT_PROSE_CLASSES,
  DARK_CHAT_PROSE_CLASSES,
  CHAT_MARKDOWN_COMPONENTS,
  DARK_CHAT_MARKDOWN_COMPONENTS,
  normalizeCallouts,
} from "@/lib/markdown";
import { CHAT_MAX_CONTEXT_CHARS, MAX_CHAT_SOURCE_COURSES, type ChatMode } from "@/lib/chat-constants";
import { stripCitationMarkers, type CitationSourceText } from "@/lib/chat-citations";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import { isSpeechSupported, speak, stopSpeaking, useSpeakingId } from "@/hooks/useSpeechSynthesis";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { Kbd } from "@/components/course/workspace/os/Kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { TextSelectionToolbar } from "@/components/course/workspace/TextSelectionToolbar";
import { ChatRichMarkdown } from "@/components/course/workspace/ChatRichMarkdown";
import type { ChatMessage } from "@/lib/types";

export interface ChatDocumentPanelHandle {
  focusInput: () => void;
  /** Puts `text` in the composer (replacing it) and focuses it — used by the command palette's "Poser une question". */
  setDraft: (text: string) => void;
}

const EMPTY_CHAT_PLACEHOLDER = {
  fr: "Pose une question sur tes sources, ou lance une des suggestions ci-dessous.",
  en: "Ask a question about your sources, or start with one of the suggestions below.",
} as const;

/** Server-side cap on one chat message (app/api/courses/chat/route.ts's MAX_MESSAGE_CHARS). */
const MAX_MESSAGE_CHARS = 4000;

export const CHAT_MODE_OPTIONS: { id: ChatMode; label: string; description: string; icon: LucideIcon; placeholder: string }[] = [
  { id: "standard", label: "Standard", description: "Réponse structurée et équilibrée", icon: MessageSquareText, placeholder: "Pose ta question sur le cours…" },
  { id: "examen", label: "Mode Examen", description: "Plan de copie, pièges, QCM d'auto-évaluation", icon: GraduationCap, placeholder: "Quel sujet veux-tu traiter comme à l'examen ?" },
  { id: "detaille", label: "Explication détaillée", description: "Mécanismes pas à pas, analogie, cas concret", icon: BookOpenText, placeholder: "Quel mécanisme veux-tu comprendre en profondeur ?" },
  { id: "express", label: "Synthèse express", description: "5 à 8 puces, l'essentiel à haut rendement", icon: Zap, placeholder: "Que veux-tu réviser en express ?" },
];

const STARTER_PROMPTS = [
  "Résume ce cours en 10 points clés à haut rendement.",
  "Quels sont les pièges d'examen classiques de ce cours ?",
  "Fais-moi un tableau de diagnostic différentiel des pathologies du cours.",
  "Pose-moi 3 questions pour vérifier que j'ai compris l'essentiel.",
];

interface ChatDocumentPanelProps {
  title: string;
  dateLabel: string;
  sourceCount: number;
  messages: ChatMessage[];
  isTyping: boolean;
  /** True from send until the reply has fully streamed (isTyping drops at the first chunk). Blocks sends/regenerations meanwhile. Defaults to isTyping. */
  isBusy?: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  /** Sends a ready-made prompt directly (starter suggestions). Optional: omitted, the suggestions only fill the composer. */
  onSendPrompt?: (prompt: string) => void;
  onClearHistory: () => void;
  onAskSelection: (text: string) => void;
  onTranslateSelection: (text: string) => void;
  /** Set while a contextual action is awaiting its reply, so the typing indicator can name what's being explained. */
  pendingThinkingLabel: string | null;
  isSplitScreen: boolean;
  onToggleSplitScreen: () => void;
  /** Split-screen is a wide-viewport-only concept — the mobile instance hides the toggle entirely. */
  showSplitScreenToggle?: boolean;
  dark: boolean;
  /** Every course in the current module, for the composer's source selector. */
  sources?: { id: number; title: string }[];
  activeSourceId?: number | null;
  onSelectSource?: (id: number) => void;
  /** Multi-select variant (desktop): checked sources are the chat's real RAG context (see app/api/courses/chat's sourceCourseIds). */
  selectedSourceIds?: Set<number>;
  onToggleSource?: (id: number) => void;
  moduleId?: number;
  courseTitle?: string;
  courseSlug?: string;
  /** Length of the active course's raw text — surfaces the "very long course" notice. */
  sourceTextLength?: number;
  onInputFocusChange?: (focused: boolean) => void;
  onRegenerate?: (assistantId: string) => void;
  onSaveToNotes?: (content: string) => void;
  /** Composer answer mode (sent with every request by the caller's useCourseChat extras). */
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  /** Course texts citations are verified against. Providing it switches replies to the rich renderer (medical callouts + citation chips). */
  citationSources?: CitationSourceText[];
  onOpenCitationSource?: (sourceId: number) => void;
  /** Files dropped on (or picked from) the chat are imported as new sources of the module. */
  onImportFiles?: (files: File[]) => void;
}

function IconButton({
  label,
  shortcut,
  onClick,
  active,
  disabled,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 520, damping: 30 }}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:pointer-events-none disabled:opacity-40",
            active && "bg-primary-600 text-white shadow-glow hover:bg-primary-600 hover:text-white dark:bg-primary-500",
            className
          )}
        >
          {children}
        </motion.button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {shortcut && <Kbd tone="inverse">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Center "Co-pilot" panel of the module workspace — NotebookLM-style flowing
 * document (no chat bubbles for replies), with a full input control deck:
 * answer mode, checked-source context meter, voice dictation, file import,
 * and replies rendered with medical callouts + verifiable citations.
 */
export const ChatDocumentPanel = forwardRef<ChatDocumentPanelHandle, ChatDocumentPanelProps>(function ChatDocumentPanel(
  {
    title,
    dateLabel,
    sourceCount,
    messages,
    isTyping,
    isBusy: isBusyProp,
    input,
    onInputChange,
    onSend,
    onSendPrompt,
    onClearHistory,
    onAskSelection,
    onTranslateSelection,
    pendingThinkingLabel,
    isSplitScreen,
    onToggleSplitScreen,
    showSplitScreenToggle = true,
    dark,
    sources,
    activeSourceId,
    onSelectSource,
    selectedSourceIds,
    onToggleSource,
    moduleId,
    courseTitle,
    courseSlug,
    sourceTextLength,
    onInputFocusChange,
    onRegenerate,
    onSaveToNotes,
    mode = "standard",
    onModeChange,
    citationSources,
    onOpenCitationSource,
    onImportFiles,
  },
  ref
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { containerRef, container, tooltipRef, selection, clearSelection } = useTextSelection();
  const { language } = useLanguage();
  const { toast } = useToast();
  const speakingId = useSpeakingId();
  const isBusy = isBusyProp ?? isTyping;

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [savedMessageId, setSavedMessageId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  // Resolved after mount: speechSynthesis doesn't exist during SSR, so
  // reading it in render would make server and client markup disagree.
  const [canReadAloud, setCanReadAloud] = useState(false);
  useEffect(() => setCanReadAloud(isSpeechSupported()), []);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Follow the stream only while the student is already at the bottom —
  // scrolling up to re-read must not be yanked back down on every token.
  const stickToBottomRef = useRef(true);

  const dictationBaseRef = useRef("");
  const dictation = useVoiceDictation({
    onTranscript: (text) => {
      const base = dictationBaseRef.current.trim();
      const merged = (base ? `${base} ${text}` : text).slice(0, MAX_MESSAGE_CHARS);
      dictationBaseRef.current = merged;
      onInputChange(merged);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    onError: (errTitle, description) => toast({ variant: "error", title: errTitle, description }),
  });

  useImperativeHandle(ref, () => ({
    focusInput: () => inputRef.current?.focus(),
    setDraft: (text: string) => {
      onInputChange(text);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
      });
    },
  }));

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: isTyping ? "smooth" : "auto" });
  }, [messages, isTyping]);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
      // A reply being read aloud must not keep talking once the workspace is gone.
      stopSpeaking();
    };
  }, []);

  // Auto-grow the composer up to ~8 lines, then scroll inside it.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function setMessagesRef(node: HTMLDivElement | null) {
    scrollRef.current = node;
    containerRef(node);
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 120;
    setShowJumpToLatest(distanceFromBottom > 400);
  }

  function jumpToLatest() {
    stickToBottomRef.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  const canSend = input.trim().length > 0 && input.length <= MAX_MESSAGE_CHARS && !isBusy && dictation.state !== "transcribing";

  function submit() {
    if (!canSend) return;
    stickToBottomRef.current = true;
    dictationBaseRef.current = "";
    onSend();
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function handleCopy(messageId: string, text: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(stripCitationMarkers(text))
      .then(() => {
        setCopiedMessageId(messageId);
        if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 1500);
      })
      .catch(() => {});
  }

  function handleSaveToNotes(messageId: string, content: string) {
    onSaveToNotes?.(stripCitationMarkers(content));
    setSavedMessageId(messageId);
    setTimeout(() => setSavedMessageId((prev) => (prev === messageId ? null : prev)), 1500);
  }

  function handleReadAloud(messageId: string, content: string) {
    if (speakingId === messageId) {
      stopSpeaking();
      return;
    }
    const result = speak(messageId, stripCitationMarkers(content), language, () =>
      toast({ variant: "error", title: "Lecture interrompue", description: "Le navigateur n'a pas pu lire cette réponse à voix haute." })
    );
    if (!result.ok) {
      toast({
        variant: "error",
        title: "Lecture à voix haute indisponible",
        description: result.reason === "no-voice" ? "Aucune voix installée pour cette langue sur ton appareil." : "Ton navigateur ne prend pas en charge la synthèse vocale.",
      });
    }
  }

  function handleExportConversation() {
    if (messages.length === 0) return;
    const lines = [`# ${title} — Conversation MedArt`, "", `_${dateLabel}_`, ""];
    for (const message of messages) {
      const content = stripCitationMarkers(message.role === "assistant" ? stripReasoning(message.content) : message.content).trim();
      if (!content) continue;
      lines.push(message.role === "user" ? `## ❓ ${content}` : content, "");
    }
    const safeTitle = title.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "conversation";
    downloadMarkdown(`medart-${safeTitle}.md`, lines.join("\n"));
  }

  const acceptsFile = useCallback((file: File) => ACCEPTED_FILE_TYPES.some((ext) => file.name.toLowerCase().endsWith(ext)), []);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || !onImportFiles) return;
    const files = Array.from(fileList);
    const accepted = files.filter(acceptsFile);
    if (accepted.length < files.length) {
      toast({ variant: "error", title: "Format non pris en charge", description: "Formats acceptés : PDF, DOCX, PPTX, TXT." });
    }
    if (accepted.length > 0) onImportFiles(accepted);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!onImportFiles || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    // Only file drops are ours — dragged TEXT must still land in the composer normally.
    if (!onImportFiles || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  const contextCount = selectedSourceIds ? selectedSourceIds.size : sourceCount;
  const activeMode = CHAT_MODE_OPTIONS.find((option) => option.id === mode) ?? CHAT_MODE_OPTIONS[0];
  const ModeIcon = activeMode.icon;
  const isOverSourceCap = Boolean(selectedSourceIds) && contextCount > MAX_CHAT_SOURCE_COURSES;
  const useRichRenderer = Boolean(citationSources);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-3 md:h-14 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-sky-500 text-white shadow-glow">
            <Sparkles className="h-4 w-4" />
            {isTyping && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400" />}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">MedArt Co-pilot</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {isTyping ? "Analyse de tes sources…" : `${contextCount} source${contextCount > 1 ? "s" : ""} en contexte · ${activeMode.label}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {showSplitScreenToggle && (
            <IconButton label={isSplitScreen ? "Quitter l'écran partagé" : "Écran partagé Chat + Studio"} active={isSplitScreen} onClick={onToggleSplitScreen}>
              <Columns2 className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton label="Exporter la conversation (.md)" onClick={handleExportConversation} disabled={messages.length === 0}>
            <Download className="h-4 w-4" />
          </IconButton>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Options du chat"
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Options du chat</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={handleExportConversation} disabled={messages.length === 0}>
                <Download className="h-4 w-4" />
                Exporter en Markdown
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onClearHistory} disabled={messages.length === 0}>
                <Trash2 className="h-4 w-4" />
                Nouvelle conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        ref={setMessagesRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 py-5 font-sans antialiased leading-[1.7] tracking-normal text-foreground md:px-6 md:text-[15px]"
      >
        <div>
          <h1 className="bg-gradient-to-r from-foreground via-foreground to-primary-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:to-primary-300">
            {title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            {contextCount} source{contextCount > 1 ? "s" : ""} · {dateLabel}
          </p>
        </div>

        {sourceTextLength !== undefined && sourceTextLength > CHAT_MAX_CONTEXT_CHARS && (
          <div className="animate-fade-in flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>Ce cours est très long. L&apos;IA se concentrera sur les parties les plus pertinentes.</p>
          </div>
        )}

        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{EMPTY_CHAT_PLACEHOLDER[language]}</p>
            {contextCount > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {STARTER_PROMPTS.map((prompt, index) => (
                  <motion.button
                    key={prompt}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, type: "spring", stiffness: 380, damping: 30 }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isBusy}
                    onClick={() => (onSendPrompt ? onSendPrompt(prompt) : onInputChange(prompt))}
                    className="group flex items-start gap-2 rounded-2xl border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_60%,transparent)] p-3 text-left text-xs font-medium text-[color-mix(in_oklab,var(--foreground)_85%,transparent)] backdrop-blur-md transition-colors hover:border-primary-300 hover:bg-primary-50/60 disabled:opacity-50 dark:hover:border-primary-700 dark:hover:bg-primary-950/30"
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-500 transition-transform group-hover:rotate-12" />
                    {prompt}
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          if (message.role === "user") {
            return (
              <div key={message.id} className="animate-in fade-in slide-in-from-bottom-2 flex items-start gap-2.5 duration-300 ease-out">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--foreground)_90%,transparent)] text-[10px] font-bold text-background">Q</span>
                <p className="min-w-0 whitespace-pre-wrap break-words text-base font-semibold leading-[1.6] tracking-tight text-foreground md:text-[17px]">
                  {message.content}
                </p>
              </div>
            );
          }

          const cleanContent = stripReasoning(message.content);
          const isStreaming = isLast && (isBusy || cleanContent.length === 0);
          const showToolbar = cleanContent.length > 0 && !isStreaming;

          return (
            <div key={message.id} className="group animate-in fade-in slide-in-from-bottom-2 space-y-2 duration-300 ease-out">
              {useRichRenderer ? (
                <ChatRichMarkdown
                  content={cleanContent}
                  dark={dark}
                  citationSources={citationSources ?? []}
                  onOpenSource={onOpenCitationSource}
                  isStreaming={isStreaming}
                />
              ) : (
                <article className={cn(dark ? DARK_CHAT_PROSE_CLASSES : CHAT_PROSE_CLASSES, "max-w-none")}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={dark ? DARK_CHAT_MARKDOWN_COMPONENTS : CHAT_MARKDOWN_COMPONENTS}>
                    {normalizeCallouts(cleanContent || "…")}
                  </ReactMarkdown>
                </article>
              )}
              {showToolbar && !isStreaming && (
                <div className="flex items-center gap-0.5 transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100">
                  <IconButton label={copiedMessageId === message.id ? "Copié" : "Copier la réponse"} onClick={() => handleCopy(message.id, cleanContent)}>
                    {copiedMessageId === message.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </IconButton>
                  {onRegenerate && (
                    <IconButton label="Régénérer la réponse" disabled={isBusy} onClick={() => onRegenerate(message.id)}>
                      <RefreshCw className="h-4 w-4" />
                    </IconButton>
                  )}
                  {onSaveToNotes && (
                    <IconButton
                      label={savedMessageId === message.id ? "Enregistré dans Mes notes" : "Enregistrer dans Mes notes"}
                      onClick={() => handleSaveToNotes(message.id, cleanContent)}
                    >
                      {savedMessageId === message.id ? <Check className="h-4 w-4 text-emerald-500" /> : <NotebookPen className="h-4 w-4" />}
                    </IconButton>
                  )}
                  {canReadAloud && (
                    <IconButton
                      label={speakingId === message.id ? "Arrêter la lecture" : "Lire à voix haute"}
                      active={speakingId === message.id}
                      onClick={() => handleReadAloud(message.id, cleanContent)}
                    >
                      {speakingId === message.id ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </IconButton>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {isTyping && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary-500" />
            </span>
            {pendingThinkingLabel ? `Analyse de « ${pendingThinkingLabel} »…` : `MedArt rédige · ${activeMode.label}…`}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showJumpToLatest && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            onClick={jumpToLatest}
            aria-label="Aller au dernier message"
            className="absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-[color-mix(in_oklab,var(--card)_90%,transparent)] px-3 py-1.5 text-xs font-medium text-foreground shadow-glass backdrop-blur-md"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Dernier message
          </motion.button>
        )}
      </AnimatePresence>

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

      <div className="shrink-0 border-t border-[color-mix(in_oklab,var(--border)_70%,transparent)] bg-[color-mix(in_oklab,var(--card)_70%,transparent)] p-3 backdrop-blur-md md:p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={cn(
            "rounded-2xl border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--background)_70%,transparent)] shadow-soft transition-all duration-300 focus-within:border-primary-300 focus-within:shadow-glow dark:bg-white/[0.03] dark:focus-within:border-primary-700",
            dictation.state === "recording" && "border-rose-300 dark:border-rose-800"
          )}
        >
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={MAX_MESSAGE_CHARS + 200}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            onFocus={() => onInputFocusChange?.(true)}
            onBlur={() => onInputFocusChange?.(false)}
            placeholder={dictation.state === "recording" ? "Je t'écoute… clique sur ■ pour terminer." : activeMode.placeholder}
            aria-label="Message au co-pilote"
            className="block max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            {onModeChange && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                          mode === "standard"
                            ? "border-[color-mix(in_oklab,var(--border)_80%,transparent)] text-muted-foreground hover:bg-accent hover:text-foreground"
                            : "border-primary-300 bg-primary-50 text-primary-700 dark:border-primary-800 dark:bg-primary-950/40 dark:text-primary-300"
                        )}
                      >
                        <ModeIcon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{activeMode.label}</span>
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Mode de réponse</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel>Mode de réponse</DropdownMenuLabel>
                  {CHAT_MODE_OPTIONS.map((option) => {
                    const OptionIcon = option.icon;
                    return (
                      <DropdownMenuItem key={option.id} onSelect={() => onModeChange(option.id)} className="items-start gap-2.5 py-2">
                        <OptionIcon className={cn("mt-0.5 h-4 w-4 shrink-0", option.id === mode ? "text-primary-600 dark:text-primary-400" : "text-muted-foreground")} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="block text-xs text-muted-foreground">{option.description}</span>
                        </span>
                        {option.id === mode && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {sources && sources.length > 0 && (onToggleSource || onSelectSource) ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-8 items-center gap-1.5 rounded-xl border border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {contextCount}
                        {selectedSourceIds && (
                          <span aria-hidden className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-muted sm:block">
                            <span
                              className={cn("block h-full rounded-full transition-all duration-500", isOverSourceCap ? "bg-amber-500" : "bg-primary-500")}
                              style={{ width: `${Math.min(100, (contextCount / MAX_CHAT_SOURCE_COURSES) * 100)}%` }}
                            />
                          </span>
                        )}
                      </button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs whitespace-normal">
                    {selectedSourceIds
                      ? `Contexte : ${contextCount}/${MAX_CHAT_SOURCE_COURSES} sources. Le co-pilote cherche les passages les plus pertinents dans les sources cochées.`
                      : "Choisir le cours de la discussion"}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuLabel>{selectedSourceIds ? "Sources en contexte" : "Cours de la discussion"}</DropdownMenuLabel>
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
                            selectedSourceIds.has(source.id) ? "border-primary-500 bg-primary-500 text-white" : "border-[color-mix(in_oklab,var(--muted-foreground)_40%,transparent)]"
                          )}
                        >
                          {selectedSourceIds.has(source.id) && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className="truncate">{source.title}</span>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem key={source.id} onSelect={() => onSelectSource?.(source.id)}>
                        {source.id === activeSourceId ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                        <span className="truncate">{source.title}</span>
                      </DropdownMenuItem>
                    )
                  )}
                  {isOverSourceCap && (
                    <p className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                      Seules les {MAX_CHAT_SOURCE_COURSES} premières sources cochées sont interrogées à chaque message.
                    </p>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Badge variant="neutral" className="shrink-0">
                {sourceCount} source{sourceCount > 1 ? "s" : ""}
              </Badge>
            )}

            {onImportFiles && (
              <>
                <IconButton label="Importer un document comme source" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                </IconButton>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_FILE_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </>
            )}

            {dictation.supported && (
              <IconButton
                label={dictation.state === "recording" ? "Terminer la dictée" : dictation.state === "transcribing" ? "Transcription…" : "Dicter ta question"}
                active={dictation.state === "recording"}
                disabled={dictation.state === "transcribing"}
                onClick={() => {
                  if (dictation.state === "idle") dictationBaseRef.current = input;
                  dictation.toggle();
                }}
                className={cn(dictation.state === "recording" && "bg-rose-600 hover:bg-rose-600 dark:bg-rose-500")}
              >
                {dictation.state === "transcribing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : dictation.state === "recording" ? (
                  <Square className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </IconButton>
            )}
            {dictation.state === "recording" && (
              <span className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
                {formatClock(dictation.elapsedSeconds)}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {input.length > MAX_MESSAGE_CHARS * 0.85 && (
                <span className={cn("text-[11px] tabular-nums", input.length > MAX_MESSAGE_CHARS ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  {input.length}/{MAX_MESSAGE_CHARS}
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.button
                    type="submit"
                    whileTap={{ scale: 0.9 }}
                    disabled={!canSend}
                    aria-label="Envoyer"
                    className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-600 text-white shadow-glow transition-colors hover:bg-primary-500 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none dark:bg-primary-500"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-2">
                  Envoyer <Kbd tone="inverse">↵</Kbd> · nouvelle ligne <Kbd tone="inverse">⇧↵</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </form>
      </div>

      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary-400 bg-primary-50/85 text-primary-700 backdrop-blur-md dark:bg-primary-950/70 dark:text-primary-200"
          >
            <FileUp className="h-8 w-8" />
            <p className="text-sm font-semibold">Dépose ton polycop pour l&apos;ajouter aux sources</p>
            <p className="text-xs opacity-80">PDF, DOCX, PPTX, TXT — max 100 Mo</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
