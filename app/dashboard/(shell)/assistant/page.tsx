"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  BookOpenCheck,
  Brain,
  BrainCircuit,
  Calendar,
  Camera,
  ChevronLeft,
  FileText,
  HeartPulse,
  History,
  ImageIcon,
  ListChecks,
  Mic,
  AudioLines,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Send,
  Square,
  SquarePen,
  Stethoscope,
  X,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { resizeImageToDataUrl } from "@/lib/assistant/image-resize";
import { playChime } from "@/lib/voice/chime";

// The voice studio is its own chunk — only downloaded when voice mode opens.
const VoiceModeOverlay = dynamic(() => import("@/components/assistant/VoiceModeOverlay").then((m) => m.VoiceModeOverlay), { ssr: false });
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/generate-id";
import { uploadDocumentDirect } from "@/lib/upload-client";
import { haptic } from "@/lib/haptics";
import { DEFAULT_ASSISTANT_PREFS, isAssistantStyle, type AssistantMode, type AssistantPrefs } from "@/lib/assistant-modes";
import { useSidebarState } from "@/providers/SidebarProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant } from "@/lib/translations/assistant";
import { useAuth } from "@/providers/AuthProvider";
import { useAssistantConversations, type ChatMessage } from "@/hooks/useAssistantConversations";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { stopSpeaking } from "@/hooks/useSpeechSynthesis";
import { useVisualViewportBox } from "@/hooks/useVisualViewportBox";
import { ConversationSidebar, ConversationSidebarCollapsedToggle } from "@/components/assistant/ConversationSidebar";
import { MessageActions } from "@/components/assistant/MessageActions";
import { QUICK_ACTIONS, QuickActionBar } from "@/components/assistant/QuickActionBar";
import { StreamedMarkdown } from "@/components/assistant/StreamedMarkdown";
import { VoiceMeter } from "@/components/assistant/VoiceMeter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { ASSISTANT_PREFILL_KEY } from "@/lib/dashboard/assistant-prefill";

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

// Empty-state quick-prompt chips — copy drafted with an OpenRouter
// ECONOMY_MODEL call ($0.0054, well under the "raisonnable" budget for this
// task) tailored to Algerian médecine/pharmacie/dentaire students, reviewed
// before shipping. Purely a UI convenience (clicking one just calls the
// EXISTING sendMessage with this text) — no backend/streaming change.
const QUICK_PROMPTS: { icon: LucideIcon; text: string }[] = [
  { icon: Stethoscope, text: "Génère un cas clinique progressif pour tester mon raisonnement diagnostique." },
  { icon: Brain, text: "Explique-moi ce mécanisme physiologique avec une analogie simple et visuelle." },
  { icon: Calendar, text: "Crée-moi un planning de révision réaliste pour mes prochains examens." },
  { icon: ListChecks, text: "Donne-moi des moyens mnémotechniques percutants pour retenir cette classification." },
  { icon: HeartPulse, text: "Je stresse avant mes épreuves, comment prioriser sans paniquer ?" },
  { icon: BookOpenCheck, text: "Pose-moi cinq QCM pièges pour évaluer mon niveau aujourd'hui." },
];

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

