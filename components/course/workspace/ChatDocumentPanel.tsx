"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  FileUp,
  GraduationCap,
  Info,
  Layers,
  ListChecks,
  Loader2,
  MessageSquareText,
  Mic,
  MoreHorizontal,
  NotebookPen,
  Plus,
  RefreshCw,
  ShieldAlert,
  Square,
  Table2,
  Trash2,
  Volume2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { stripReasoning } from "@/lib/strip-reasoning";
import { cleanAssistantMarkdown } from "@/lib/assistant-markdown";
import { withVerifiedImages } from "@/lib/medical-image-client";
import { dominantDirection } from "@/lib/text-direction";
import { tAssistant } from "@/lib/translations/assistant";
import { useLanguage } from "@/providers/LanguageProvider";
import { useAuth } from "@/providers/AuthProvider";
import { CHAT_MAX_CONTEXT_CHARS, MAX_CHAT_SOURCE_COURSES, type ChatMode } from "@/lib/chat-constants";
import { stripCitationMarkers, type CitationSourceText } from "@/lib/chat-citations";
import { ACCEPTED_FILE_TYPES } from "@/lib/constants";
import { MAX_UPLOAD_FILE_MB } from "@/lib/upload-limits";
import { useTextSelection } from "@/hooks/useTextSelection";
import { useReadingSurface } from "@/hooks/useReadingSurface";
import { useThreadWindow } from "@/hooks/useThreadWindow";
import { readingKey } from "@/lib/reading/keys";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isSpeechSupported, speak, stopSpeaking, useSpeakingId } from "@/hooks/useSpeechSynthesis";
import { useToast } from "@/components/ui/Toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import {
  AssistantAvatar,
  COPILOT_ACTION_BUTTON_CLASSES,
  COPILOT_HUB_CLASSES,
  CopilotAmbience,
  CopilotWelcome,
  TypingIndicator,
  type CopilotSuggestion,
} from "@/components/assistant/CopilotParts";
import { displayFirstName } from "@/lib/display-name";
import { StreamedMarkdown } from "@/components/assistant/StreamedMarkdown";
import { UserMessageBubble } from "@/components/assistant/UserMessageBubble";
import { VoiceMeter } from "@/components/assistant/VoiceMeter";
import { TextSelectionToolbar } from "@/components/course/workspace/TextSelectionToolbar";
import { ChatRichMarkdown } from "@/components/course/workspace/ChatRichMarkdown";
import type { ChatMessage } from "@/lib/types";

export interface ChatDocumentPanelHandle {
  focusInput: () => void;
  /** Puts `text` in the composer (replacing it) and focuses it — used by the command palette's "Poser une question". */
  setDraft: (text: string) => void;
}

/** Server-side cap on one chat message (app/api/courses/chat/route.ts's MAX_MESSAGE_CHARS). */
const MAX_MESSAGE_CHARS = 4000;

/**
 * Phones read the workspace chat's replies larger than the MedArt Copilot's:
 * 18 px (the Copilot's are 17 px there; from sm both are 18 px). A `max-sm:`
 * class, appended after the base size so it wins there; rem, so
 * app/globals.css's phone type scale leaves it alone. The student's bubbles
 * are the same 17 px in both Copilots (COPILOT_USER_BUBBLE_CLASSES).
 */
const PHONE_REPLY_TEXT = "max-sm:text-[1.125rem]";

/** How far a reading scroll must travel in one direction before the page's chrome reacts. */
const READING_SCROLL_TRAVEL = 24;

export const CHAT_MODE_OPTIONS: { id: ChatMode; label: string; description: string; icon: LucideIcon; placeholder: string }[] = [
  { id: "standard", label: "Standard", description: "Réponse structurée et équilibrée", icon: MessageSquareText, placeholder: "Pose ta question sur le cours…" },
  { id: "examen", label: "Mode Examen", description: "Plan de copie, pièges, QCM d'auto-évaluation", icon: GraduationCap, placeholder: "Quel sujet veux-tu traiter comme à l'examen ?" },
  { id: "detaille", label: "Explication détaillée", description: "Mécanismes pas à pas, analogie, cas concret", icon: BookOpenText, placeholder: "Quel mécanisme veux-tu comprendre en profondeur ?" },
  { id: "express", label: "Synthèse express", description: "5 à 8 puces, l'essentiel à haut rendement", icon: Zap, placeholder: "Que veux-tu réviser en express ?" },
];

/** Welcome suggestions — `label` on the pill from sm (`short` on phones), `text` the request it sends. */
const STARTER_PROMPTS: readonly CopilotSuggestion[] = [
  { icon: ListChecks, label: "10 points clés", short: "10 points clés", text: "Résume ce cours en 10 points clés à haut rendement." },
  { icon: ShieldAlert, label: "Pièges d'examen", short: "Pièges d'examen", text: "Quels sont les pièges d'examen classiques de ce cours ?" },
  { icon: Table2, label: "Diagnostic différentiel", short: "Différentiel", text: "Fais-moi un tableau de diagnostic différentiel des pathologies du cours." },
  { icon: BookOpenCheck, label: "Teste-moi en 3 questions", short: "Teste-moi", text: "Pose-moi 3 questions pour vérifier que j'ai compris l'essentiel." },
];

/** The "+" menu's rows: an icon tile, a label and a hint (the MedArt Copilot's attachment menu). */
const MENU_ROW =
  "flex min-h-[60px] w-full cursor-pointer items-center gap-3 rounded-2xl px-2.5 text-left transition-colors hover:bg-sky-500/[0.08] focus-visible:bg-sky-500/[0.1] focus-visible:outline-none active:bg-sky-500/[0.14]";
