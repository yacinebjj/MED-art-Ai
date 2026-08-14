"use client";

/**
 * MedArt Assistant — free-flowing AI companion, distinct from the
 * course-scoped chat in app/api/courses/chat/route.ts (that one is tied to
 * a specific course's raw_text; this one is a standalone conversational
 * space, no course context). Lives inside app/dashboard/(shell) on purpose
 * — same Sidebar/Topbar chrome as Espace Étude/Paramètres, verified against
 * components/layout/Sidebar.tsx (z-40, fixed) and this page's own scroll
 * container (overflow-y-auto, explicit height) before this round of edits,
 * not just assumed unchanged.
 *
 * Streaming wired to app/api/assistant/route.ts using the exact same
 * plain-text ReadableStream pattern as hooks/useCourseChat.ts. Perf note:
 * every streamed chunk calls setMessages with a NEW array, so every
 * <ChatBubble> in the list would re-render on every chunk — including
 * re-parsing Markdown for messages that aren't even changing — without the
 * memo() + stable-callback treatment below. See the comments on ChatBubble,
 * regenerateResponse, and deleteMessage for how that's actually prevented,
 * not just claimed.
 */

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
import { useSidebarState } from "@/providers/SidebarProvider";
import { useAssistantConversations, type ChatMessage } from "@/hooks/useAssistantConversations";
import { ConversationSidebar, ConversationSidebarCollapsedToggle } from "@/components/assistant/ConversationSidebar";

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "Crée-moi un planning de révisions",
  "Explique-moi un ECG",
  "Je me sens stressé(e)",
  "Résume mon module de Cardiologie",
];

/**
 * The MedArt brand mark — a minimalist medical cross in a rounded-square
 * emerald badge, replacing the generic Sparkles/Bot icon everywhere the
 * AI's identity appears. Deliberately kept to a simple, guaranteed-legible
 * geometric cross rather than a more literal "M + brain" hybrid illustration
 * — that level of custom iconography needs a real visual design pass (this
 * is hand-authored SVG with no way to preview it before shipping), and a
 * clean cross reads clearly as "medical" without risking an illegible mess.
 * Solid emerald + white fill works unchanged in both themes, no dark:
 * variants needed.
 */
function MedArtLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="23" rx="7" className="fill-emerald-500" />
      <path d="M12 6.5v11M6.5 12h11" stroke="white" strokeWidth="2.75" strokeLinecap="round" />
    </svg>
  );
}