function EmptyState({ firstName, onSelectPrompt }: { firstName: string; onSelectPrompt: (text: string) => void }) {
  return (
    <div className="relative flex w-full min-w-0 max-w-full flex-1 flex-col items-center justify-center gap-6 overflow-y-auto overflow-x-hidden overscroll-x-none px-3 py-8 text-center sm:gap-8 sm:px-4 sm:py-10">
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

      <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {QUICK_PROMPTS.map((prompt, index) => (
          <motion.button
            key={prompt.text}
            type="button"
            onClick={() => onSelectPrompt(prompt.text)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + index * 0.05, duration: 0.3, ease: "easeOut" }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="glass-card flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left shadow-soft transition-shadow duration-200 hover:shadow-glow"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <prompt.icon className="h-4 w-4" />
            </span>
            <span className="line-clamp-2 text-sm text-foreground/90">{prompt.text}</span>
          </motion.button>
        ))}
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

const ChatBubble = memo(function ChatBubble({
  message,
  isStreaming,
  questionText,
  onRefresh,
  onDelete,
}: {
  message: ChatMessage;
  /** True only for the reply currently arriving — its newest words fade in, and its action bar waits until it is complete. */
  isStreaming: boolean;
  /** For an assistant reply: the question it answers (names the saved note). */
  questionText: string | null;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { language } = useLanguage();
  const proseRef = useRef<HTMLDivElement>(null);
  const isUser = message.role === "user";

  if (isUser) {
    // An image/document attachment is stored as a small JSON envelope inside
    // `content` (see decodeAttachmentEnvelope above) — decode it back into an
    // actual thumbnail/file chip instead of showing the raw JSON string.
    const attachment = decodeAttachmentEnvelope(message.content);
    const action = message.mode ? QUICK_ACTIONS.find((candidate) => candidate.mode === message.mode) : undefined;

    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="flex w-full min-w-0 justify-end"
      >
        <div className="flex min-w-0 max-w-[88%] flex-col items-end gap-1.5 sm:max-w-[75%]">
          {action && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <action.icon className="h-3 w-3" />
              {tAssistant(action.label, language)}
            </span>
          )}
          {attachment?.kind === IMAGE_ENVELOPE_KIND && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL from the chat envelope; next/image cannot optimise it
            <img
              src={attachment.dataUrl}
              alt={attachment.fileName ?? "Image envoyée"}
              className="max-h-64 w-auto max-w-full rounded-2xl rounded-br-sm border border-emerald-500/30 object-cover shadow-sm"
            />
          )}
          {attachment?.kind === DOCUMENT_ENVELOPE_KIND && (
            <div className="flex max-w-full items-center gap-2 rounded-2xl rounded-br-sm border border-emerald-500/30 bg-emerald-50/80 px-3.5 py-2.5 text-emerald-800 shadow-sm dark:bg-emerald-950/30 dark:text-emerald-200">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="min-w-0 max-w-[14rem] truncate text-sm font-medium">{attachment.fileName}</span>
            </div>
          )}
          {(!attachment || attachment.caption) && (
            // bg-card/text-card-foreground/border-border: theme tokens, so it
            // follows light/dark like every other surface here. dir="auto" — a
            // message in Arabic/Darija must read right-to-left. break-words:
            // a pasted long token wraps instead of widening the thread.
            <div
              dir="auto"
              className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-sm border border-border bg-card px-4 py-2.5 text-[16px] leading-relaxed text-card-foreground shadow-sm"
            >
              {attachment ? attachment.caption : message.content}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  const isPending = (message.content ?? "").trim().length === 0;
  // The stream reports failures by flushing a "⚠️ …" line into the same
  // content field (see streamAssistantReply) rather than a separate error
  // field — purely a rendering fork on that already-existing text: a failed
  // reply gets its own unmistakable look and a one-click retry.
  const isError = !isPending && (message.content ?? "").trimStart().startsWith("⚠️");

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex w-full min-w-0 flex-col items-start"
    >
      {/* Edge-to-edge on phones: no avatar column, so the reply uses the whole
          width between the thread's px-3 gutters. The avatar returns at sm+. */}
      <div className="flex w-full min-w-0 items-start gap-2.5">
        <div className="hidden sm:block">
          <AssistantAvatar isPending={isPending} />
        </div>
        <div className="min-w-0 max-w-full flex-1 pt-0.5">
          {isPending ? (
            <TypingIndicator />
          ) : isError ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-50/80 px-3.5 py-3 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="break-words leading-relaxed">{message.content.trimStart().replace(/^⚠️\s*/, "")}</p>
                <button
                  type="button"
                  onClick={() => onRefresh(message.id)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-500/15 px-3.5 text-sm font-medium text-amber-900 transition-[transform,background-color] active:scale-95 hover:bg-amber-500/25 dark:text-amber-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Réessayer
                </button>
              </div>
            </div>
          ) : (
            <StreamedMarkdown ref={proseRef} content={message.content} isStreaming={isStreaming} />
          )}
        </div>
      </div>
      {!isPending && !isError && !isStreaming && (
        <div className="w-full min-w-0 sm:pl-[3.125rem]">
          <MessageActions
            messageId={message.id}
            content={message.content}
            contentRef={proseRef}
            questionText={questionText}
            onRefresh={onRefresh}
            onDelete={onDelete}
          />
        </div>
      )}
    </motion.div>
  );
});

const PREFS_STORAGE_KEY = "medart-assistant-prefs";

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

/** An image message: the (downsized) picture + the student's caption, rendered as a bubble with the photo. */
function encodeImageMessage(payload: Omit<ImageAttachmentEnvelope, "kind">): string {
  return JSON.stringify({ kind: IMAGE_ENVELOPE_KIND, ...payload });
}

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

/**
 * getUserMedia rejects with a DOMException whose `.name` is one of a fixed
 * set of spec'd values — but `.message` is NOT standardized across browsers:
 * Firefox's generic text for NotFoundError is the terse, English "The object
 * can not be found here.", which a student saw verbatim in a French UI with
 * no idea what it meant. Branching on `.name` (stable across browsers, unlike
 * `.message`) gives an actually actionable, translated reason instead of
 * whatever string a given browser happens to use internally.
 */
function describeMicError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "Aucun microphone détecté sur cet appareil. Vérifie qu'un micro est branché et sélectionné comme périphérique par défaut.";
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return "Accès au micro refusé. Autorise le micro pour ce site dans les réglages de ton navigateur, puis réessaie.";
      case "NotReadableError":
      case "TrackStartError":
        return "Le micro est déjà utilisé par une autre application. Ferme-la puis réessaie.";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "Le microphone détecté ne convient pas. Réessaie avec un autre micro si possible.";
      default:
        break;
    }
  }
  return error instanceof Error ? error.message : "Autorise l'accès au micro pour dicter ta question.";
}