const MENU_TILE = "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl";
const MENU_TILE_ACCENT = "bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_8px_18px_-8px_rgba(14,165,233,0.8)]";
const MENU_TILE_QUIET = "bg-black/[0.04] text-slate-600 dark:bg-white/[0.06] dark:text-white/70";

/** A reply that failed: useCourseChat writes a single short "⚠️ …" line instead of the answer. */
function isErrorReply(content: string): boolean {
  const text = content.trim();
  return text.startsWith("⚠️") && text.length < 400 && !text.includes("\n");
}

/** A reply as plain, readable Markdown — for the clipboard, Mes notes, read-aloud and the export — each image as the verified Wikimedia file shown (lib/medical-image-client.ts). */
function readableReply(content: string): string {
  return withVerifiedImages(cleanAssistantMarkdown(stripCitationMarkers(content), { formulaBlocks: false, typography: false }));
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

type MenuView = "root" | "mode" | "sources";

interface ComposerMenuProps {
  view: MenuView;
  onViewChange: (view: MenuView) => void;
  onClose: () => void;
  onImport?: () => void;
  mode: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  sources?: { id: number; title: string }[];
  selectedSourceIds?: Set<number>;
  onToggleSource?: (id: number) => void;
  activeSourceId?: number | null;
  onSelectSource?: (id: number) => void;
  isLongCourse: boolean;
}

/**
 * What the Workspace needs beyond a plain chat — importing a course, the
 * answer mode (Mode Examen…) and which sources the Co-pilot reads — kept out
 * of sight behind the composer's "+", the way the MedArt Copilot keeps its
 * attachments there. A popover above the "+" on desktop, a bottom sheet on
 * phones; the mode and the sources open as their own page inside it.
 */
function ComposerMenuBody({
  view,
  onViewChange,
  onClose,
  onImport,
  mode,
  onModeChange,
  sources,
  selectedSourceIds,
  onToggleSource,
  activeSourceId,
  onSelectSource,
  isLongCourse,
}: ComposerMenuProps) {
  const activeMode = CHAT_MODE_OPTIONS.find((option) => option.id === mode) ?? CHAT_MODE_OPTIONS[0];
  const ModeIcon = activeMode.icon;
  const isMulti = Boolean(onToggleSource && selectedSourceIds);
  const hasSources = Boolean(sources && sources.length > 0 && (onToggleSource || onSelectSource));
  const checkedCount = selectedSourceIds ? sources?.filter((source) => selectedSourceIds.has(source.id)).length ?? 0 : 0;
  const activeSourceTitle = sources?.find((source) => source.id === activeSourceId)?.title;

  if (view === "mode" && onModeChange) {
    return (
      <div>
        <MenuHeader title="Mode de réponse" onBack={() => onViewChange("root")} />
        <div role="radiogroup" aria-label="Mode de réponse">
          {CHAT_MODE_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            const isActive = option.id === mode;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => {
                  haptic();
                  onModeChange(option.id);
                  onClose();
                }}
                className={MENU_ROW}
              >
                <span className={cn(MENU_TILE, isActive ? MENU_TILE_ACCENT : MENU_TILE_QUIET)}>
                  <OptionIcon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1 py-2">
                  <span className="block text-[15px] font-medium text-foreground">{option.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{option.description}</span>
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === "sources" && hasSources && sources) {
    const isOverCap = isMulti && checkedCount > MAX_CHAT_SOURCE_COURSES;
    const listTitle = isMulti ? "Sources en contexte" : "Cours de la discussion";
    return (
      <div>
        <MenuHeader title={listTitle} aside={isMulti ? `${checkedCount}/${MAX_CHAT_SOURCE_COURSES}` : undefined} onBack={() => onViewChange("root")} />
        <div role={isMulti ? "group" : "radiogroup"} aria-label={listTitle}>
          {sources.map((source) => {
            const isChecked = isMulti ? Boolean(selectedSourceIds?.has(source.id)) : source.id === activeSourceId;
            return (
              <button
                key={source.id}
                type="button"
                role={isMulti ? "checkbox" : "radio"}
                aria-checked={isChecked}
                onClick={() => {
                  haptic();
                  if (isMulti) {
                    onToggleSource?.(source.id);
                  } else {
                    onSelectSource?.(source.id);
                    onClose();
                  }
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors hover:bg-sky-500/[0.08] focus-visible:bg-sky-500/[0.1] focus-visible:outline-none active:bg-sky-500/[0.14]"
              >
                {isMulti ? (
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      isChecked ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300 dark:border-white/25"
                    )}
                  >
                    {isChecked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    {isChecked && <Check className="h-4 w-4 text-sky-600 dark:text-sky-400" strokeWidth={2.5} />}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate py-2 text-sm text-foreground">{source.title}</span>
              </button>
            );
          })}
        </div>
        {(isOverCap || isLongCourse) && (
          <div className="space-y-1.5 px-3 pb-2 pt-2.5">
            {isOverCap && (
              <p className="text-xs leading-snug text-amber-700 dark:text-amber-300">
                Seules les {MAX_CHAT_SOURCE_COURSES} premières sources cochées sont lues à chaque message.
              </p>
            )}
            {isLongCourse && (
              <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                Cours très long : le Co-pilote se concentre sur ses passages les plus pertinents.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {onImport && (
        <button
          type="button"
          onClick={() => {
            haptic();
            onImport();
            onClose();
          }}
          className={MENU_ROW}
        >
          <span className={cn(MENU_TILE, MENU_TILE_ACCENT)}>
            <FileUp className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">Ajouter une source</span>
            <span className="block truncate text-xs text-muted-foreground">PDF, DOCX, PPTX ou TXT</span>
          </span>
        </button>
      )}
      {onModeChange && (
        <button type="button" onClick={() => onViewChange("mode")} className={MENU_ROW}>
          <span className={cn(MENU_TILE, MENU_TILE_ACCENT)}>
            <ModeIcon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">Mode de réponse</span>
            <span className="block truncate text-xs text-muted-foreground">{activeMode.label}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}
      {hasSources && sources && (
        <button type="button" onClick={() => onViewChange("sources")} className={MENU_ROW}>
          <span className={cn(MENU_TILE, MENU_TILE_ACCENT)}>
            <Layers className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-foreground">{isMulti ? "Sources en contexte" : "Cours de la discussion"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {isMulti
                ? `${checkedCount} sur ${sources.length} cochée${checkedCount > 1 ? "s" : ""}`
                : activeSourceTitle ?? "Aucun cours ouvert"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

function MenuHeader({ title, aside, onBack }: { title: string; aside?: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 pb-1">
      <button
        type="button"
        onClick={onBack}
        aria-label="Retour"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:text-white/70 dark:hover:bg-white/[0.08]"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
      {aside && <span className="pr-3 text-xs tabular-nums text-muted-foreground">{aside}</span>}
    </div>
  );
}

interface ChatDocumentPanelProps {
  title: string;
  dateLabel: string;
  sourceCount: number;
  messages: ChatMessage[];
  isTyping: boolean;
  /** True from send until the reply has fully streamed (isTyping drops at the first chunk). Blocks sends/regenerations meanwhile. Defaults to isTyping. */
  isBusy?: boolean;
  /** The saved conversation is still loading: the welcome screen waits instead of flashing before it. */
  isHistoryLoading?: boolean;
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
  /** Every course in the current module, for the composer's source selector. */
  sources?: { id: number; title: string }[];
  activeSourceId?: number | null;
  onSelectSource?: (id: number) => void;
  /** The sources the chat really reads (its RAG context, see app/api/courses/chat's sourceCourseIds) — what the welcome counts. With onToggleSource (desktop), the "+" menu checks and unchecks them. */
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
  /**
   * Phones: how much of the panel's bottom the page's own chrome covers
   * right now (its glass tab bar, or the home-indicator strip), in px. The
   * composer floats that much higher, sliding as it changes.
   */
  bottomInset?: number;
  /**
   * Phones: the student scrolled the thread by hand, down (reading on) or up.
   * The page slides its tab bar away and back with it.
   */
  onReadingScroll?: (direction: "up" | "down") => void;
}

/**
 * The module workspace's Co-pilot, in the MedArt Copilot's own design
 * (app/dashboard/(shell)/assistant/page.tsx, shared through
 * components/assistant/CopilotParts.tsx): its liquid-light canvas, the
 * glowing brain and greeting, sky bubbles, the same reply typography and
 * action bar, and the same floating composer. What only the workspace needs
 * stays out of sight until asked for: importing a course, the answer mode and
 * the sources live behind the composer's "+" (an armed mode shows as one chip
 * in the composer, like the Copilot's quick actions), the conversation's
 * options behind one "…", citations and medical callouts inside the replies.
 */
export const ChatDocumentPanel = forwardRef<ChatDocumentPanelHandle, ChatDocumentPanelProps>(function ChatDocumentPanel(
  {
    title,
    dateLabel,
    sourceCount,
    messages,
    isTyping,
    isBusy: isBusyProp,
    isHistoryLoading = false,
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
    bottomInset = 0,
    onReadingScroll,
  },
  ref
) {
  const columnRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { containerRef, container, tooltipRef, selection, clearSelection } = useTextSelection();
  // The conversation is a reading surface for highlights (kept in the account,
  // painted back on every visit). Its scroll stays the thread's own: it
  // follows the latest message, never a remembered position.
  useReadingSurface(container, { key: readingKey("chat", courseSlug ?? (moduleId !== undefined ? `module-${moduleId}` : null)), scroll: false });
  const { language } = useLanguage();
  const { profile } = useAuth();
  const firstName = displayFirstName(profile?.fullName) ?? "Étudiant(e)";
  const { toast } = useToast();
  const speakingId = useSpeakingId();
  // Phones get the "+" menu as a bottom sheet (the module page's own mobile layout starts below md).
  const isCompactMenu = useMediaQuery("(max-width: 767px)");
  const isBusy = isBusyProp ?? isTyping;

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [savedMessageId, setSavedMessageId] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>("root");
  // Resolved after mount: speechSynthesis doesn't exist during SSR, so
  // reading it in render would make server and client markup disagree.
  const [canReadAloud, setCanReadAloud] = useState(false);
  useEffect(() => setCanReadAloud(isSpeechSupported()), []);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Follow the stream only while the student is already at the bottom —
  // scrolling up to re-read must not be yanked back down on every token.
  const stickToBottomRef = useRef(true);
  const threadWindow = useThreadWindow(messages);
  // Older messages mounted above (useThreadWindow) must not move the thread:
  // pinned to the latest message when the student is there, else the same
  // messages stay under their eyes. overflow-anchor is off on the thread, so
  // this is the only correction, the same on every engine (Safari has none).
  const threadMeasureRef = useRef({ firstId: messages[0]?.id ?? null, from: threadWindow.from, height: 0 });
  useLayoutEffect(() => {
    const thread = scrollRef.current;
    const firstId = messages[0]?.id ?? null;
    const previous = threadMeasureRef.current;
    if (thread && previous.firstId === firstId && threadWindow.from < previous.from) {
      if (stickToBottomRef.current) thread.scrollTop = thread.scrollHeight;
      else thread.scrollTop += thread.scrollHeight - previous.height;
    }
    threadMeasureRef.current = { firstId, from: threadWindow.from, height: thread?.scrollHeight ?? 0 };
  });
  // Reading-scroll tracking (phones, onReadingScroll): only scrolls the
  // student drives by hand count — the thread following a streaming reply
  // must not hide the page's tab bar on its own.
  const lastScrollTopRef = useRef(0);
  const scrollTravelRef = useRef(0);
  const scrollIntentAtRef = useRef(0);
  const lastReadingDirectionRef = useRef<"up" | "down" | null>(null);
  // The composer takes its first position without sliding there (the page measures its tab bar after mount).
  const [isDockAnimated, setIsDockAnimated] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setIsDockAnimated(true), 600);
    return () => clearTimeout(timer);
  }, []);

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
  const isRecording = dictation.state === "recording";
  const isTranscribing = dictation.state === "transcribing";

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

  // « Modifier » in a sent message's menu: the text back in the composer, the
  // caret at its end. The focus is taken right away, inside the tap, so a
  // phone opens its keyboard (iOS ignores a focus that comes later).
  const editMessage = useCallback(
    (text: string) => {
      onInputChange(text.slice(0, MAX_MESSAGE_CHARS));
      inputRef.current?.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    },
    [onInputChange]
  );

  const hasConversation = messages.length > 0;
  const hasOptions = showSplitScreenToggle || hasConversation;
  const hasSourcePicker = Boolean(sources && sources.length > 0 && (onToggleSource || onSelectSource));
  const hasMenu = Boolean(onImportFiles || onModeChange || hasSourcePicker);

  // The header ("…") and the composer float over the thread, which dissolves
  // before it reaches them (.copilot-thread-fade, app/globals.css): their
  // measured heights are published on the column as --copilot-header-h /
  // --copilot-composer-h, exactly as on the MedArt Copilot page. On phones
  // the composer floats bottomInset higher (above the page's tab bar), so
  // that much counts as composer too.
  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const header = headerRef.current;
    const dock = dockRef.current;
    const publish = () => {
      column.style.setProperty("--copilot-header-h", `${header?.offsetHeight ?? 0}px`);
      column.style.setProperty("--copilot-composer-h", `${(dock?.offsetHeight ?? 0) + bottomInset}px`);
      // Following along: the latest message stays right above the composer as it grows.
      const thread = scrollRef.current;
      if (thread && stickToBottomRef.current) thread.scrollTop = thread.scrollHeight;
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    if (header) observer.observe(header);
    if (dock) observer.observe(dock);
    return () => observer.disconnect();
  }, [hasOptions, bottomInset]);

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
  }, [input, isRecording]);

  // Desktop popover: closes on a click elsewhere or Escape (the phone sheet is a Dialog, which does both itself).
  useEffect(() => {
    if (!menuOpen || isCompactMenu) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || plusButtonRef.current?.contains(target))) return;
      setMenuOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      plusButtonRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, isCompactMenu]);

  function setMessagesRef(node: HTMLDivElement | null) {
    if (node !== scrollRef.current) {
      // A new thread (or none): reading-scroll tracking starts over with it.
      lastScrollTopRef.current = node?.scrollTop ?? 0;
      scrollTravelRef.current = 0;
      lastReadingDirectionRef.current = null;
    }
    scrollRef.current = node;
    containerRef(node);
  }

  function markScrollIntent() {
    scrollIntentAtRef.current = Date.now();
  }

  function reportReadingScroll(direction: "up" | "down") {
    if (lastReadingDirectionRef.current === direction) return;
    lastReadingDirectionRef.current = direction;
    onReadingScroll?.(direction);
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const distanceFromBottom = el.scrollHeight - top - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 120;
    setShowJumpToLatest(distanceFromBottom > 300);

    if (onReadingScroll) {
      const delta = top - lastScrollTopRef.current;
      // Travel adds up while the direction holds; a turn starts it over.
      scrollTravelRef.current = delta * scrollTravelRef.current >= 0 ? scrollTravelRef.current + delta : delta;
      // A touch, wheel or momentum fling within the last moment: the student is scrolling, not the stream.
      const byHand = Date.now() - scrollIntentAtRef.current < 1200;
      if (top <= 8) reportReadingScroll("up");
      // Not within the last screenful's end: hiding there would shrink the thread under the student's eyes.
      else if (byHand && scrollTravelRef.current > READING_SCROLL_TRAVEL && distanceFromBottom > 160) reportReadingScroll("down");
      else if (byHand && scrollTravelRef.current < -READING_SCROLL_TRAVEL) reportReadingScroll("up");
    }
    lastScrollTopRef.current = top;
  }

  function jumpToLatest() {
    stickToBottomRef.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }

  const canSend = input.trim().length > 0 && input.length <= MAX_MESSAGE_CHARS && !isBusy && !isTranscribing;

  function submit() {
    if (!canSend || isRecording) return;
    haptic();
    stickToBottomRef.current = true;
    dictationBaseRef.current = "";
    onSend();
  }

  function sendPrompt(prompt: string) {
    if (isBusy) return;
    haptic();
    stickToBottomRef.current = true;
    if (onSendPrompt) onSendPrompt(prompt);
    else onInputChange(prompt);
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function handleCopy(messageId: string, text: string) {
    if (!navigator.clipboard) return;
    haptic();
    navigator.clipboard
      .writeText(readableReply(text))
      .then(() => {
        setCopiedMessageId(messageId);
        if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 1500);
      })
      .catch(() => {});
  }

  function handleSaveToNotes(messageId: string, content: string) {
    haptic();
    onSaveToNotes?.(readableReply(content));
    setSavedMessageId(messageId);
    setTimeout(() => setSavedMessageId((prev) => (prev === messageId ? null : prev)), 1500);
  }

  function handleReadAloud(messageId: string, content: string) {
    haptic();
    if (speakingId === messageId) {
      stopSpeaking();
      return;
    }
    const result = speak(messageId, readableReply(content), language, () =>
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
      const content = (message.role === "assistant" ? readableReply(stripReasoning(message.content)) : message.content).trim();
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

  function toggleMenu() {
    haptic();
    setMenuView("root");
    setMenuOpen((prev) => !prev);
  }

  const contextCount = selectedSourceIds ? selectedSourceIds.size : sourceCount;
  const activeMode = CHAT_MODE_OPTIONS.find((option) => option.id === mode) ?? CHAT_MODE_OPTIONS[0];
  const ArmedModeIcon = activeMode.icon;
  const useRichRenderer = Boolean(citationSources);
  const isLongCourse = sourceTextLength !== undefined && sourceTextLength > CHAT_MAX_CONTEXT_CHARS;
  const welcomeLine =
    contextCount > 0
      ? language === "fr"
        ? `Je réponds à partir de ${contextCount === 1 ? "ta source" : `tes ${contextCount} sources`}, citations à l'appui.`
        : `I answer from your ${contextCount === 1 ? "source" : `${contextCount} sources`}, with citations.`
      : language === "fr"
        ? "Ouvre un cours, ou ajoute-en un avec +, et je réponds à partir de tes sources."
        : "Open a course, or add one with +, and I'll answer from your sources.";

  const menuBodyProps: ComposerMenuProps = {
    view: menuView,
    onViewChange: setMenuView,
    onClose: () => setMenuOpen(false),
    onImport: onImportFiles ? () => fileInputRef.current?.click() : undefined,
    mode,
    onModeChange,
    sources,
    selectedSourceIds,
    onToggleSource,
    activeSourceId,
    onSelectSource,
    isLongCourse,
  };

  return (
    <div
      // No canvas of its own: it sits on the module page's .copilot-canvas, one surface with Sources and Studio.
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setIsDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <div ref={columnRef} className="relative flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        {/* The living light rising from the composer — behind the welcome, the thread and the dock (CopilotParts). */}
        <CopilotAmbience variant={!hasConversation && !isHistoryLoading ? "welcome" : "thread"} active={isBusy} />

        {/* No title bar: one quiet "…" holds the conversation's options. */}
        {hasOptions && (
          <div ref={headerRef} className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-2 pt-2 sm:px-3">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Options de la conversation"
                      className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-[background-color,color,transform] duration-150 hover:bg-black/[0.06] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 active:scale-90 dark:text-white/60 dark:hover:bg-white/[0.1] dark:hover:text-white"
                    >
                      <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">Options de la conversation</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-72">
                {showSplitScreenToggle && (
                  <DropdownMenuItem onSelect={onToggleSplitScreen}>
                    <Columns2 className="h-4 w-4" />
                    {isSplitScreen ? "Quitter l'écran partagé" : "Écran partagé Chat + Studio"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={handleExportConversation} disabled={!hasConversation}>
                  <Download className="h-4 w-4" />
                  Exporter la conversation (.md)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={onClearHistory}
                  disabled={!hasConversation}
                  className="hover:translate-x-0 focus:bg-rose-500/[0.07] focus:text-rose-700 data-[highlighted]:bg-rose-500/[0.07] data-[highlighted]:text-rose-700 dark:focus:bg-rose-500/[0.12] dark:focus:text-rose-300 dark:data-[highlighted]:bg-rose-500/[0.12] dark:data-[highlighted]:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  Nouvelle conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {!hasConversation ? (
          isHistoryLoading ? (
            <div className="flex-1" aria-busy="true" />
          ) : (
            // The welcome — the same screen as the MedArt Copilot's, in the pane's narrower headline size.
            <CopilotWelcome
              size="pane"
              firstName={firstName}
              subtitle={welcomeLine}
              notice={
                isLongCourse && (
                  <p className="copilot-rise mx-auto mt-3 flex max-w-md items-start justify-center gap-1.5 text-balance text-[13px] leading-snug text-amber-700/90 dark:text-amber-300/80" style={{ "--rise": 3 } as CSSProperties}>
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {language === "fr"
                      ? "Ce cours est très long : je me concentre sur ses passages les plus pertinents."
                      : "This course is very long: I focus on its most relevant passages."}
                  </p>
                )
              }
              suggestions={contextCount > 0 ? STARTER_PROMPTS : []}
              onSuggestion={sendPrompt}
              disabled={isBusy}
            />
          )
        ) : (
          // motion-swap: the thread rises in where the welcome was (its
          // AnimatePresence mounts with it, so the bubbles' own entrance is skipped).
          <div className="motion-swap relative min-h-0 w-full max-w-full flex-1">
            {/* overflow-x-hidden + touch-action pan-y: a long token, a wide table or a stray sideways swipe never moves the thread. */}
            <div
              ref={setMessagesRef}
              onScroll={handleScroll}
              onTouchStart={markScrollIntent}
              onTouchMove={markScrollIntent}
              onWheel={markScrollIntent}
              // overflow-anchor: none — older messages mounting above are compensated by hand (threadMeasureRef).
              className="copilot-thread-fade h-full w-full max-w-full overflow-y-auto overflow-x-hidden overscroll-none [-ms-overflow-style:none] [overflow-anchor:none] [scrollbar-width:none] [touch-action:pan-y_pinch-zoom] [&::-webkit-scrollbar]:hidden"
            >
              <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5 px-3 pb-[calc(var(--copilot-composer-h,0px)+1rem)] pt-[calc(var(--copilot-header-h,0px)+1rem)] sm:px-5 md:px-6 md:pb-[calc(var(--copilot-composer-h,0px)+1.5rem)] md:pt-[calc(var(--copilot-header-h,0px)+1.5rem)]">
                <AnimatePresence initial={false}>
                  {messages.slice(threadWindow.from).map((message, offset) => {
                    const index = threadWindow.from + offset;
                    // History (mounted progressively above) simply appears; a message that just arrived rises in.
                    const entrance = index < threadWindow.animateFrom ? false : { opacity: 0, y: 16 };
                    if (message.role === "user") {
                      return (
                        <motion.div
                          key={message.id}
                          initial={entrance}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                          className="flex w-full min-w-0 justify-end"
                        >
                          <div className="flex min-w-0 max-w-[88%] flex-col items-end gap-1.5 sm:max-w-[75%]">
                            {/* A tap opens its menu — copy, edit (components/assistant/UserMessageBubble.tsx). */}
                            <UserMessageBubble text={message.content} dir={dominantDirection(message.content) ?? "auto"} onEdit={editMessage} />
                          </div>
                        </motion.div>
                      );
                    }

                    const cleanContent = stripReasoning(message.content);
                    const isLive = index === messages.length - 1 && isBusy;
                    const isPending = cleanContent.trim().length === 0;
                    // A settled reply with no text has nothing to show.
                    if (isPending && !isLive) return null;
                    const isError = !isPending && isErrorReply(cleanContent);
                    const isSpeaking = speakingId === message.id;

                    return (
                      <motion.div
                        key={message.id}
                        initial={entrance}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                        className="flex w-full min-w-0 flex-col items-start"
                      >
                        {/* Edge-to-edge on phones: no avatar column there. */}
                        <div className="flex w-full min-w-0 items-start gap-2.5">
                          <div className="hidden sm:block">
                            <AssistantAvatar isPending={isPending} />
                          </div>
                          <div className="min-w-0 max-w-full flex-1 pt-0.5">
                            {isPending ? (
                              <TypingIndicator label={pendingThinkingLabel ? `Analyse de « ${pendingThinkingLabel} »…` : undefined} />
                            ) : isError ? (
                              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/80 px-3.5 py-3 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                <div className="min-w-0 flex-1 space-y-2">
                                  <p className="break-words leading-relaxed">{cleanContent.trimStart().replace(/^⚠️\s*/, "")}</p>
                                  {onRegenerate && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        haptic();
                                        onRegenerate(message.id);
                                      }}
                                      disabled={isBusy}
                                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-500/15 px-3.5 text-sm font-medium text-amber-900 transition-[transform,background-color] hover:bg-amber-500/25 active:scale-95 disabled:opacity-50 dark:text-amber-100"
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" /> Réessayer
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : useRichRenderer ? (
                              <ChatRichMarkdown
                                content={cleanContent}
                                citationSources={citationSources ?? []}
                                onOpenSource={onOpenCitationSource}
                                isStreaming={isLive}
                                className={PHONE_REPLY_TEXT}
                              />
                            ) : (
                              <StreamedMarkdown content={cleanContent} isStreaming={isLive} className={PHONE_REPLY_TEXT} />
                            )}
                          </div>
                        </div>

                        {!isPending && !isError && !isLive && (
                          <div className="w-full min-w-0 sm:pl-[3.125rem]">
                            <div className="-ml-2.5 mt-1 flex flex-row items-center gap-1">
                              {canReadAloud && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => handleReadAloud(message.id, cleanContent)}
                                      aria-label={isSpeaking ? tAssistant("stopSpeaking", language) : tAssistant("speak", language)}
                                      aria-pressed={isSpeaking}
                                      className={cn(
                                        COPILOT_ACTION_BUTTON_CLASSES,
                                        isSpeaking &&
                                          "bg-sky-500/10 text-sky-600 hover:bg-sky-500/15 hover:text-sky-600 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:bg-sky-400/15 dark:hover:text-sky-300"
                                      )}
                                    >
                                      {isSpeaking ? <Square className="h-4 w-4 animate-pulse fill-current" /> : <Volume2 strokeWidth={2} className="h-5 w-5" />}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>{isSpeaking ? tAssistant("stopSpeaking", language) : tAssistant("speak", language)}</TooltipContent>
                                </Tooltip>
                              )}

                              <Tooltip open={copiedMessageId === message.id ? true : undefined}>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(message.id, cleanContent)}
                                    aria-label={tAssistant("copyMarkdown", language)}
                                    className={COPILOT_ACTION_BUTTON_CLASSES}
                                  >
                                    {copiedMessageId === message.id ? (
                                      <Check strokeWidth={2} className="h-5 w-5 text-sky-500" />
                                    ) : (
                                      <Copy strokeWidth={2} className="h-5 w-5" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{copiedMessageId === message.id ? tAssistant("copied", language) : tAssistant("copyMarkdown", language)}</TooltipContent>
                              </Tooltip>

                              {onSaveToNotes && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveToNotes(message.id, cleanContent)}
                                      aria-label={savedMessageId === message.id ? tAssistant("savedToNotes", language) : tAssistant("saveToNotes", language)}
                                      className={COPILOT_ACTION_BUTTON_CLASSES}
                                    >
                                      {savedMessageId === message.id ? (
                                        <Check strokeWidth={2} className="h-5 w-5 text-sky-500" />
                                      ) : (
                                        <NotebookPen strokeWidth={2} className="h-5 w-5" />
                                      )}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>{savedMessageId === message.id ? tAssistant("savedToNotes", language) : tAssistant("saveToNotes", language)}</TooltipContent>
                                </Tooltip>
                              )}

                              {onRegenerate && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        haptic();
                                        onRegenerate(message.id);
                                      }}
                                      disabled={isBusy}
                                      aria-label={tAssistant("regenerateResponse", language)}
                                      className={COPILOT_ACTION_BUTTON_CLASSES}
                                    >
                                      <RefreshCw strokeWidth={2} className="h-5 w-5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tAssistant("regenerateResponse", language)}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </div>

            {/* Back to the latest message: a round arrow above the composer, filled sky while a reply streams. Centred with inset-x-0 + mx-auto: framer-motion owns its transform. */}
            <AnimatePresence>
              {showJumpToLatest && (
                <motion.button
                  type="button"
                  onClick={() => {
                    haptic();
                    jumpToLatest();
                  }}
                  aria-label={isBusy ? tAssistant("newResponseInProgress", language) : tAssistant("backToBottom", language)}
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "touch-target absolute inset-x-0 bottom-[calc(var(--copilot-composer-h,0px)+0.75rem)] z-10 mx-auto flex h-10 w-10 items-center justify-center rounded-full border shadow-glass transition-colors dark:shadow-glass-dark",
                    isBusy
                      ? "border-sky-500/30 bg-sky-600 text-white hover:bg-sky-700"
                      : "border-black/[0.06] bg-white/95 text-foreground hover:bg-white dark:border-white/10 dark:bg-[#16191d]/95 dark:hover:bg-[#1b1f24]"
                  )}
                >
                  <ArrowDown strokeWidth={2} className="h-[18px] w-[18px]" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}

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

        {/* The composer floats on the canvas — no bar behind it; the thread dissolves before it gets there. */}
        {/* Phones: lifted above the page's glass tab bar (bottomInset), sliding down with it when it hides — a transform, so nothing reflows. */}
        <div
          ref={dockRef}
          className={cn("absolute inset-x-0 bottom-0 z-20 pb-3 pt-4 md:pb-4", isDockAnimated && "transition-transform duration-300 ease-out motion-reduce:transition-none")}
          style={bottomInset ? { transform: `translateY(-${bottomInset}px)` } : { transform: "translateY(0px)" }}
        >
          {input.length > MAX_MESSAGE_CHARS * 0.85 && (
            <span
              className={cn(
                "pointer-events-none absolute right-7 top-0 text-[11px] tabular-nums sm:right-8",
                input.length > MAX_MESSAGE_CHARS ? "font-semibold text-destructive" : "text-muted-foreground"
              )}
            >
              {input.length}/{MAX_MESSAGE_CHARS}
            </span>
          )}
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              data-tour="ws-chat"
              className={COPILOT_HUB_CLASSES}
            >
              {/* An answer mode other than Standard shows as one chip, like the Copilot's quick actions; × goes back to Standard. */}
              <AnimatePresence initial={false}>
                {onModeChange && mode !== "standard" && (
                  <motion.div
                    key="armed-mode"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-5 pt-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 py-1 pl-2.5 pr-1 text-xs font-semibold text-white">
                        <ArmedModeIcon className="h-3.5 w-3.5" />
                        {activeMode.label}
                        <button
                          type="button"
                          onClick={() => onModeChange("standard")}
                          aria-label="Revenir au mode Standard"
                          className="touch-target relative flex h-5 w-5 items-center justify-center rounded-full transition-colors hover:bg-white/20 active:bg-white/25"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex w-full items-end gap-1.5 p-3.5">
                {hasMenu && (
                  <button
                    ref={plusButtonRef}
                    type="button"
                    onClick={toggleMenu}
                    disabled={isRecording}
                    aria-label="Outils du Co-pilote"
                    aria-haspopup="dialog"
                    aria-expanded={menuOpen}
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-800 transition-[transform,background-color,color] duration-150 active:scale-90 dark:text-white",
                      isRecording ? "cursor-not-allowed opacity-40" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
                    )}
                  >
                    <Plus strokeWidth={2} className={cn("h-6 w-6 transition-transform duration-200", menuOpen && "rotate-45")} />
                  </button>
                )}

                {isRecording ? (
                  <VoiceMeter stream={dictation.stream} label={tAssistant("listening", language)} />
                ) : (
                  // text-[16px] (never smaller): iOS Safari zooms the page when a field under 16px is focused.
                  <textarea
                    ref={inputRef}
                    value={input}
                    rows={1}
                    maxLength={MAX_MESSAGE_CHARS + 200}
                    onChange={(e) => onInputChange(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    onFocus={() => onInputFocusChange?.(true)}
                    onBlur={() => onInputFocusChange?.(false)}
                    enterKeyHint="send"
                    placeholder={isTranscribing ? "Transcription…" : activeMode.placeholder}
                    aria-label="Message au Co-pilote"
                    className="scrollbar-hide min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2 py-[10px] text-[16px] leading-6 text-foreground outline-none transition-[height] duration-100 ease-out placeholder:truncate placeholder:text-slate-400 focus:ring-0 dark:placeholder:text-white/40"
                  />
                )}

                <button
                  type="button"
                  title={dictation.supported ? tAssistant("startDictation", language) : undefined}
                  onClick={() => {
                    haptic();
                    if (dictation.state === "idle") dictationBaseRef.current = input;
                    dictation.toggle();
                  }}
                  disabled={!dictation.supported || isTranscribing}
                  aria-label={isRecording ? tAssistant("stopDictation", language) : tAssistant("startDictation", language)}
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-90",
                    isRecording ? "bg-sky-600 text-white shadow-[0_0_0_4px_rgba(14,165,233,0.18)]" : "text-slate-800 hover:bg-black/[0.06] dark:text-white dark:hover:bg-white/[0.1]",
                    (!dictation.supported || isTranscribing) && "cursor-not-allowed opacity-40"
                  )}
                >
                  {isTranscribing ? (
                    <RefreshCw strokeWidth={2} className="h-5 w-5 animate-spin" />
                  ) : isRecording ? (
                    <Square className="h-[18px] w-[18px] fill-current" />
                  ) : (
                    <Mic strokeWidth={2} className="h-6 w-6" />
                  )}
                </button>

                {/* One fixed slot: Send once there is something to send, a spinner while the reply streams, a quiet arrow otherwise. They swap in place and the row never reflows. */}
                <div className="relative h-11 w-11 shrink-0">
                  <AnimatePresence initial={false}>
                    {isBusy ? (
                      <motion.span
                        key="busy"
                        role="status"
                        aria-label="Réponse en cours…"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/[0.06] text-slate-800 dark:bg-white/[0.12] dark:text-white"
                      >
                        <Loader2 strokeWidth={2.25} className="h-5 w-5 animate-spin" />
                      </motion.span>
                    ) : canSend && !isRecording ? (
                      <motion.button
                        key="send"
                        type="submit"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        whileTap={{ scale: 0.9 }}
                        aria-label="Envoyer"
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_8px_20px_-8px_rgba(14,165,233,0.75)]"
                      >
                        <ArrowUp strokeWidth={2.25} className="h-6 w-6" />
                      </motion.button>
                    ) : (
                      <motion.button
                        key="idle"
                        type="button"
                        disabled
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        aria-label="Envoyer"
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/[0.06] text-slate-800 dark:bg-white/[0.12] dark:text-white"
                      >
                        <ArrowUp strokeWidth={2.25} className="h-6 w-6 opacity-40" />
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Desktop: the "+" menu as a popover above the composer (phones: the sheet below). */}
              <AnimatePresence>
                {menuOpen && !isCompactMenu && (
                  <motion.div
                    ref={menuRef}
                    role="dialog"
                    aria-label="Outils du Co-pilote"
                    initial={{ opacity: 0, y: 12, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.14, ease: "easeIn" } }}
                    transition={{ type: "spring", stiffness: 480, damping: 32, mass: 0.7 }}
                    style={{ transformOrigin: "bottom left" }}
                    className="absolute bottom-full left-0 z-50 mb-3 w-full max-w-[20rem] overflow-hidden rounded-3xl border border-black/[0.06] bg-white/90 p-1.5 text-popover-foreground shadow-[0_24px_60px_-18px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#14171b]/90 dark:shadow-[0_28px_70px_-18px_rgba(0,0,0,0.85)]"
                  >
                    <div className="max-h-[min(26rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain">
                      <ComposerMenuBody {...menuBodyProps} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {onImportFiles && (
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
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Phones: the same menu as a bottom sheet (swipe down or tap outside to dismiss). */}
      <Dialog open={menuOpen && isCompactMenu} onOpenChange={setMenuOpen}>
        <DialogContent className="p-0 sm:max-w-sm sm:p-0">
          <div className="px-4 pb-2 pr-12 pt-7">
            <DialogTitle className="text-base font-bold">Outils du Co-pilote</DialogTitle>
            <DialogDescription className="sr-only">Ajouter une source, choisir le mode de réponse et les sources que le Co-pilote lit.</DialogDescription>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto overscroll-contain px-2 pb-4">
            <ComposerMenuBody {...menuBodyProps} />
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-[32px] border-2 border-dashed border-sky-400/70 bg-white/80 px-6 text-center text-sky-800 backdrop-blur-xl dark:border-sky-400/50 dark:bg-black/70 dark:text-sky-100"
          >
            <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_10px_22px_-10px_rgba(14,165,233,0.85)]">
              <FileUp className="h-7 w-7" strokeWidth={1.75} />
            </span>
            <p className="text-sm font-semibold">Dépose ton polycop pour l&apos;ajouter aux sources</p>
            <p className="text-xs opacity-80">PDF, DOCX, PPTX, TXT — max {MAX_UPLOAD_FILE_MB} Mo</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
