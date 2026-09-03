"use client";

import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  BrainCircuit,
  Camera,
  Check,
  Copy,
  FileText,
  ImageIcon,
  Mic,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Send,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/generate-id";
import { useSidebarState } from "@/providers/SidebarProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant } from "@/lib/translations/assistant";
import { useAuth } from "@/providers/AuthProvider";
import { useAssistantConversations, type ChatMessage } from "@/hooks/useAssistantConversations";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { ConversationSidebar, ConversationSidebarCollapsedToggle } from "@/components/assistant/ConversationSidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

function NovaOrb() {
  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center sm:h-24 sm:w-24" aria-hidden="true">
      {/* Soft ambient bloom behind the glyph — same "brand glow, not a flat icon tile" language as AssistantAvatar/the composer's focus ring, so the very first thing a student sees on an empty thread already reads as MedArt rather than a generic placeholder icon. */}
      <span className="absolute inset-1 rounded-full bg-emerald-400/25 blur-xl" />
      <div className="relative flex h-full w-full animate-float items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 shadow-[0_0_40px_-10px_rgba(16,185,129,0.5)] dark:text-emerald-400">
        <BrainCircuit className="h-10 w-10 sm:h-12 sm:w-12" />
      </div>
    </div>
  );
}

function EmptyState({ firstName }: { firstName: string }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-10 text-center sm:gap-8">
      <video
        aria-hidden
        autoPlay
        muted
        loop
        playsInline
        className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-10 blur-sm"
      >
        <source src="/ai-robot-doctor.mp4" type="video/mp4" />
      </video>

      <NovaOrb />
      <div className="max-w-xl space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-4xl">
          Hi {firstName}, what&apos;s on your mind?
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
          Besoin d&apos;aide pour organiser tes révisions, comprendre un module compliqué, ou juste souffler un peu ?
          Je suis là.
        </p>
      </div>
    </div>
  );
}

/** `isPending`: true only while THIS message is actively streaming — the animated ping is a "generating now" signal, not a permanent decoration, so it stops once the reply is complete (a static dot per finished message would just be visual noise on a long scrollback). */
function AssistantAvatar({ isPending = false }: { isPending?: boolean }) {
  return (
    <div className="relative mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
      <BrainCircuit className="h-5 w-5" />
      <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
        {isPending && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 transition-shadow duration-300",
            isPending && "shadow-[0_0_6px_2px_rgba(52,211,153,0.6)]"
          )}
        />
      </span>
    </div>
  );
}