export default function AssistantPage() {
  const { isDesktopSidebarOpen, toggleDesktopSidebar } = useSidebarState();
  const { language } = useLanguage();
  const auth = useAuth() ?? {};
  const firstName = auth.profile?.fullName?.split(" ")[0] || "Étudiant(e)";
  const { conversations, activeId, hydrated, saveMessages, startNewConversation, selectConversation, deleteConversation } =
    useAssistantConversations(auth.user?.id ?? null);
  const activeConversationTitle = conversations.find((conversation) => conversation.id === activeId)?.title;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  // isListening: mic is actively recording (MediaRecorder running).
  // isTranscribing: recording just stopped and the clip is being uploaded to
  // /api/assistant/transcribe — a distinct state so the mic button can show
  // a clear "working on it" spinner instead of silently doing nothing for
  // the second or two a Whisper call takes (the old SpeechRecognition path
  // gave NO feedback at all during its equivalent window, which is a big
  // part of why it read as "broken").
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [micSupported, setMicSupported] = useState(false);
  // Image picked but not sent yet — previewed above the composer, sent with the caption.
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const { toast } = useToast();
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
  // Phones: the whole assistant is a `fixed` surface pinned to the VISIBLE
  // viewport (top/height from window.visualViewport, see the root element
  // below), so the composer sits directly on the soft keyboard with no
  // padding arithmetic. iOS Safari doesn't shrink the layout viewport for the
  // keyboard (and scrolls it to reveal the focused field), which is exactly
  // what the old "add the keyboard height as bottom padding" approach got
  // wrong; Android Chrome resizes the layout itself, where this is a no-op.
  const isPhoneLayout = useMediaQuery("(max-width: 1023px)");
  const viewportBox = useVisualViewportBox(isPhoneLayout);
  const keyboardOpen = viewportBox?.keyboardOpen === true;
  // The measured box is applied ONLY when it differs from the plain
  // full-screen layout: keyboard open, or iOS having scrolled the visual
  // viewport. Otherwise the CSS (`inset-0`) alone sizes the surface.
  const dockedBox = viewportBox && (viewportBox.keyboardOpen || viewportBox.top > 0) ? viewportBox : null;
  // Quick action ("QCM", "Flashcards"…) armed for the NEXT message only, and
  // the answer-style toggles (kept per device in localStorage).
  const [mode, setMode] = useState<AssistantMode | null>(null);
  const [prefs, setPrefs] = useState<AssistantPrefs>(DEFAULT_ASSISTANT_PREFS);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  // Aborts the in-flight reply when the student taps Stop (see stopGeneration).
  const abortControllerRef = useRef<AbortController | null>(null);
  // Whether the student is currently scrolled near the latest message.
  // Starts true (a freshly opened/empty thread has nothing to scroll away
  // from). Purely a scroll-position/UI concern — see the effect below and
  // handleScroll for how it's kept in sync.
  const [isAtBottom, setIsAtBottom] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Question typed in the dashboard's Ctrl+K Spotlight ("Ask the
  // assistant…"), handed over in sessionStorage. Only PRE-FILLS the composer
  // (the student still presses Send) and is consumed once.
  useEffect(() => {
    let prefill: string | null = null;
    try {
      prefill = sessionStorage.getItem(ASSISTANT_PREFILL_KEY);
      sessionStorage.removeItem(ASSISTANT_PREFILL_KEY);
    } catch {
      return;
    }
    if (prefill?.trim()) {
      setInput(prefill.slice(0, 4000));
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // MediaRecorder-based dictation (replaces the old browser SpeechRecognition
  // path, which silently died whenever the browser's remote recognition
  // service was unreachable post-permission — see toggleListening below).
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
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
    setMicSupported(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined"
    );
  }, []);

  // Answer-style preferences survive reloads (per device — not sensitive, and
  // the server validates them against a whitelist on every request anyway).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AssistantPrefs> | null;
      setPrefs({
        style: isAssistantStyle(parsed?.style) ? parsed.style : DEFAULT_ASSISTANT_PREFS.style,
        stepByStep: parsed?.stepByStep === true,
      });
    } catch {
      // Unreadable or storage blocked — keep the defaults.
    }
  }, []);

  function updatePrefs(next: AssistantPrefs) {
    setPrefs(next);
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode / quota: the choice still applies for this session.
    }
  }

  // Never leave a reply being read aloud (or a generation running) behind a page the student has left.
  useEffect(() => {
    return () => {
      stopSpeaking();
      abortControllerRef.current?.abort();
    };
  }, []);

  // Grows the composer to fit what's typed (up to ~30% of the visible height,
  // then it scrolls internally). The brief "auto" step is only to MEASURE: the
  // box is put back at its previous pixel height and then set to the target,
  // so the CSS height transition animates px -> px instead of snapping.
  const composerHeightRef = useRef(0);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const visibleHeight = viewportBox?.height ?? window.innerHeight;
    const maxHeight = Math.min(180, Math.max(96, Math.round(visibleHeight * 0.3)));
    const previous = composerHeightRef.current || el.offsetHeight;
    el.style.height = "auto";
    const natural = el.scrollHeight;
    const target = Math.min(natural, maxHeight);
    el.style.height = `${previous}px`;
    void el.offsetHeight; // commit the start height so the transition has something to animate from
    el.style.height = `${target}px`;
    el.style.overflowY = natural > maxHeight ? "auto" : "hidden";
    composerHeightRef.current = target;
  }, [input, isListening, viewportBox?.height]);

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
  //
  // The follow is INSTANT while a reply streams (behavior "auto" — this scroller
  // has no CSS scroll-behavior, so that means a jump): firing a smooth
  // scroll for every streamed chunk makes each one chase a target the next
  // chunk has already moved, which reads as lag and jitter. Smooth is kept for
  // the moments nothing is streaming (sending a message, opening a thread).
  useEffect(() => {
    if (!isAtBottom) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: isTyping ? "auto" : "smooth" });
  }, [messages, isAtBottom, isTyping]);

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

  // Unmount safety net — a student navigating away mid-dictation must never
  // leave the mic indicator stuck on (an open MediaStream track keeps the
  // browser/OS "microphone in use" light lit until every track is stopped).
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
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

  /** Leaving the current thread: stop whatever is still being read aloud or generated for it. */
  function settleCurrentThread() {
    stopSpeaking();
    abortControllerRef.current?.abort();
    setMode(null);
  }

  function handleNewConversation() {
    settleCurrentThread();
    setMessages([]);
    setInput("");
    setIsAtBottom(true);
    startNewConversation();
  }

  function handleSelectConversation(id: string) {
    const found = selectConversation(id);
    if (found) {
      settleCurrentThread();
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
    bypassCache?: boolean,
    requestMode?: AssistantMode
  ) => {
    const assistantId = generateId();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
    setIsTyping(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

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
        signal: controller.signal,
        body: JSON.stringify({
          message: userText,
          history: historyForRequest,
          language,
          // Answer-style settings + the armed quick action; the server
          // validates each against a whitelist (lib/assistant-modes.ts).
          style: prefs.style,
          stepByStep: prefs.stepByStep,
          ...(requestMode ? { mode: requestMode } : {}),
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
      if (error instanceof DOMException && error.name === "AbortError") {
        // The student tapped Stop (or left the thread): keep whatever already
        // arrived. A reply stopped before its first word has nothing to show,
        // so that empty placeholder is removed instead of left spinning.
        if (isMountedRef.current) {
          if (latestText.trim()) flush(latestText);
          else setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        }
      } else {
        const msg = error instanceof Error ? error.message : "L'assistant n'a pas pu répondre. Réessaie.";
        flush(`⚠️ ${msg}`);
      }
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      if (isMountedRef.current) setIsTyping(false);
    }
  }, [language, prefs]);

  function stopGeneration() {
    haptic();
    abortControllerRef.current?.abort();
  }

  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (pendingImage && !isTyping && !isAttachmentBusy) {
      const image = pendingImage;
      setPendingImage(null);
      haptic(10);
      await sendAttachmentMessage(encodeImageMessage({ dataUrl: image.dataUrl, fileName: image.fileName, caption: text }), text || DEFAULT_IMAGE_PROMPT, {
        image: { dataUrl: image.dataUrl, fileName: image.fileName },
      });
      return;
    }
    if (!text || isTyping || isAttachmentBusy) return;

    haptic(10);
    const sendMode = mode;
    const userMessage: ChatMessage = { id: generateId(), role: "user", content: text, ...(sendMode ? { mode: sendMode } : {}) };
    const historyForRequest = toHistoryTurns(messages);

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setMode(null); // an armed quick action applies to ONE message
    setIsAtBottom(true); // sending implies wanting to watch the reply arrive, even if scrolled up reading earlier context

    await streamAssistantReply(text, historyForRequest, undefined, undefined, sendMode ?? undefined);
  }

  /** Shared tail end of both attachment-send paths below: append the encoded envelope as a user message, clear the composer, and kick off the actual multimodal/document-augmented request. */
  async function sendAttachmentMessage(
    envelopeContent: string,
    outgoingText: string,
    attachments: { image?: { dataUrl: string; fileName?: string }; document?: { fileName: string; text: string } }
  ) {
    const sendMode = mode;
    const userMessage: ChatMessage = { id: generateId(), role: "user", content: envelopeContent, ...(sendMode ? { mode: sendMode } : {}) };
    const historyForRequest = toHistoryTurns(messages);

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setMode(null);
    setIsAtBottom(true);

    await streamAssistantReply(outgoingText, historyForRequest, attachments, undefined, sendMode ?? undefined);
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
    // Downsized client-side (~1568 px JPEG), then staged as a thumbnail above
    // the composer: the student adds a question and sends both together.
    setIsPreparingImage(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setPendingImage({ dataUrl, fileName: file.name || "image.jpg" });
      textareaRef.current?.focus();
    } catch (error) {
      pushSystemErrorMessage(error instanceof Error ? error.message : "Cette image n'a pas pu être lue.");
    } finally {
      setIsPreparingImage(false);
    }
  }

  /** "Importer un PDF" — direct-to-storage upload (lib/upload-client.ts), same officeparser-backed extraction pipeline as the rest of the app (see lib/document-extraction.ts) under the hood, just never routed through this Next.js server's own request body — that's what lets a large PDF attachment actually upload instead of hitting Vercel's ~4.5 MB request-body ceiling. */
  async function handlePdfFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsAttachmentBusy(true);
    try {
      const uploaded = await uploadDocumentDirect(file);
      await sendDocumentMessage(file.name, uploaded.text);
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
    await streamAssistantReply(payload.message, historyForRequest, { image: payload.image, document: payload.document }, true, precedingUser.mode);
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

  /**
   * Uploads the just-recorded clip to /api/assistant/transcribe and appends
   * the returned text onto whatever was already typed (dictationBaseRef —
   * same "append to existing composer content" contract the old
   * SpeechRecognition path had). Any failure (network, empty/silent clip,
   * rate limit, OpenRouter error) surfaces as a toast — the old path had
   * NO equivalent feedback at all, which was the core of the reported bug.
   */
  const transcribeRecording = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      setIsTranscribing(false);
      return;
    }
    setIsTranscribing(true);
    try {
      const extension = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("wav") ? "wav" : "webm";
      const formData = new FormData();
      formData.append("file", blob, `dictation.${extension}`);

      const res = await fetch("/api/assistant/transcribe", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        throw new Error(typeof data?.error === "string" ? data.error : "La transcription a échoué.");
      }

      const transcript = typeof data.text === "string" ? data.text.trim() : "";
      if (!transcript) {
        toast({
          variant: "error",
          title: "Rien entendu",
          description: "Aucune parole détectée dans l'enregistrement — réessaie en parlant un peu plus fort.",
        });
        return;
      }

      if (!isMountedRef.current) return;
      const base = dictationBaseRef.current.trim();
      const merged = base ? `${base} ${transcript}`.trim() : transcript;
      dictationBaseRef.current = merged;
      setInput(merged);
    } catch (error) {
      toast({
        variant: "error",
        title: "Transcription impossible",
        description: error instanceof Error ? error.message : "La dictée vocale a échoué. Réessaie.",
      });
    } finally {
      if (isMountedRef.current) setIsTranscribing(false);
    }
  }, [toast]);

  async function startDictation() {
    if (!micSupported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      setRecordingStream(stream);
      recordedChunksRef.current = [];
      dictationBaseRef.current = input;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        recordedChunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        setRecordingStream(null);
        void transcribeRecording(blob);
      };

      recorder.start();
      playChime("start");
      setIsListening(true);
    } catch (error) {
      setIsListening(false);
      toast({
        variant: "error",
        title: "Micro inaccessible",
        description: describeMicError(error),
      });
    }
  }

  function stopDictation() {
    mediaRecorderRef.current?.stop();
    playChime("stop");
    setIsListening(false);
  }

  function toggleListening() {
    if (isListening) {
      stopDictation();
      return;
    }
    void startDictation();
  }

  // Desktop shortcut: Ctrl+M / Cmd+M starts dictation, the same keys stop and transcribe.
  const toggleListeningRef = useRef(toggleListening);
  toggleListeningRef.current = toggleListening;
  useEffect(() => {
    function handleShortcut(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (!voiceModeOpen) toggleListeningRef.current();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [voiceModeOpen]);

  /** Voice mode: one spoken turn → same conversation as the chat; resolves with the assistant's reply text. */
  async function askFromVoice(text: string): Promise<string> {
    await sendMessage(text);
    // Let the last streamed chunk commit before reading the thread.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const thread = messagesRef.current;
    const last = thread[thread.length - 1];
    return last && last.role === "assistant" ? last.content.replace(/^⚠️\s*/, "") : "";
  }

  const canSend = (input.trim().length > 0 || pendingImage !== null) && !isTyping && !isAttachmentBusy;
  const activeAction = mode ? QUICK_ACTIONS.find((action) => action.mode === mode) : undefined;
  const composerPlaceholder = activeAction ? tAssistant(activeAction.placeholder, language) : tAssistant("composerPlaceholder", language);
  // On a phone the primary button morphs (mic while there's nothing to send,
  // Send once there is) to give the text field the width — see the mic's className.
  const hasPrimaryAction = canSend || isTyping;

  function handleSelectMode(next: AssistantMode | null) {
    setMode(next);
    if (next) textareaRef.current?.focus();
  }

  const surface = (
    <div
      // Phones: a `fixed` surface pinned to the VISIBLE viewport — top/height
      // come from visualViewport once measured (inline style wins), 100dvh
      // until then. The composer therefore always sits directly on the soft
      // keyboard and nothing behind it can show through or scroll. At lg+
      // it's an ordinary in-flow panel in the shell, as before.
      //
      // overflow-hidden + w-full/max-w-full here and on every wrapper below is
      // the horizontal-sway lock: nothing inside can widen this surface.
      //
      // bg-white/5 (light) / transparent (dark): the shell paints its aurora
      // gradient behind every page in this route group, and an opaque
      // background here would hide it (dark:bg-black/20 was tried and was
      // still effectively opaque against the near-black dark aurora).
      className={cn(
        "flex w-full max-w-full overflow-hidden bg-white/5 dark:bg-transparent lg:h-full lg:backdrop-blur-sm",
        // `inset-0` (like the group chat room, proven on real phones) — the
        // surface fills the layout viewport with no JS and no `dvh`
        // dependency, so it can never render at zero size.
        "max-lg:fixed max-lg:inset-0 max-lg:z-50"
      )}
      style={dockedBox ? { top: dockedBox.top, height: dockedBox.height } : undefined}
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

      <div className="flex w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-white/5 dark:bg-transparent lg:backdrop-blur-sm">
        {/* Phone header — the shell hides its Topbar and bottom nav on this
            route below lg (see CHROMELESS_MOBILE_ROUTES), so this page owns
            the full screen and needs its own way back out. */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 pb-1.5 pt-[calc(env(safe-area-inset-top)+0.375rem)] lg:hidden">
          <Link
            href="/dashboard"
            aria-label="Retour au tableau de bord"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-transform active:scale-90 active:bg-accent"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[15px] font-semibold text-foreground">{isEmpty ? "MedArt Assistant" : activeConversationTitle || "MedArt Assistant"}</p>
          </div>
          <button
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            aria-label="Afficher l'historique des conversations"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90 active:bg-accent"
          >
            <History className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleNewConversation}
            disabled={isEmpty}
            aria-label="Nouvelle conversation"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90 active:bg-accent disabled:opacity-40"
          >
            <SquarePen className="h-5 w-5" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 px-4 pt-3 max-lg:hidden sm:px-6">
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
          <EmptyState firstName={firstName} onSelectPrompt={(text) => void sendMessage(text)} />
        ) : (
          <div className="relative min-h-0 w-full max-w-full flex-1">
            {/* The thread: overflow-x-hidden + overscroll-x-none + touch-action
                pan-y(+pinch-zoom) means a long token, a wide table or a stray
                horizontal swipe can never move the page sideways. Tables and
                code blocks scroll INSIDE their own wrappers instead. */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="h-full w-full max-w-full overflow-y-auto overflow-x-hidden overscroll-x-none overscroll-y-contain [-ms-overflow-style:none] [scrollbar-width:none] [touch-action:pan-y_pinch-zoom] [&::-webkit-scrollbar]:hidden"
            >
              <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5 px-3 py-4 sm:px-5 md:px-6 md:py-6">
                <AnimatePresence initial={false}>
                  {messages.map((message, index) => (
                    <ChatBubble
                      key={message.id}
                      message={message}
                      isStreaming={isTyping && index === messages.length - 1}
                      questionText={message.role === "assistant" && messages[index - 1]?.role === "user" ? summarizeForHistory(messages[index - 1].content) : null}
                      onRefresh={regenerateResponse}
                      onDelete={deleteMessage}
                    />
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
                  onClick={() => {
                    haptic();
                    scrollToBottom();
                  }}
                  initial={{ opacity: 0, y: 10, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.94 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border px-4 text-sm font-medium shadow-glass transition-colors dark:shadow-glass-dark",
                    isTyping
                      ? "border-emerald-500/30 bg-emerald-500 text-white hover:bg-emerald-600"
                      : "border-border bg-popover/95 text-foreground hover:bg-accent"
                  )}
                >
                  <ArrowDown className="h-4 w-4" />
                  {isTyping ? tAssistant("newResponseInProgress", language) : tAssistant("backToBottom", language)}
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Bottom safe-area only while the keyboard is CLOSED: with it open the
            home indicator is hidden under the keyboard, and keeping that inset
            is exactly the "awkward gap above the keyboard". */}
        <div className={cn("relative shrink-0 lg:pb-6", keyboardOpen ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]")}>
          <div className="mx-auto w-full max-w-3xl">
            {!keyboardOpen && (
              <QuickActionBar
                mode={mode}
                onSelectMode={handleSelectMode}
                prefs={prefs}
                onChangePrefs={updatePrefs}
                disabled={isTyping || isListening}
              />
            )}

            <div className="px-3 sm:px-4">
              <div className="glass-panel relative flex w-full flex-col rounded-[26px] shadow-glass transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(16,185,129,0.4),0_8px_32px_-8px_rgba(16,185,129,0.35)] dark:shadow-glass-dark">
                <AnimatePresence initial={false}>
                  {activeAction && (
                    <motion.div
                      key="armed-mode"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-3.5 pt-2.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 py-1 pl-2.5 pr-1 text-xs font-semibold text-white">
                          <activeAction.icon className="h-3.5 w-3.5" />
                          {tAssistant(activeAction.label, language)}
                          <button
                            type="button"
                            onClick={() => setMode(null)}
                            aria-label={tAssistant("removeMode", language)}
                            className="touch-target relative flex h-5 w-5 items-center justify-center rounded-full transition-colors active:bg-white/25 hover:bg-white/20"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {(pendingImage || isPreparingImage) && (
                  <div className="flex items-center gap-3 px-3 pt-3">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
                      {pendingImage ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local data: URL preview
                        <img src={pendingImage.dataUrl} alt={pendingImage.fileName} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                        </span>
                      )}
                      {pendingImage && (
                        <button
                          type="button"
                          onClick={() => setPendingImage(null)}
                          aria-label="Retirer l'image"
                          className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white transition-colors hover:bg-black"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="min-w-0 text-xs text-muted-foreground">
                      {isPreparingImage ? "Préparation de l'image…" : "Image prête : ajoute ta question (ou envoie directement) pour une analyse médicale détaillée."}
                    </p>
                  </div>
                )}

                <div className="flex w-full items-end gap-1 p-1.5">
                  <div className="relative shrink-0">
                    <button
                      ref={attachmentButtonRef}
                      type="button"
                      onClick={() => {
                        haptic();
                        setIsAttachmentMenuOpen((prev) => !prev);
                      }}
                      disabled={isAttachmentBusy || isListening}
                      aria-label={tAssistant("addAttachment", language)}
                      aria-expanded={isAttachmentMenuOpen}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-90",
                        isAttachmentBusy || isListening
                          ? "cursor-not-allowed text-muted-foreground/50"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {isAttachmentBusy ? (
                        <RefreshCw className="h-5 w-5 animate-spin" />
                      ) : (
                        <Plus className={cn("h-5 w-5 transition-transform duration-200", isAttachmentMenuOpen && "rotate-45")} />
                      )}
                    </button>

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
                          className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-2xl border border-border bg-popover py-1 text-popover-foreground shadow-glass dark:shadow-glass-dark"
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
                                className="flex min-h-12 w-full cursor-pointer items-center gap-3 px-4 text-left text-[15px] text-foreground transition-colors active:bg-accent hover:bg-accent"
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

                  {isListening ? (
                    <VoiceMeter stream={recordingStream} label={tAssistant("listening", language)} />
                  ) : (
                    // text-[16px] (never smaller): iOS Safari zooms the page when a
                    // field under 16px is focused. The height is driven by the
                    // layout effect above; min-w-0 lets it shrink inside the row.
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={1}
                      enterKeyHint="send"
                      aria-label={tAssistant("composerPlaceholder", language)}
                      placeholder={composerPlaceholder}
                      className="scrollbar-hide min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-[10px] text-[16px] leading-6 text-foreground outline-none transition-[height] duration-100 ease-out placeholder:text-muted-foreground focus:ring-0"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      haptic();
                      setVoiceModeOpen(true);
                    }}
                    disabled={!micSupported || isListening || isTyping}
                    aria-label="Mode vocal"
                    title="Mode vocal (conversation à la voix)"
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-accent hover:text-foreground active:scale-90 disabled:cursor-not-allowed disabled:opacity-40",
                      hasPrimaryAction && "max-sm:hidden"
                    )}
                  >
                    <AudioLines className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    title={micSupported ? "Dicter (Ctrl+M)" : undefined}
                    onClick={() => {
                      haptic();
                      toggleListening();
                    }}
                    disabled={!micSupported || isTranscribing}
                    aria-label={isListening ? tAssistant("stopDictation", language) : tAssistant("startDictation", language)}
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-90",
                      isListening ? "bg-rose-500 text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      (!micSupported || isTranscribing) && "cursor-not-allowed opacity-40",
                      hasPrimaryAction && !isListening && "max-sm:hidden"
                    )}
                  >
                    {isTranscribing ? (
                      <RefreshCw className="h-[18px] w-[18px] animate-spin" />
                    ) : isListening ? (
                      <Square className="h-4 w-4 fill-current" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </button>

                  {isTyping ? (
                    <button
                      type="button"
                      onClick={stopGeneration}
                      aria-label={tAssistant("stopGeneration", language)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-90"
                    >
                      <Square className="h-4 w-4 fill-current" />
                    </button>
                  ) : canSend && !isListening ? (
                    <motion.button
                      key="send"
                      type="button"
                      onClick={handleSubmit}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                      whileTap={{ scale: 0.9 }}
                      aria-label={tAssistant("sendMessage", language)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-soft"
                    >
                      <Send className="h-5 w-5" />
                    </motion.button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <VoiceModeOverlay open={voiceModeOpen} onClose={() => setVoiceModeOpen(false)} onAsk={askFromVoice} />
    </div>
  );

  // Phones: render straight into <body>, OUTSIDE every ancestor of the shell.
  // The page normally sits inside the shell's <PageTransition> wrapper, which
  // fades its content in from opacity 0 and keeps a transform while it runs —
  // an ancestor with opacity 0 hides everything below it (leaving only the
  // separately-mounted DNA canvas visible), and a transformed ancestor
  // re-anchors `position: fixed` descendants. A portal removes this surface
  // from that whole chain, so no wrapper state can ever blank or displace it.
  // z-50 sits above the DNA canvas (z-0). Desktop keeps the in-flow layout.
  return isPhoneLayout && typeof document !== "undefined" ? createPortal(surface, document.body) : surface;
}
