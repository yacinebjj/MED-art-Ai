"use client";

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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

function NovaOrb() {
  return (
    <div
      className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:h-24 sm:w-24"
      aria-hidden="true"
    >
      <BrainCircuit className="h-10 w-10 sm:h-12 sm:w-12" />
    </div>
  );
}

function EmptyState({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white md:text-4xl">
          Hi Yacine, what&apos;s on your mind?
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
    <div className="relative mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <BrainCircuit className="h-5 w-5" />
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
    } catch {}
  }

  return (
    <div className="mt-1.5 flex flex-row items-center gap-2 text-gray-400 dark:text-gray-500">
      <button type="button" onClick={() => onRefresh(messageId)} aria-label="Régénérer" className="rounded-md p-1 transition-colors hover:text-emerald-500">
        <RefreshCw className="h-3.5 w-3.5" />
      </button>

      <button type="button" onClick={handleCopy} aria-label="Copier" className="rounded-md p-1 transition-colors hover:text-emerald-500">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      <button
        type="button"
        onClick={() => setFeedback((prev) => (prev === "up" ? null : "up"))}
        className={cn("rounded-md p-1 transition-colors hover:text-emerald-500", feedback === "up" && "text-emerald-500")}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={() => setFeedback((prev) => (prev === "down" ? null : "down"))}
        className={cn("rounded-md p-1 transition-colors hover:text-emerald-500", feedback === "down" && "text-rose-500")}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>

      <div className="relative">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
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
                onClick={() => { setReported(true); setMenuOpen(false); }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {reported ? "Signalé — merci" : "Signaler cette réponse"}
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
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex w-full justify-end"
      >
        <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-3 text-sm leading-relaxed text-white shadow-sm sm:max-w-[75%] sm:text-[15px]">
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

  const messagesRef = useRef<ChatMessage[]>([]);
  const isTypingRef = useRef(false);
  
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isTypingRef.current = isTyping; }, [isTyping]);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionConstructor() !== null);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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

  async function streamAssistantReply(userText: string, historyForRequest: HistoryTurn[]) {
    const assistantId = crypto.randomUUID();
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
  }

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || isTyping) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const historyForRequest = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    
    // إرجاع الخانة للحجم الأصلي بعد الإرسال
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    await streamAssistantReply(text, historyForRequest);
  }

  const regenerateResponse = useCallback(async (assistantMessageId: string) => {
    if (isTypingRef.current) return;
    const current = messagesRef.current;
    const index = current.findIndex((m) => m.id === assistantMessageId);
    if (index <= 0) return;
    const precedingUser = current[index - 1];
    if (precedingUser.role !== "user") return;

    const historyForRequest = current.slice(0, index - 1).map((m) => ({ role: m.role, content: m.content }));
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
    <div className="flex h-full overflow-hidden bg-transparent">
      <ConversationSidebar
        isOpen={isHistoryOpen}
        onToggle={() => setIsHistoryOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDelete={handleDeleteConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
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
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-32 md:p-6 lg:pb-6">
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <ChatBubble key={message.id} message={message} onRefresh={regenerateResponse} onDelete={deleteMessage} />
                ))}
              </AnimatePresence>
              <div ref={bottomRef} />
            </div>
          </div>
        )}

        {/* خانة الكتابة: رقيقة (Slim) ومقيدة ضد الزوم */}
        <div className="mx-auto mb-20 w-full max-w-3xl shrink-0 px-4 lg:mb-6">
          <div className="relative flex w-full items-end gap-1.5 rounded-[28px] bg-white dark:bg-[#1A1B20] p-1.5 shadow-md border border-gray-200 dark:border-gray-700/80">
            
            <div className="relative shrink-0 pb-0.5">
              <button
                ref={attachmentButtonRef}
                type="button"
                onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                <Plus className="h-5 w-5" />
              </button>

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
                        <Icon size={18} className="shrink-0 text-emerald-500" />
                        {label}
                      </button>
                    ))}
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
              className="flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-gray-900 placeholder-gray-500 outline-none focus:ring-0 dark:text-gray-100 scrollbar-hide my-auto"
            />

            <div className="flex shrink-0 items-center gap-1 pr-1 pb-0.5">
              <button
                type="button"
                onClick={toggleListening}
                disabled={!speechSupported}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                  isListening
                    ? "animate-pulse bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                    : "text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800",
                  !speechSupported && "cursor-not-allowed opacity-40"
                )}
              >
                {isListening ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSend}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-200",
                  canSend
                    ? "text-emerald-500 hover:bg-gray-200 dark:hover:bg-gray-800"
                    : "cursor-not-allowed text-gray-400 dark:text-gray-600"
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