/** The "Nova Effect" — layered, independently-animated blurred rings around the MedArt mark, giving the impression of a slow, organic breathing glow rather than a single flat pulse. */
function NovaOrb() {
  return (
    <div className="relative flex h-48 w-48 shrink-0 items-center justify-center sm:h-64 sm:w-64 md:h-72 md:w-72">
      <motion.div
        className="absolute inset-0 rounded-full bg-emerald-500/20 blur-3xl"
        animate={{ scale: [0.95, 1.05, 0.95], opacity: [0.5, 0.85, 0.5], rotate: [0, 12, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute inset-6 rounded-full bg-teal-400/25 blur-2xl sm:inset-8"
        animate={{ scale: [1.05, 0.95, 1.05], opacity: [0.55, 0.9, 0.55], x: [0, 10, -6, 0], y: [0, -8, 4, 0] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
      />
      <motion.div
        className="absolute inset-12 rounded-full bg-emerald-300/30 blur-xl sm:inset-16"
        animate={{ scale: [0.92, 1.08, 0.92], rotate: [0, -18, 0] }}
        transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
      />
      <motion.div
        className="relative flex h-14 w-14 items-center justify-center rounded-full shadow-[0_0_60px_rgba(16,185,129,0.55)] sm:h-20 sm:w-20"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      >
        <MedArtLogo className="h-full w-full" />
      </motion.div>
    </div>
  );
}

function EmptyState({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-10 text-center sm:gap-8">
      <NovaOrb />
      <div className="max-w-xl space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white md:text-4xl">
          Bienvenue sur MedArt Assistant.
        </h1>
        <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400 sm:text-base">
          Je sais que tu prépares tes examens de 5ème année. Besoin d&apos;aide pour organiser tes révisions de
          Cardiologie, comprendre un module compliqué, ou juste souffler un peu ? Je suis là.
        </p>
      </div>
      <div className="flex max-w-xl flex-wrap items-center justify-center gap-2 sm:gap-3">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <motion.button
            key={prompt}
            type="button"
            onClick={() => onSelectPrompt(prompt)}
            whileHover={{ scale: 1.05, boxShadow: "0 0 24px rgba(16,185,129,0.35)" }}
            whileTap={{ scale: 0.96 }}
            className="rounded-full border border-emerald-200 bg-emerald-50/80 px-4 py-2 text-xs font-medium text-emerald-700 backdrop-blur transition-colors hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-900/40 sm:text-sm"
          >
            {prompt}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="relative mb-1 h-7 w-7 shrink-0">
      <MedArtLogo className="h-full w-full" />
      <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.6)]" />
      </span>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/**
 * Assistant messages only — user messages stay plain text (rendering a
 * student's own raw input as Markdown could turn a stray "*" or "#" into
 * unintended formatting, and there's no reason to parse it). `prose`
 * classes come from @tailwindcss/typography (already installed and
 * registered in tailwind.config.ts). Table cells get explicit overrides on
 * top of `prose` for the bordered/striped look requested — Typography's
 * defaults are close but not that specific.
 *
 * Known, inherent limitation of live-streaming Markdown, not something
 * fixable here without a much bigger incremental-parser rewrite: a
 * half-written table row or an unclosed "**" can render oddly for a
 * fraction of a second while more characters are still arriving. Every
 * streaming Markdown UI (this app's own chat included) has this same
 * property — buffering until a heuristic "safe to render" point would
 * trade this for added latency, a different tradeoff, not a strictly
 * better one.
 *
 * Fade-in reveal: `p`/`li`/`tr` each get `animate-in fade-in` (from the
 * already-installed tailwindcss-animate plugin, not hand-authored
 * keyframes) — a real, honest technique with a real limit, stated plainly:
 * ReactMarkdown re-parses the WHOLE string on every flush, and React only
 * remounts a DOM node (which is what re-triggers a CSS animation) when a
 * NEW element appears in the tree — an existing paragraph that's simply
 * getting MORE TEXT appended to it does not remount, so it doesn't
 * re-fade. What this achieves is real and visible: each new paragraph,
 * list item, or table row fades in the moment it first appears as the
 * response builds up block by block. What it does NOT achieve, because
 * ReactMarkdown's component-override API has no hook into individual
 * words or characters within one already-mounted text node, is a literal
 * per-word fade while a single sentence is still being typed out — that
 * needs a custom incremental renderer splitting text into per-token spans,
 * a materially bigger rewrite than this task, not a CSS trick.
 */
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none text-gray-800 prose-headings:font-semibold prose-p:my-2 prose-strong:text-gray-900 prose-ul:my-2 prose-li:my-0.5 dark:prose-invert dark:text-gray-100 dark:prose-strong:text-white sm:prose-base [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="animate-in fade-in duration-500">{children}</p>,
          li: ({ children }) => <li className="animate-in fade-in duration-500">{children}</li>,
          h1: ({ children }) => <h1 className="animate-in fade-in duration-500">{children}</h1>,
          h2: ({ children }) => <h2 className="animate-in fade-in duration-500">{children}</h2>,
          h3: ({ children }) => <h3 className="animate-in fade-in duration-500">{children}</h3>,
          blockquote: ({ children }) => <blockquote className="animate-in fade-in duration-500">{children}</blockquote>,
          table: ({ children }) => (
            <div className="my-3 animate-in fade-in overflow-x-auto rounded-lg border border-gray-200 duration-500 dark:border-gray-700">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-emerald-50 dark:bg-emerald-950/40">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-gray-100 px-3 py-2 align-top text-gray-600 last:border-b-0 dark:border-gray-800 dark:text-gray-300">
              {children}
            </td>
          ),
          tr: ({ children }) => <tr className="animate-in fade-in even:bg-gray-50/60 duration-500 dark:even:bg-gray-800/30">{children}</tr>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Below every completed AI message only — never on the user's own bubbles,
 * never while the reply is still streaming (an empty/in-progress message
 * has nothing to copy, regenerate from a toolbar under itself, or rate).
 * Refresh/Copy/ThumbsUp/ThumbsDown/MoreHorizontal are all real, working
 * handlers, not decoration — see each button below for exactly what it
 * does and doesn't do (feedback state and "reported" are local-only, no
 * backend endpoint exists yet to send them to, which is disclosed in the
 * dropdown item itself rather than pretending it's persisted).
 */
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
    } catch {
      // Clipboard permission denied or API unavailable (non-HTTPS context,
      // older browser) — nothing to recover, the button just silently
      // doesn't confirm success rather than throwing.
    }
  }

  return (
    <div className="mt-1.5 flex flex-row items-center gap-2 text-gray-400 dark:text-gray-500">
      <button
        type="button"
        onClick={() => onRefresh(messageId)}
        aria-label="Régénérer la réponse"
        className="rounded-md p-1 transition-colors hover:text-emerald-500"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>

      <button type="button" onClick={handleCopy} aria-label="Copier la réponse" className="rounded-md p-1 transition-colors hover:text-emerald-500">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      <button
        type="button"
        onClick={() => setFeedback((prev) => (prev === "up" ? null : "up"))}
        aria-label="Bonne réponse"
        aria-pressed={feedback === "up"}
        className={cn("rounded-md p-1 transition-colors hover:text-emerald-500", feedback === "up" && "text-emerald-500")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setFeedback((prev) => (prev === "down" ? null : "down"))}
        aria-label="Mauvaise réponse"
        aria-pressed={feedback === "down"}
        className={cn("rounded-md p-1 transition-colors hover:text-emerald-500", feedback === "down" && "text-rose-500")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>

      <div className="relative">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Plus d'options"
          aria-expanded={menuOpen}
          className="rounded-md p-1 transition-colors hover:text-emerald-500"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-gray-100 bg-white text-sm shadow-xl dark:border-gray-700 dark:bg-gray-800"
            >
              <button
                type="button"
                onClick={() => {
                  setReported(true);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {reported ? "Signalé — merci" : "Signaler cette réponse"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(messageId);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer cette réponse
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Memoized so a streaming update to ONE message (a new array from
 * setMessages on every chunk) doesn't re-render every OTHER bubble in the
 * list — sendMessage/regenerateResponse only ever create a new object
 * reference for the message actually changing (see their .map() callbacks
 * below), so React.memo's default shallow-prop comparison correctly bails
 * out for every untouched message. This ONLY works because onRefresh/
 * onDelete are stable function references (useCallback with an empty
 * dependency array on the parent, reading fresh data via a ref instead of
 * closing over `messages` state) — an inline arrow function passed as a
 * prop here would get a new reference every render and silently defeat the
 * whole memoization, which is exactly the "state logic causes the whole
 * chat to re-render" bug this component exists to avoid.
 */
/**
 * User and assistant messages now render through genuinely different
 * layouts, not one shared structure toggled by conditional classes: the
 * user's message stays a capped-width, right-aligned pill (bg-emerald-600,
 * rounded, shadow) exactly as before. The assistant's no longer has ANY
 * card — no background, no border, no rounded corners, no shadow, no
 * max-width — its Markdown/tables/lists flow directly on the page canvas,
 * full width between the avatar column and the right margin, per the
 * explicit "no boxed bubble for the AI" requirement. Trying to force both
 * through one conditional className string got fragile once the two
 * stopped sharing a shape at all; two small, explicit branches are safer.
 */
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
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex w-full justify-end"
      >
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm sm:max-w-[70%] sm:text-[15px]">
          {message.content}
        </div>
      </motion.div>
    );
  }

  const isPending = message.content.trim().length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex w-full flex-col items-start"
    >
      <div className="flex w-full items-start gap-2">
        <AssistantAvatar />
        {/* min-w-0 lets the flex child actually shrink below its content's natural width instead of overflowing — needed for long unbroken table rows/URLs to wrap correctly at the container edge instead of forcing horizontal scroll. */}
        <div className="min-w-0 flex-1 pt-0.5">{isPending ? <TypingDots /> : <AssistantMarkdown content={message.content} />}</div>
      </div>
      {!isPending && (
        <div className="pl-9">
          <ChatToolbar messageId={message.id} content={message.content} onRefresh={onRefresh} onDelete={onDelete} />
        </div>
      )}
    </motion.div>
  );
});

// Minimal, self-contained typings for the Web Speech API — deliberately not
// relying on the ambient `SpeechRecognition`/`SpeechRecognitionEvent` DOM
// types, which aren't declared in every TS `lib` configuration. Only the
// handful of members this file actually touches are typed. Extended for
// continuous + interim results: `resultIndex` + `isFinal` are what the real
// API uses to tell the caller which results in the growing `results` list
// are still being revised vs. locked in.
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

const MAX_TEXTAREA_HEIGHT_PX = 160;

const ATTACHMENT_ITEMS = [
  { icon: ImageIcon, label: "Importer une image" },
  { icon: FileText, label: "Importer un PDF" },
  { icon: Camera, label: "Prendre une photo" },
];

export default function AssistantPage() {
  const { isDesktopSidebarOpen, toggleDesktopSidebar } = useSidebarState();
  const { conversations, activeId, hydrated, saveMessages, startNewConversation, selectConversation, deleteConversation } =
    useAssistantConversations();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const dictationBaseRef = useRef("");
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);

  // Always-fresh mirrors of state that regenerateResponse/deleteMessage need
  // to read, WITHOUT putting `messages`/`isTyping` in those callbacks'
  // dependency arrays — doing that would give them a new function identity
  // on every single state change (i.e. every streamed chunk), which would
  // propagate to every ChatBubble as a changed prop and defeat memo() for
  // the entire list, not just the streaming message. This ref-mirror
  // pattern is what makes "stable callback + always-current data" possible
  // at the same time.
  const messagesRef = useRef<ChatMessage[]>([]);
  const isTypingRef = useRef(false);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [input]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
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

  // One-time restore on mount, once localStorage has actually been read —
  // reopens whichever conversation was active when the user last left,
  // exactly the "survive a refresh" behavior this whole feature exists for.
  // Deliberately keyed ONLY on `hydrated`, not on `activeId`/`conversations`:
  // this is a one-shot restore, not a continuous sync — picking a DIFFERENT
  // conversation later goes through handleSelectConversation instead, which
  // sets `messages` directly rather than relying on this effect re-firing.
  useEffect(() => {
    if (!hydrated || !activeId) return;
    const active = conversations.find((c) => c.id === activeId);
    if (active) setMessages(active.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Auto-save after every settled turn — the user's prompt AND the
  // assistant's reply, together, once isTyping flips back to false.
  // Deliberately gated on !isTyping rather than firing on every `messages`
  // change: without that guard this would fire on every rAF-batched
  // streaming flush too (up to ~60 times/second for a long reply), writing
  // to localStorage far more often than the "after every user prompt and
  // AI response" requirement actually calls for.
  useEffect(() => {
    if (isTyping) return;
    saveMessages(messages);
  }, [messages, isTyping, saveMessages]);

  function handleNewConversation() {
    setMessages([]);
    setInput("");
    startNewConversation();
  }

  function handleSelectConversation(id: string) {
    const found = selectConversation(id);
    if (found) setMessages(found.messages);
  }

  function handleDeleteConversation(id: string) {
    const wasActive = id === activeId;
    deleteConversation(id);
    if (wasActive) setMessages([]);
  }

  /**
   * Shared by sendMessage (new turn) and regenerateResponse (retry) — both
   * just need "stream a reply for this user text, given this history"
   * appended as a fresh assistant row.
   *
   * Streaming smoothness: `reader.read()` resolves once per network chunk,
   * and network chunks arrive in bursts of wildly variable size/timing —
   * calling setMessages synchronously on every single one (the previous
   * version) means every burst is a separate React commit AND a separate
   * full ReactMarkdown re-parse of the whole accumulated string so far,
   * which gets more expensive the longer the reply grows. On a fast burst
   * of several chunks within one frame, that's several redundant re-parses
   * of an ever-longer string in a row — the actual mechanical cause of
   * "stuttering" here, not something CSS/animation can paper over.
   *
   * Fix: buffer incoming text in a plain variable and flush to React state
   * at most once per animation frame via requestAnimationFrame — this
   * coalesces however many chunks arrived within that ~16ms window into a
   * single commit/re-parse, capping the update rate at the browser's own
   * paint cadence instead of the network's. `flush(fullText)` after the
   * loop ends guarantees the LAST chunk is never dropped by a frame that
   * was still pending when the stream closed, and any in-flight frame is
   * explicitly cancelled before an error message overwrites the bubble so
   * a late successful flush can never race past and clobber a subsequent
   * error message.
   */
  async function streamAssistantReply(userText: string, historyForRequest: HistoryTurn[]) {
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    setIsTyping(true);

    let rafId: number | null = null;
    let latestText = "";

    function flush(text: string) {
      // Only the streaming message gets a NEW object here — every other
      // entry keeps its exact prior reference, which is what lets
      // ChatBubble's memo() correctly skip re-rendering them.
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m)));
    }

    function scheduleFlush() {
      if (rafId !== null) return;
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
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history: historyForRequest }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "L'assistant n'a pas pu répondre.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // {stream: true} buffers any multi-byte UTF-8 sequence split across
        // a chunk boundary instead of emitting a corrupted character —
        // already correct here, kept as-is.
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
      setIsTyping(false);
    }
  }

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || isTyping) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    // Snapshot BEFORE appending this turn — the API's own history param must
    // never include the message being sent right now, only what came before it.
    const historyForRequest = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    await streamAssistantReply(text, historyForRequest);
  }

  // Stable identity (empty deps) on purpose — reads current data via the
  // refs above instead of closing over `messages`/`isTyping` state, so
  // passing this straight into every ChatBubble never breaks their memo().
  const regenerateResponse = useCallback(async (assistantMessageId: string) => {
    if (isTypingRef.current) return;
    const current = messagesRef.current;
    const index = current.findIndex((m) => m.id === assistantMessageId);
    if (index <= 0) return;
    const precedingUser = current[index - 1];
    if (precedingUser.role !== "user") return;

    const historyForRequest = current.slice(0, index - 1).map((m) => ({ role: m.role, content: m.content }));
    // Drop the old reply, keep everything up to and including the user
    // message it answered — regeneration replaces one answer, not the
    // whole conversation after it.
    setMessages((prev) => prev.slice(0, index));
    await streamAssistantReply(precedingUser.content, historyForRequest);
  }, []);

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
      // French base — medical vocabulary in Algerian faculties is heavily
      // French even in otherwise Darija/Arabic speech, so fr-FR recognizes
      // the terms that actually matter most accurately. continuous+interim
      // together are what stop it from cutting off after the first pause:
      // continuous keeps the session open across multiple phrases, interim
      // surfaces live partial text instead of only committing once a phrase
      // is judged fully finished.
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

  const canSend = input.trim().length > 0 && !isTyping;

  return (
    // Explicit viewport-relative height, not h-full: full-bleed pages get
    // NO py-8 from (shell)/layout.tsx anymore (see FULL_BLEED_ROUTES there),
    // so the only remaining fixed chrome is Topbar's h-16 (4rem) — h-full
    // would still resolve against nothing without an explicit height
    // somewhere in the chain, since <main> itself has no height rule beyond
    // flex-1 in a min-h-screen column. 100dvh over 100vh so mobile browser
    // chrome (address bar) doesn't leave the input bar floating past the
    // real visible area. No boxed card here anymore either — no border,
    // radius, or background — this blends directly into the dashboard
    // canvas edge to edge, per the "no confined box" requirement.
    //
    // flex-row at the outer level, not flex-col: the conversation-history
    // rail sits BESIDE the chat canvas (Gemini-style), independently
    // collapsible from the main dashboard sidebar via isHistoryOpen — the
    // two toggles are deliberately separate state, not the same one.
    <div className="flex h-[calc(100dvh-4rem)] overflow-hidden">
      <ConversationSidebar
        isOpen={isHistoryOpen}
        onToggle={() => setIsHistoryOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDelete={handleDeleteConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Both toggles live in the same header row: the main dashboard
            sidebar (SidebarProvider context, rendered by the ancestor
            layout) and this page's own conversation-history rail (local
            isHistoryOpen state). Collapsing one never affects the other. */}
        <div className="flex shrink-0 items-center gap-1 px-4 pt-3 sm:px-6">
          <button
            type="button"
            onClick={toggleDesktopSidebar}
            aria-label={isDesktopSidebarOpen ? "Réduire la barre latérale" : "Afficher la barre latérale"}
            className="hidden h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 lg:flex"
          >
            {isDesktopSidebarOpen ? <PanelLeftClose className="h-[18px] w-[18px]" /> : <PanelLeftOpen className="h-[18px] w-[18px]" />}
          </button>

          {!isHistoryOpen && <ConversationSidebarCollapsedToggle onToggle={() => setIsHistoryOpen(true)} />}
        </div>

        {isEmpty ? (
          <EmptyState onSelectPrompt={sendMessage} />
        ) : (
          <div className="flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* No max-w-* here on purpose, per explicit instruction: width is
                controlled entirely by responsive padding, not a content cap
                — the message list genuinely fills the available canvas edge
                to edge (minus the padding), growing wider as either sidebar
                collapses or the viewport widens, instead of stopping at a
                fixed column width. */}
            <div className="flex w-full flex-col gap-4 px-4 pb-6 pt-2 sm:px-8 lg:px-16 xl:px-24 2xl:px-32">
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <ChatBubble key={message.id} message={message} onRefresh={regenerateResponse} onDelete={deleteMessage} />
                ))}
              </AnimatePresence>
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        {/* Sticky input bar — floats above the bottom edge, frosted glass, generous touch-friendly padding. pb-[max(...)] keeps it clear of the home-indicator/gesture area on iOS instead of sitting flush against it. Same no-max-w, padding-driven width as the message list above it, so the two stay visually aligned at every breakpoint. */}
        <div className="shrink-0 border-t border-gray-100 bg-white/50 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/50 sm:px-8 sm:pb-4 lg:px-16 xl:px-24 2xl:px-32">
          <div className="flex w-full items-end gap-2 rounded-3xl border border-gray-200 bg-white/70 p-2 shadow-sm backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/70">
            <div className="relative">
              <motion.button
                ref={attachmentButtonRef}
                type="button"
                aria-label="Ajouter une pièce jointe"
                aria-expanded={isAttachmentMenuOpen}
                onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
                whileHover={{ rotate: 90, backgroundColor: "rgba(16,185,129,0.12)" }}
                whileTap={{ scale: 0.92 }}
                transition={{ duration: 0.2 }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 dark:text-gray-400"
              >
                <Plus className="h-5 w-5" />
              </motion.button>

              <AnimatePresence>
                {isAttachmentMenuOpen && (
                  <motion.div
                    ref={attachmentMenuRef}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl backdrop-blur-md dark:border-gray-700 dark:bg-gray-800"
                  >
                    {ATTACHMENT_ITEMS.map(({ icon: Icon, label }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setIsAttachmentMenuOpen(false)}
                        className="flex w-full cursor-pointer items-center gap-3 p-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <Icon size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                        {label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Demande-moi sur tes cours, organise ta journée, ou discute simplement..."
              className="max-h-40 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 dark:text-gray-100 dark:placeholder:text-gray-500 sm:text-[15px]"
            />

            <button
              type="button"
              aria-label={isListening ? "Arrêter la dictée vocale" : "Dictée vocale"}
              onClick={toggleListening}
              disabled={!speechSupported}
              title={speechSupported ? undefined : "Dictée vocale non supportée par ce navigateur"}
              className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                isListening
                  ? "animate-pulse bg-red-100 text-red-600 shadow-[0_0_0_4px_rgba(239,68,68,0.15)] dark:bg-red-950/40 dark:text-red-400"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/60",
                !speechSupported && "cursor-not-allowed opacity-40"
              )}
            >
              {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
            </button>

            <motion.button
              type="button"
              aria-label="Envoyer"
              onClick={handleSubmit}
              disabled={!canSend}
              whileHover={canSend ? { scale: 1.05 } : undefined}
              whileTap={canSend ? { scale: 0.94 } : undefined}
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
                canSend
                  ? "bg-emerald-600 text-white shadow-[0_0_18px_rgba(16,185,129,0.5)] hover:bg-emerald-700"
                  : "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700/60 dark:text-gray-500"
              )}
            >
              <Send className="h-4 w-4" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