/** Streaming placeholder shown before the first token arrives — paired with a short reassurance label rather than a bare spinner, so a student watching a blank bubble knows the assistant is working, not stuck. */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-muted-foreground">MedArt réfléchit…</span>
    </div>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground/90 prose-headings:font-semibold prose-headings:text-foreground prose-p:my-2 prose-strong:text-foreground prose-ul:my-2 prose-li:my-0.5 prose-code:text-foreground prose-pre:bg-muted/60 prose-a:text-emerald-600 dark:prose-invert dark:prose-a:text-emerald-400 sm:prose-base [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="animate-in fade-in duration-500">{children}</p>,
          li: ({ children }) => <li className="animate-in fade-in duration-500">{children}</li>,
          h1: ({ children }) => <h1 className="animate-in fade-in duration-500">{children}</h1>,
          h2: ({ children }) => <h2 className="animate-in fade-in duration-500">{children}</h2>,
          h3: ({ children }) => <h3 className="animate-in fade-in duration-500">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="animate-in fade-in border-l-emerald-400 duration-500 dark:border-l-emerald-500/60">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 animate-in fade-in overflow-x-auto rounded-lg border border-border duration-500">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-emerald-50 dark:bg-emerald-950/40">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/60 px-3 py-2 align-top text-muted-foreground last:border-b-0">
              {children}
            </td>
          ),
          tr: ({ children }) => <tr className="animate-in fade-in even:bg-muted/40 duration-500">{children}</tr>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ChatToolbar({
  messageId,
  content,
  onRefresh,
  onDelete,
}: {
  messageId: string;
  content: string;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { language } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [reported, setReported] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="mt-1.5 flex flex-row items-center gap-2 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => onRefresh(messageId)} aria-label={tAssistant("regenerate", language)} className="flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-emerald-500">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{tAssistant("regenerateResponse", language)}</TooltipContent>
      </Tooltip>

      <Tooltip open={copied ? true : undefined}>
        <TooltipTrigger asChild>
          <button type="button" onClick={handleCopy} aria-label={tAssistant("copy", language)} className="flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-emerald-500">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? tAssistant("copied", language) : tAssistant("copy", language)}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setFeedback((prev) => (prev === "up" ? null : "up"))}
            aria-label={tAssistant("goodResponse", language)}
            className={cn("flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-emerald-500", feedback === "up" && "text-emerald-500")}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{tAssistant("goodResponse", language)}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setFeedback((prev) => (prev === "down" ? null : "down"))}
            aria-label={tAssistant("badResponse", language)}
            className={cn("flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-emerald-500", feedback === "down" && "text-rose-500")}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{tAssistant("badResponse", language)}</TooltipContent>
      </Tooltip>

      <div className="relative">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="Plus d'options"
              className="flex h-10 w-10 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-emerald-500"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Plus d&apos;options</TooltipContent>
        </Tooltip>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-glass dark:shadow-glass-dark"
            >
              <button
                type="button"
                onClick={() => { setReported(true); setMenuOpen(false); }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-foreground transition-colors hover:bg-accent"
              >
                {reported ? tAssistant("reported", language) : tAssistant("reportResponse", language)}
              </button>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); onDelete(messageId); }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> Supprimer cette réponse
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const ChatBubble = memo(function ChatBubble({
  message,
  onRefresh,
  onDelete,
}: {
  message: ChatMessage;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    // An image/document attachment is stored as a small JSON envelope inside
    // `content` (see decodeAttachmentEnvelope above) — decode it back into an
    // actual thumbnail/file chip instead of showing the raw JSON string.
    const attachment = decodeAttachmentEnvelope(message.content);

    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex w-full justify-end"
      >
        <div className="flex max-w-[90%] flex-col items-end gap-2 sm:max-w-[75%]">
          {attachment?.kind === IMAGE_ENVELOPE_KIND && (
            <img
              src={attachment.dataUrl}
              alt={attachment.fileName ?? "Image envoyée"}
              className="max-h-64 w-auto rounded-2xl rounded-br-sm border border-emerald-500/30 object-cover shadow-sm"
            />
          )}
          {attachment?.kind === DOCUMENT_ENVELOPE_KIND && (
            <div className="flex items-center gap-2 rounded-2xl rounded-br-sm border border-emerald-500/30 bg-emerald-50/80 px-3.5 py-2.5 text-emerald-800 shadow-sm dark:bg-emerald-950/30 dark:text-emerald-200">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="max-w-[14rem] truncate text-xs font-medium sm:text-sm">{attachment.fileName}</span>
            </div>
          )}
          {(!attachment || attachment.caption) && (
            <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm border border-black/5 bg-white px-4 py-3 text-sm leading-relaxed text-gray-900 shadow-sm sm:text-[15px]">
              {attachment ? attachment.caption : message.content}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  const isPending = message.content.trim().length === 0;
  // The stream reports failures by flushing a "⚠️ …" line into the same
  // content field (see streamAssistantReply) rather than a separate error
  // field — purely a rendering fork on that already-existing text, no new
  // state: a failed reply gets its own unmistakable look and a one-click
  // retry instead of silently reading like any other answer.
  const isError = !isPending && message.content.trimStart().startsWith("⚠️");

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex w-full flex-col items-start"
    >
      <div className="flex w-full items-start gap-2">
        <AssistantAvatar isPending={isPending} />
        <div className="min-w-0 flex-1 pt-0.5">
          {isPending ? (
            <TypingIndicator />
          ) : isError ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/80 px-3.5 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="leading-relaxed">{message.content.trimStart().replace(/^⚠️\s*/, "")}</p>
                <button
                  type="button"
                  onClick={() => onRefresh(message.id)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-500/25 dark:text-amber-100"
                >
                  <RefreshCw className="h-3 w-3" /> Réessayer
                </button>
              </div>
            </div>
          ) : (
            <AssistantMarkdown content={message.content} />
          )}
        </div>
      </div>
      {!isPending && !isError && (
        <div className="pl-9">
          <ChatToolbar messageId={message.id} content={message.content} onRefresh={onRefresh} onDelete={onDelete} />
        </div>
      )}
    </motion.div>
  );
});

interface MinimalSpeechRecognitionResult {
  0: { transcript: string };
  isFinal: boolean;
}
interface MinimalSpeechRecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: MinimalSpeechRecognitionResult };
}
interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => MinimalSpeechRecognition;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ATTACHMENT_ITEMS = [
  { kind: "image" as const, icon: ImageIcon, label: "Importer une image" },
  { kind: "pdf" as const, icon: FileText, label: "Importer un PDF" },
  { kind: "camera" as const, icon: Camera, label: "Prendre une photo" },
];

// --- Image/document attachment envelopes -----------------------------------
// ChatMessage (hooks/useAssistantConversations.ts, out of this mission's
// file perimeter) types `content` as a plain string — it's also what's
// persisted verbatim to localStorage. Rather than widening that shared type,
// an attachment is encoded as a small JSON envelope INSIDE that same string
// field: opaque to the hook (still just a string to persist), decoded only
// here in the page that wrote it. A `kind` discriminant + JSON.parse guarded
// by a leading "{" check keeps this both cheap on the hot path (ordinary text
// messages never even reach JSON.parse) and safe against pre-existing plain
// text conversations already sitting in a student's localStorage.
const IMAGE_ENVELOPE_KIND = "medart-image-attachment";
const DOCUMENT_ENVELOPE_KIND = "medart-document-attachment";

interface ImageAttachmentEnvelope {
  kind: typeof IMAGE_ENVELOPE_KIND;
  dataUrl: string;
  fileName?: string;
  caption: string;
}

interface DocumentAttachmentEnvelope {
  kind: typeof DOCUMENT_ENVELOPE_KIND;
  fileName: string;
  caption: string;
  extractedText: string;
}

type AttachmentEnvelope = ImageAttachmentEnvelope | DocumentAttachmentEnvelope;

// encodeImageMessage removed — nothing sends a NEW image message anymore
// (handleImageFileChosen refuses up front). decodeAttachmentEnvelope below
// still recognizes IMAGE_ENVELOPE_KIND so an OLD image message already
// sitting in a student's saved history still renders correctly.

function encodeDocumentMessage(payload: Omit<DocumentAttachmentEnvelope, "kind">): string {
  return JSON.stringify({ kind: DOCUMENT_ENVELOPE_KIND, ...payload });
}

function decodeAttachmentEnvelope(content: string): AttachmentEnvelope | null {
  if (!content.startsWith("{")) return null; // fast bail — the overwhelming majority of messages are plain text
  try {
    const parsed = JSON.parse(content);
    if (parsed?.kind === IMAGE_ENVELOPE_KIND && typeof parsed.dataUrl === "string") return parsed as ImageAttachmentEnvelope;
    if (parsed?.kind === DOCUMENT_ENVELOPE_KIND && typeof parsed.extractedText === "string") return parsed as DocumentAttachmentEnvelope;
  } catch {
    // Not JSON at all — an ordinary text message that happens to start with "{".
  }
  return null;
}

const DEFAULT_IMAGE_PROMPT = "Analyse cette image et explique-moi ce qu'elle montre.";

/** What actually gets POSTed to /api/assistant for a given message's content — decodes an attachment envelope back into the {message, image?, document?} shape the route expects, or passes plain text straight through. Shared by the normal send path and "Régénérer" (which must reconstruct the ORIGINAL request for whichever user turn it's retrying, not resend a raw JSON envelope as if it were text). */
function buildOutgoingPayload(content: string): {
  message: string;
  image?: { dataUrl: string; fileName?: string };
  document?: { fileName: string; text: string };
} {
  const envelope = decodeAttachmentEnvelope(content);
  if (!envelope) return { message: content };
  if (envelope.kind === IMAGE_ENVELOPE_KIND) {
    return { message: envelope.caption || DEFAULT_IMAGE_PROMPT, image: { dataUrl: envelope.dataUrl, fileName: envelope.fileName } };
  }
  return {
    message: envelope.caption || `Voici le contenu du document "${envelope.fileName}" que je viens d'importer — aide-moi à le comprendre.`,
    document: { fileName: envelope.fileName, text: envelope.extractedText },
  };
}

/** Textual stand-in for an attachment message when it appears in `history` (prior turns), instead of re-sending its full payload (an old photo's base64, an old PDF's full extracted text) on every subsequent call — standard chat-app practice: only the CURRENT turn needs the real attachment, older ones just need to stay legible to the model as conversational context. */
function summarizeForHistory(content: string): string {
  const envelope = decodeAttachmentEnvelope(content);
  if (!envelope) return content;
  if (envelope.kind === IMAGE_ENVELOPE_KIND) {
    return `[Image envoyée${envelope.fileName ? ` : ${envelope.fileName}` : ""}]${envelope.caption ? ` ${envelope.caption}` : ""}`;
  }
  return `[Document importé : ${envelope.fileName}]${envelope.caption ? ` ${envelope.caption}` : ""}`;
}

function toHistoryTurns(msgs: ChatMessage[]): HistoryTurn[] {
  return msgs.map((m) => ({ role: m.role, content: summarizeForHistory(m.content) }));
}

// Client-side image resize (Anthropic vision sweet spot, ~1568px long edge)
// removed — the Dashboard Assistant is now free-tier/text-only, and
// handleImageFileChosen no longer calls into any resize path (see its own
// comment). DEFAULT_IMAGE_PROMPT above still has to stay: it's used by
// buildOutgoingPayload to correctly reconstruct a "Régénérer" request for an
// image message a student sent BEFORE this switch, still sitting in their
// saved conversation history.

export default function AssistantPage() {
  const { isDesktopSidebarOpen, toggleDesktopSidebar } = useSidebarState();
  const { language } = useLanguage();
  const auth = useAuth() ?? {};
  const firstName = auth.profile?.fullName?.split(" ")[0] || "Étudiant(e)";
  const { conversations, activeId, hydrated, saveMessages, startNewConversation, selectConversation, deleteConversation } =
    useAssistantConversations(auth.user?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  // Covers the async window between picking a file and the resulting message
  // actually being appended (image resize + the /api/upload extraction round
  // trip for a PDF) — distinct from `isTyping` (the AI reply itself
  // streaming), so the Send button and Enter-to-submit stay blocked for the
  // whole attachment pipeline, not just its final streaming leg.
  const [isAttachmentBusy, setIsAttachmentBusy] = useState(false);
  // Starts closed everywhere (SSR-safe default, matches the server-rendered
  // markup) — below lg the history rail is a mobile drawer that must never
  // cover the chat on first paint. The effect below flips it open on desktop
  // right after mount, once `window.matchMedia` is actually available.
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // Real visualViewport-derived keyboard inset on iOS Safari, which shrinks
  // the visual viewport when the virtual keyboard opens while
  // `window.innerHeight`/100vh do not — Android already gets this for free
  // from the `interactiveWidget: "resizes-content"` viewport meta in
  // app/layout.tsx, but iOS Safari ignores that property. Applied as extra
  // bottom padding on the page's flex column so the composer (pinned at the
  // bottom of that column) stays above the keyboard instead of sliding out
  // of view behind it.
  const keyboardInset = useKeyboardInset();
  // Whether the student is currently scrolled near the latest message.
  // Starts true (a freshly opened/empty thread has nothing to scroll away
  // from). Purely a scroll-position/UI concern — see the effect below and
  // handleScroll for how it's kept in sync.
  const [isAtBottom, setIsAtBottom] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");

  // Guards streamAssistantReply's loop below against setState on an unmounted
  // component — a student can send a message then immediately navigate away
  // (another sidebar page, "Nouvelle conversation") while the reply is still
  // streaming in. Found during a memory-leak audit.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const messagesRef = useRef<ChatMessage[]>([]);
  const isTypingRef = useRef(false);
  
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isTypingRef.current = isTyping; }, [isTyping]);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  // Drawer-vs-column breakpoint for the history rail. Reads matchMedia only
  // inside the effect (client-only, post-mount) rather than during render,
  // so the server-rendered markup and the first client render agree (both
  // "closed") and React never complains about a hydration mismatch. Also
  // keeps listening for the min-width match to flip — e.g. rotating a
  // tablet across the 1024px line — not just the one-time value at mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(min-width: 1024px)");
    setIsHistoryOpen(mql.matches);
    function handleChange(e: MediaQueryListEvent) {
      setIsHistoryOpen(e.matches);
    }
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  // Auto-follows new content only while the student is already near the
  // latest message. Without this guard, every streamed chunk (each is a
  // `messages` update — see flush() in streamAssistantReply) would yank
  // them back down even after they deliberately scrolled up mid-generation
  // to re-read something earlier. When they've scrolled away, the floating
  // "revenir en bas" button (rendered below) takes over instead.
  useEffect(() => {
    if (!isAtBottom) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isAtBottom]);

  /** Tracks proximity to the bottom of the scrollable message list — feeds both the auto-follow effect above and the floating "revenir en bas" button's visibility. A generous 150px threshold so it doesn't flicker on tiny scroll jitters. */
  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 150);
  }

  function scrollToBottom() {
    setIsAtBottom(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  useEffect(() => {
    return () => { recognitionRef.current?.stop(); };
  }, []);

  useEffect(() => {
    if (!isAttachmentMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (attachmentMenuRef.current?.contains(target) || attachmentButtonRef.current?.contains(target)) return;
      setIsAttachmentMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAttachmentMenuOpen]);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    const active = conversations.find((c) => c.id === activeId);
    if (active) setMessages(active.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (isTyping) return;
    saveMessages(messages);
  }, [messages, isTyping, saveMessages]);

  function handleNewConversation() {
    setMessages([]);
    setInput("");
    setIsAtBottom(true);
    startNewConversation();
  }

  function handleSelectConversation(id: string) {
    const found = selectConversation(id);
    if (found) {
      setMessages(found.messages);
      setIsAtBottom(true);
    }
  }

  function handleDeleteConversation(id: string) {
    const wasActive = id === activeId;
    deleteConversation(id);
    if (wasActive) setMessages([]);
  }

  const streamAssistantReply = useCallback(async (
    userText: string,
    historyForRequest: HistoryTurn[],
    attachments?: { image?: { dataUrl: string; fileName?: string }; document?: { fileName: string; text: string } },
    bypassCache?: boolean
  ) => {
    const assistantId = generateId();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    setIsTyping(true);

    let rafId: number | null = null;
    let latestText = "";

    function flush(text: string) {
      if (!isMountedRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)));
    }

    function scheduleFlush() {
      if (rafId !== null || !isMountedRef.current) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        flush(latestText);
      });
    }

    function cancelScheduledFlush() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    try {
      // Dashboard Assistant — free-tier only (see app/api/dashboard-assistant/
      // route.ts), never app/api/assistant/route.ts (paid, Sonnet/Haiku).
      // That route rejects `image` explicitly (the free model chain is
      // verified text-only, no vision) rather than silently ignoring it —
      // sendImageMessage below still exists in the UI, but a sent image now
      // surfaces that route's honest 400 through this same catch block,
      // same "⚠️ …" bubble convention as any other failure.
      const res = await fetch("/api/dashboard-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          history: historyForRequest,
          language,
          ...(attachments?.image ? { image: attachments.image } : {}),
          ...(attachments?.document ? { document: attachments.document } : {}),
          ...(bypassCache ? { bypassCache: true } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? tAssistant("assistantNoReplyError", language));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        latestText = fullText;
        scheduleFlush();
      }

      cancelScheduledFlush();
      flush(fullText);

      if (!fullText.trim()) {
        flush("⚠️ L'assistant n'a rien renvoyé. Réessaie.");
      }
    } catch (error) {
      cancelScheduledFlush();
      const msg = error instanceof Error ? error.message : "L'assistant n'a pas pu répondre. Réessaie.";
      flush(`⚠️ ${msg}`);
    } finally {
      if (isMountedRef.current) setIsTyping(false);
    }
  }, [language]);

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || isTyping || isAttachmentBusy) return;

    const userMessage: ChatMessage = { id: generateId(), role: "user", content: text };
    const historyForRequest = toHistoryTurns(messages);

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsAtBottom(true); // sending implies wanting to watch the reply arrive, even if scrolled up reading earlier context

    // إرجاع الخانة للحجم الأصلي بعد الإرسال
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await streamAssistantReply(text, historyForRequest);
  }

  /** Shared tail end of both attachment-send paths below: append the encoded envelope as a user message, clear the composer, and kick off the actual multimodal/document-augmented request. */
  async function sendAttachmentMessage(
    envelopeContent: string,
    outgoingText: string,
    attachments: { image?: { dataUrl: string; fileName?: string }; document?: { fileName: string; text: string } }
  ) {
    const userMessage: ChatMessage = { id: generateId(), role: "user", content: envelopeContent };
    const historyForRequest = toHistoryTurns(messages);

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsAtBottom(true);

    await streamAssistantReply(outgoingText, historyForRequest, attachments);
  }

  async function sendDocumentMessage(fileName: string, extractedText: string) {
    if (isTyping || isAttachmentBusy) return;
    const caption = input.trim();
    const content = encodeDocumentMessage({ fileName, caption, extractedText });
    await sendAttachmentMessage(
      content,
      caption || `Voici le contenu du document "${fileName}" que je viens d'importer — aide-moi à le comprendre.`,
      { document: { fileName, text: extractedText } }
    );
  }

  /** Surfaces an attachment-pipeline failure (image unreadable, PDF extraction failed, upload rejected) using the exact same "⚠️ …" convention streamAssistantReply's own catch block already uses — reuses ChatBubble's existing amber error treatment instead of introducing a second error UI. */
  function pushSystemErrorMessage(text: string) {
    setMessages((prev) => [...prev, { id: generateId(), role: "assistant", content: `⚠️ ${text}` }]);
    setIsAtBottom(true);
  }

  async function handleImageFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so choosing the exact same file again still fires onChange
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushSystemErrorMessage("Ce fichier n'est pas une image valide.");
      return;
    }
    // Dashboard Assistant now runs exclusively on OpenRouter's ":free"
    // model chain (see app/api/dashboard-assistant/route.ts), verified
    // text-only — that route would reject this with a 400 anyway, but
    // failing fast here skips a pointless resize + network round trip and
    // gives the student the explanation immediately.
    pushSystemErrorMessage(
      "L'analyse d'image n'est pas disponible sur l'assistant gratuit (modèles texte uniquement). Essaie sans image, ou utilise le chat d'un cours pour ce type de contenu."
    );
  }

  /** "Importer un PDF" — reuses /api/upload (the same officeparser-backed extraction pipeline as the rest of the app, see lib/document-extraction.ts) rather than reimplementing parsing here. That route is generic/out of this mission's file perimeter; this page only calls it, never edits it. */
  async function handlePdfFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsAttachmentBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error ?? "Extraction du document impossible.");
      await sendDocumentMessage(file.name, data.text as string);
    } catch (error) {
      pushSystemErrorMessage(error instanceof Error ? error.message : "Impossible d'importer ce document.");
    } finally {
      setIsAttachmentBusy(false);
    }
  }

  const regenerateResponse = useCallback(async (assistantMessageId: string) => {
    if (isTypingRef.current) return;
    const current = messagesRef.current;
    const index = current.findIndex((m) => m.id === assistantMessageId);
    if (index <= 0) return;
    const precedingUser = current[index - 1];
    if (precedingUser.role !== "user") return;

    const historyForRequest = toHistoryTurns(current.slice(0, index - 1));
    const payload = buildOutgoingPayload(precedingUser.content);
    setMessages((prev) => prev.slice(0, index));
    await streamAssistantReply(payload.message, historyForRequest, { image: payload.image, document: payload.document }, true);
    // streamAssistantReply is a plain function redefined every render (it
    // closes over `language`, which can change) — listing it here isn't
    // just satisfying the linter: omitting it was a real stale-closure bug,
    // since this callback's own empty deps meant it would keep calling
    // whichever streamAssistantReply existed at mount, forever using the
    // language active on the FIRST render even after the student switched.
  }, [streamAssistantReply]);

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  function handleSubmit() {
    void sendMessage(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function toggleListening() {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new Ctor();
      recognition.lang = "fr-FR";
      recognition.continuous = true;
      recognition.interimResults = true;

      dictationBaseRef.current = input;

      recognition.onresult = (event) => {
        let finalChunk = "";
        let interimChunk = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalChunk += transcript;
          else interimChunk += transcript;
        }

        if (finalChunk) {
          dictationBaseRef.current = dictationBaseRef.current ? `${dictationBaseRef.current} ${finalChunk}`.trim() : finalChunk.trim();
        }

        const preview = interimChunk
          ? dictationBaseRef.current
            ? `${dictationBaseRef.current} ${interimChunk}`
            : interimChunk
          : dictationBaseRef.current;

        setInput(preview);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }

  const canSend = input.trim().length > 0 && !isTyping && !isAttachmentBusy;

  return (
    <div
      className="flex h-full overflow-hidden bg-background"
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <ConversationSidebar
        isOpen={isHistoryOpen}
        onToggle={() => setIsHistoryOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDelete={handleDeleteConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <div className="flex shrink-0 items-center gap-1 px-4 pt-3 sm:px-6">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleDesktopSidebar}
                aria-label={isDesktopSidebarOpen ? tAssistant("collapseSidebar", language) : tAssistant("expandSidebar", language)}
                className="hidden h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
              >
                {isDesktopSidebarOpen ? <PanelLeftClose className="h-[18px] w-[18px]" /> : <PanelLeftOpen className="h-[18px] w-[18px]" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{isDesktopSidebarOpen ? tAssistant("collapseSidebar", language) : tAssistant("expandSidebar", language)}</TooltipContent>
          </Tooltip>
          {!isHistoryOpen && <ConversationSidebarCollapsedToggle onToggle={() => setIsHistoryOpen(true)} />}
        </div>

        {isEmpty ? (
          <EmptyState firstName={firstName} />
        ) : (
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-32 md:p-6 lg:pb-6">
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <ChatBubble key={message.id} message={message} onRefresh={regenerateResponse} onDelete={deleteMessage} />
                  ))}
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>
            </div>

            {/* "Revenir en bas" — only surfaces once the student has scrolled away from the latest message, so it never competes for attention while they're already following along. Louder styling + label while a reply is actively streaming, since that's the moment missing it matters most. */}
            <AnimatePresence>
              {!isAtBottom && (
                <motion.button
                  type="button"
                  onClick={scrollToBottom}
                  initial={{ opacity: 0, y: 10, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.94 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium shadow-glass backdrop-blur-md transition-colors dark:shadow-glass-dark",
                    isTyping
                      ? "border-emerald-500/30 bg-emerald-500 text-white hover:bg-emerald-600"
                      : "border-border bg-popover/90 text-foreground hover:bg-accent"
                  )}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {isTyping ? tAssistant("newResponseInProgress", language) : tAssistant("backToBottom", language)}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* خانة الكتابة: رقيقة (Slim) ومقيدة ضد الزوم */}
        {/* mb clears the floating MobileBottomNav (fixed, bottom-3 + its own
            content height + safe-area) below lg, where that nav is visible —
            generous on purpose rather than shaving it to the nav's exact
            measured height, since a few px of slack costs nothing here but a
            too-tight value silently regresses the moment the nav's own
            content grows by a pixel.
            That clearance is ONLY relevant while the dock is actually
            visible, though: the shell (app/dashboard/(shell)/layout.tsx)
            already hides MobileBottomNav the instant this composer's
            textarea gains focus, which is exactly when the on-screen
            keyboard opens and `keyboardInset` becomes > 0. Keeping the full
            7rem margin in that state stacked an unnecessary gap on top of
            the real keyboardInset padding (outer container, above) below a
            dock that was no longer even on screen — collapsed to a small
            fixed gap instead once the keyboard is actually open. */}
        <div
          className={cn(
            "mx-auto w-full max-w-3xl shrink-0 px-4",
            keyboardInset > 0 ? "mb-2" : "mb-[calc(7rem+env(safe-area-inset-bottom))] lg:mb-6"
          )}
        >
          <div className="glass-panel relative flex w-full items-end gap-1.5 rounded-[28px] p-1.5 shadow-glass transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_8px_32px_-8px_rgba(16,185,129,0.35)] dark:shadow-glass-dark">

            <div className="relative shrink-0 pb-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={attachmentButtonRef}
                    type="button"
                    onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
                    disabled={isAttachmentBusy}
                    aria-label={tAssistant("addAttachment", language)}
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                      isAttachmentBusy ? "cursor-not-allowed text-muted-foreground/50" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {isAttachmentBusy ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{isAttachmentBusy ? "Traitement en cours…" : tAssistant("addAttachment", language)}</TooltipContent>
              </Tooltip>

              {/* Hidden native file inputs, one per attachment kind (camera gets its own `capture` input rather than sharing the gallery one, matching the ChatRoom.tsx group-chat pattern this mirrors) — triggered programmatically from the menu items below. */}
              <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChosen} />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageFileChosen} />
              <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handlePdfFileChosen} />

              <AnimatePresence>
                {isAttachmentMenuOpen && (
                  <motion.div
                    ref={attachmentMenuRef}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-glass backdrop-blur-md dark:shadow-glass-dark"
                  >
                    {ATTACHMENT_ITEMS.map(({ kind, icon: Icon, label }) => {
                      const displayLabel =
                        kind === "image" ? tAssistant("attachImage", language) : kind === "camera" ? tAssistant("attachCamera", language) : label;
                      return (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => {
                            setIsAttachmentMenuOpen(false);
                            if (kind === "image") imageInputRef.current?.click();
                            else if (kind === "camera") cameraInputRef.current?.click();
                            else pdfInputRef.current?.click();
                          }}
                          className="flex w-full cursor-pointer items-center gap-3 p-3 text-left text-sm text-foreground transition-colors hover:bg-accent"
                        >
                          <Icon size={18} className="shrink-0 text-emerald-500" />
                          <span className="flex-1">{displayLabel}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* تم حل مشكل العرض والزوم بـ text-base (16px صافي) وطريقة OnChange بسيطة */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask MedArt Assistant..."
              className="flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:ring-0 scrollbar-hide my-auto"
            />

            <div className="flex shrink-0 items-center gap-1 pr-1 pb-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleListening}
                    disabled={!speechSupported}
                    aria-label={isListening ? tAssistant("stopDictation", language) : tAssistant("startDictation", language)}
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                      isListening
                        ? "animate-pulse bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      !speechSupported && "cursor-not-allowed opacity-40"
                    )}
                  >
                    {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {!speechSupported ? "Dictée vocale indisponible sur ce navigateur" : isListening ? tAssistant("stopDictation", language) : tAssistant("startDictation", language)}
                </TooltipContent>
              </Tooltip>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                aria-label={tAssistant("sendMessage", language)}
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200",
                  canSend
                    ? "bg-emerald-500 text-white shadow-soft hover:-translate-y-0.5 hover:bg-emerald-600 active:scale-[0.92] active:translate-y-0"
                    : "cursor-not-allowed text-muted-foreground/50"
                )}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}