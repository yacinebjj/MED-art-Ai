"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Brain,
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
import { DEFAULT_ASSISTANT_PREFS, type AssistantMode } from "@/lib/assistant-modes";
import { useSidebarState } from "@/providers/SidebarProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { tAssistant } from "@/lib/translations/assistant";
import { useAuth } from "@/providers/AuthProvider";
import { useAssistantConversations, type ChatMessage } from "@/hooks/useAssistantConversations";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { stopSpeaking } from "@/hooks/useSpeechSynthesis";
import { useVisualViewportBox } from "@/hooks/useVisualViewportBox";
import { ConversationSidebar, ConversationSidebarCollapsedToggle } from "@/components/assistant/ConversationSidebar";
import { AssistantAvatar, COPILOT_HUB_CLASSES, COPILOT_SUGGESTION_CLASSES, COPILOT_USER_BUBBLE_CLASSES, NovaOrb, TypingIndicator } from "@/components/assistant/CopilotParts";
import { MessageActions } from "@/components/assistant/MessageActions";
import { QUICK_ACTIONS } from "@/components/assistant/QuickActionBar";
import { StreamedMarkdown } from "@/components/assistant/StreamedMarkdown";
import { VoiceMeter } from "@/components/assistant/VoiceMeter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { TourReplayButton } from "@/components/onboarding/TourReplayButton";
import { ASSISTANT_PREFILL_KEY } from "@/lib/dashboard/assistant-prefill";
import { useTourBlocker } from "@/lib/onboarding/onboarding-context";
import { dominantDirection } from "@/lib/text-direction";
import { forgetReply, getReplySnapshot, resumeReply, settledReplyContent, startReply, stopReply, subscribeReply, type ReplyCopy } from "@/lib/copilot-reply-runner";

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

// Empty-state quick-prompt chips — copy drafted with an OpenRouter
// ECONOMY_MODEL call ($0.0054, well under the "raisonnable" budget for this
// task) tailored to Algerian médecine/pharmacie/dentaire students, reviewed
// before shipping. Purely a UI convenience (clicking one just calls the
// EXISTING sendMessage with this text) — no backend/streaming change.
/** `label`: the short chip on the welcome screen; `text`: the full request it sends. */
const QUICK_PROMPTS: { icon: LucideIcon; label: string; text: string }[] = [
  { icon: Stethoscope, label: "Cas clinique progressif", text: "Génère un cas clinique progressif pour tester mon raisonnement diagnostique." },
  { icon: Brain, label: "Mécanisme en analogie", text: "Explique-moi ce mécanisme physiologique avec une analogie simple et visuelle." },
  { icon: Calendar, label: "Planning de révision", text: "Crée-moi un planning de révision réaliste pour mes prochains examens." },
  { icon: ListChecks, label: "Moyens mnémotechniques", text: "Donne-moi des moyens mnémotechniques percutants pour retenir cette classification." },
  { icon: HeartPulse, label: "Gérer le stress", text: "Je stresse avant mes épreuves, comment prioriser sans paniquer ?" },
  { icon: BookOpenCheck, label: "5 QCM pièges", text: "Pose-moi cinq QCM pièges pour évaluer mon niveau aujourd'hui." },
];

function EmptyState({ firstName, onSelectPrompt }: { firstName: string; onSelectPrompt: (text: string) => void }) {
  const { language } = useLanguage();
  return (
    // Clears the floating header and composer (their measured heights, see the chat column) and dissolves before reaching them.
    // motion-swap: rises in when it replaces a conversation ("Nouvelle conversation").
    <div className="copilot-thread-fade motion-swap relative isolate flex w-full min-w-0 max-w-full flex-1 flex-col items-center justify-center overflow-y-auto overflow-x-hidden overscroll-none px-4 pb-[calc(var(--copilot-composer-h,0px)+2rem)] pt-[calc(var(--copilot-header-h,0px)+2rem)] text-center sm:pb-[calc(var(--copilot-composer-h,0px)+2.5rem)] sm:pt-[calc(var(--copilot-header-h,0px)+2.5rem)]">
      {/* Desktop only: a slow, blurred light drifting behind the welcome (transform-only; still under reduced motion, absent on phones). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden lg:block">
        <div className="absolute left-1/2 top-[38%] -ml-[340px] -mt-[220px] h-[440px] w-[680px] rounded-full bg-[radial-gradient(closest-side,rgba(14,165,233,0.14),rgba(37,99,235,0.07)_55%,transparent)] blur-3xl [animation:copilot-aurora_26s_ease-in-out_infinite] motion-reduce:[animation:none] dark:bg-[radial-gradient(closest-side,rgba(56,189,248,0.2),rgba(37,99,235,0.1)_55%,transparent)]" />
      </div>
      <NovaOrb />
      <div className="mt-5 w-full max-w-2xl sm:mt-6">
        {/* Two deliberate lines at one size, two tones: the greeting (the name in the logo's gradient) over the question. */}
        <h1 className="text-balance text-[30px] font-medium leading-[1.15] tracking-[-0.022em] sm:text-[38px] lg:text-[44px] lg:tracking-[-0.026em]">
          <span className="block text-slate-900 dark:text-white">
            {language === "fr" ? "Bonjour" : "Hi"}{" "}
            <span className="bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 bg-clip-text text-transparent dark:from-cyan-300 dark:via-sky-400 dark:to-blue-500">{firstName}</span>
          </span>{" "}
          <span className="block text-slate-400 dark:text-white/40">{language === "fr" ? "On révise quoi aujourd'hui ?" : "What's on your mind?"}</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-balance text-[15px] leading-relaxed text-slate-500 dark:text-white/50">
          {language === "fr"
            ? "Un module compliqué, un planning à caler, ou juste besoin de souffler ? Je suis là."
            : "A tough module, a study plan to build, or just need a breather? I'm here."}
        </p>
      </div>

      {/* Phones: a tidy 2×3 grid of compact tiles (pills wrapped into five ragged rows there); from sm, centred pills. */}
      <div data-tour="asst-suggestions" className="mt-8 grid w-full max-w-2xl grid-cols-2 gap-2 sm:mt-10 sm:flex sm:flex-wrap sm:justify-center sm:gap-2.5">
        {QUICK_PROMPTS.map((prompt, index) => (
          <motion.button
            key={prompt.text}
            type="button"
            onClick={() => onSelectPrompt(prompt.text)}
            title={prompt.text}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.04, duration: 0.3, ease: "easeOut" }}
            whileTap={{ scale: 0.97 }}
            className={COPILOT_SUGGESTION_CLASSES}
          >
            <prompt.icon className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" strokeWidth={1.75} />
            {prompt.label}
          </motion.button>
        ))}
      </div>
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
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex w-full min-w-0 justify-end"
      >
        <div className="flex min-w-0 max-w-[88%] flex-col items-end gap-1.5 sm:max-w-[75%]">
          {action && (
            <span className="flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              <action.icon className="h-3 w-3" />
              {tAssistant(action.label, language)}
            </span>
          )}
          {attachment?.kind === IMAGE_ENVELOPE_KIND && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL from the chat envelope; next/image cannot optimise it
            <img
              src={attachment.dataUrl}
              alt={attachment.fileName ?? "Image envoyée"}
              className="max-h-64 w-auto max-w-full rounded-3xl rounded-br-lg border border-sky-500/20 object-cover shadow-sm"
            />
          )}
          {attachment?.kind === DOCUMENT_ENVELOPE_KIND && (
            <div className="flex max-w-full items-center gap-2 rounded-3xl rounded-br-lg border border-sky-500/20 bg-sky-50/80 px-3.5 py-2.5 text-sky-800 shadow-sm dark:bg-sky-950/30 dark:text-sky-200">
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
              dir={dominantDirection(attachment ? attachment.caption ?? "" : message.content) ?? "auto"}
              className={COPILOT_USER_BUBBLE_CLASSES}
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
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
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

const ATTACHMENT_ITEMS = [
  { kind: "image" as const, icon: ImageIcon, label: "Importer une image" },
  { kind: "pdf" as const, icon: FileText, label: "Importer un PDF" },
  { kind: "camera" as const, icon: Camera, label: "Prendre une photo" },
];

type AttachmentKind = (typeof ATTACHMENT_ITEMS)[number]["kind"];

/** One line under each attachment choice (desktop menu). */
const ATTACHMENT_HINTS: Record<AttachmentKind, Record<"fr" | "en", string>> = {
  image: { fr: "Schéma, ECG, radio, page de cours", en: "Diagram, ECG, X-ray, course page" },
  pdf: { fr: "Polycopié ou article : le texte est lu", en: "Handout or article: its text is read" },
  camera: { fr: "Photographier une page ou un tableau", en: "Snap a page or a whiteboard" },
};

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
  // Quick action ("QCM", "Flashcards"…) armed for the NEXT message only.
  const [mode, setMode] = useState<AssistantMode | null>(null);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  // The reply this thread is waiting for (lib/copilot-reply-runner.ts runs it),
  // and how to stop watching each reply the page follows.
  const activeReplyIdRef = useRef<string | null>(null);
  const replyWatchersRef = useRef(new Map<string, () => void>());
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
  // The glass header (phones) and composer dock float over the thread; the
  // chat column publishes their measured heights (layout effect below).
  const chatColumnRef = useRef<HTMLDivElement>(null);
  const phoneHeaderRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
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
  // No guided tour opens over a loading history, a reply, a dictation, voice mode, an attachment or the phone keyboard.
  useTourBlocker(!hydrated || isTyping || isListening || isTranscribing || voiceModeOpen || isAttachmentBusy || isPreparingImage || keyboardOpen);

  useEffect(() => {
    setMicSupported(
      typeof navigator !== "undefined" &&
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined"
    );
  }, []);

  // Never leave a reply being read aloud behind a page the student has left.
  // A reply still being generated is NOT stopped: it keeps running
  // (lib/copilot-reply-runner.ts), settles into its saved conversation and is
  // announced — the page only stops watching it.
  useEffect(() => {
    const watchers = replyWatchersRef.current;
    return () => {
      stopSpeaking();
      watchers.forEach((stopWatching) => stopWatching());
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
    // Measured without the placeholder: an empty field's scrollHeight counts
    // the placeholder's wrapped lines (two on a phone), so the empty composer
    // stood two lines tall and snapped down on the first keystroke.
    const placeholder = el.placeholder;
    el.placeholder = "";
    const natural = el.scrollHeight;
    el.placeholder = placeholder;
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

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  // The thread reserves exactly what the floating glass header and composer
  // cover — measured, never guessed: the composer grows with the text, the
  // armed-mode chip and the image preview, and loses its quick-action row
  // while the keyboard is up. Written straight onto the column as CSS
  // variables, so a height change never re-renders this page. Re-attached
  // when the surface remounts (phones portal it into <body>).
  useLayoutEffect(() => {
    const column = chatColumnRef.current;
    if (!column) return;
    const measured: [HTMLDivElement | null, string][] = [
      [phoneHeaderRef.current, "--copilot-header-h"],
      [composerDockRef.current, "--copilot-composer-h"],
    ];
    const publish = () => {
      for (const [el, name] of measured) column.style.setProperty(name, `${el?.offsetHeight ?? 0}px`);
      // Following along: the latest message stays right above the composer as it grows.
      const thread = scrollContainerRef.current;
      if (thread && isAtBottomRef.current) thread.scrollTop = thread.scrollHeight;
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    for (const [el] of measured) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [isPhoneLayout]);

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

  // Desktop popover only: the phone/tablet bottom sheet (a Dialog) handles outside taps itself.
  useEffect(() => {
    if (!isAttachmentMenuOpen || isPhoneLayout) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (attachmentMenuRef.current?.contains(target) || attachmentButtonRef.current?.contains(target)) return;
      setIsAttachmentMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAttachmentMenuOpen, isPhoneLayout]);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    const active = conversations.find((c) => c.id === activeId);
    if (active) {
      setMessages(active.messages);
      resumePendingReply(active.messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // While a reply streams, the thread is saved once as it starts (the question
  // and the pending reply), not on every chunk: a student who leaves
  // mid-answer finds both again, and the reply settles into them.
  const savedThreadRef = useRef("");
  useEffect(() => {
    const thread = messages.map((m) => m.id).join(",");
    if (isTyping && thread === savedThreadRef.current) return;
    savedThreadRef.current = thread;
    saveMessages(messages);
  }, [messages, isTyping, saveMessages]);

  /** Leaving the current thread on purpose: stop whatever is still being read aloud or generated for it — what already arrived stays with that thread. */
  function settleCurrentThread() {
    stopSpeaking();
    const replyId = activeReplyIdRef.current;
    if (replyId) {
      const snapshot = getReplySnapshot(replyId);
      forgetReply(replyId);
      stopReply(replyId);
      replyWatchersRef.current.get(replyId)?.();
      activeReplyIdRef.current = null;
      const content = snapshot ? settledReplyContent(snapshot.status === "streaming" ? { ...snapshot, status: "stopped" } : snapshot) : null;
      const thread = messagesRef.current;
      saveMessages(content === null ? thread.filter((m) => m.id !== replyId) : thread.map((m) => (m.id === replyId ? { id: m.id, role: m.role, content } : m)));
      setIsTyping(false);
    }
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
      resumePendingReply(found.messages);
    }
  }

  function handleDeleteConversation(id: string) {
    const wasActive = id === activeId;
    deleteConversation(id);
    if (wasActive) setMessages([]);
  }

  const userId = auth.user?.id ?? null;
  const replyCopy = useCallback(
    (): ReplyCopy => ({
      noReply: tAssistant("assistantNoReplyError", language),
      empty: "L'assistant n'a rien renvoyé. Réessaie.",
      interrupted: tAssistant("replyInterrupted", language),
      readyTitle: tAssistant("replyReadyTitle", language),
    }),
    [language]
  );

  /**
   * Shows a reply as it arrives (one paint per frame) and settles it in the
   * thread. Resolves when it settles — or when the page stops watching (the
   * thread left on purpose, or the page left while the reply carries on).
   */
  const watchReply = useCallback((replyId: string) => {
    activeReplyIdRef.current = replyId;
    setIsTyping(true);
    return new Promise<void>((resolve) => {
      let frame: number | null = null;
      let latest = "";
      let unsubscribe: () => void = () => undefined;
      const stopWatching = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        unsubscribe();
        replyWatchersRef.current.delete(replyId);
        resolve();
      };
      replyWatchersRef.current.set(replyId, stopWatching);
      unsubscribe = subscribeReply(replyId, (snapshot) => {
        if (snapshot.status === "streaming") {
          latest = snapshot.text;
          if (frame === null) {
            frame = requestAnimationFrame(() => {
              frame = null;
              setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: latest } : m)));
            });
          }
          return;
        }
        // Settled: the text, the "⚠️ …" error line, or nothing (stopped before its first word).
        const content = settledReplyContent(snapshot);
        setMessages((prev) =>
          content === null ? prev.filter((m) => m.id !== replyId) : prev.map((m) => (m.id === replyId ? { id: m.id, role: m.role, content } : m))
        );
        if (activeReplyIdRef.current === replyId) activeReplyIdRef.current = null;
        setIsTyping(false);
        stopWatching();
      });
    });
  }, []);

  const streamAssistantReply = useCallback(
    async (
      userText: string,
      historyForRequest: HistoryTurn[],
      attachments?: { image?: { dataUrl: string; fileName?: string }; document?: { fileName: string; text: string } },
      bypassCache?: boolean,
      requestMode?: AssistantMode
    ) => {
      const assistantId = generateId();
      // Pending until it settles — saved with the thread right away (see the save effect above).
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", pending: true }]);

      // Dashboard Assistant — free-tier only (see app/api/dashboard-assistant/
      // route.ts), never app/api/assistant/route.ts (paid, Sonnet/Haiku).
      // That route rejects `image` explicitly (the free model chain is
      // verified text-only, no vision) rather than silently ignoring it —
      // sendImageMessage below still exists in the UI, but a sent image now
      // surfaces that route's honest 400 the same "⚠️ …" way as any other
      // failure. The reply runs in lib/copilot-reply-runner.ts: it keeps
      // going if the student leaves, and the page only watches it.
      startReply(
        assistantId,
        userId,
        {
          message: userText,
          history: historyForRequest,
          language,
          // The default answer style (no longer adjustable in the chip bar) +
          // the armed quick action; the server validates each against a
          // whitelist (lib/assistant-modes.ts).
          style: DEFAULT_ASSISTANT_PREFS.style,
          stepByStep: DEFAULT_ASSISTANT_PREFS.stepByStep,
          ...(requestMode ? { mode: requestMode } : {}),
          ...(attachments?.image ? { image: attachments.image } : {}),
          ...(attachments?.document ? { document: attachments.document } : {}),
          ...(bypassCache ? { bypassCache: true } : {}),
        },
        replyCopy()
      );
      await watchReply(assistantId);
    },
    [language, userId, replyCopy, watchReply]
  );

  function stopGeneration() {
    haptic();
    if (activeReplyIdRef.current) stopReply(activeReplyIdRef.current);
  }

  /** A thread saved with its last reply still pending (the page was left mid-answer): pick it up — still arriving in this tab, or finished on the server. */
  function resumePendingReply(thread: ChatMessage[]) {
    const last = thread[thread.length - 1];
    if (!last || last.role !== "assistant" || !last.pending || activeReplyIdRef.current === last.id) return;
    resumeReply(last.id, userId, replyCopy(), last.content);
    void watchReply(last.id);
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

  function attachmentLabel(kind: AttachmentKind, fallback: string): string {
    return kind === "image" ? tAssistant("attachImage", language) : kind === "camera" ? tAssistant("attachCamera", language) : fallback;
  }

  /** Closes the menu or sheet and opens the matching native picker — still inside the tap, as iOS requires. */
  function pickAttachment(kind: AttachmentKind) {
    setIsAttachmentMenuOpen(false);
    if (kind === "image") imageInputRef.current?.click();
    else if (kind === "camera") cameraInputRef.current?.click();
    else pdfInputRef.current?.click();
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
      // overscroll-none: the frame itself never rubber-bands (no "void").
      //
      // .copilot-canvas (app/globals.css): the Copilot's own opaque
      // atmosphere — no aurora, mesh grid or video behind the conversation.
      // Below lg this full-screen surface paints it; from lg the shell paints
      // it behind everything (app/dashboard/(shell)/layout.tsx) and this
      // surface stays transparent, with no panel edge boxing the light in.
      className={cn(
        "flex w-full max-w-full overflow-hidden overscroll-none max-lg:copilot-canvas lg:h-full",
        // Portaled on phones, outside the page transition: it fades in over the page it was opened from.
        isPhoneLayout && "copilot-enter",
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

      {/* The chat column. Its header (phones) and composer dock float OVER
          the thread, which dissolves before it reaches them
          (.copilot-thread-fade): their measured heights live here as
          --copilot-header-h / --copilot-composer-h (see the layout effect
          above), and the thread and empty state pad by exactly that much. */}
      <div ref={chatColumnRef} className="relative flex w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        {/* Phone header — the shell hides its Topbar and bottom nav on this
            route below lg (see CHROMELESS_MOBILE_ROUTES), so this page owns
            the full screen and needs its own way back out. */}
        <div
          ref={phoneHeaderRef}
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-1 px-1.5 pb-3 pt-[calc(env(safe-area-inset-top)+0.375rem)] lg:hidden"
        >
          <Link
            href="/dashboard"
            aria-label="Retour au tableau de bord"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-transform active:scale-90 active:bg-accent"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[15px] font-semibold text-foreground">{isEmpty ? "MedArt Copilot" : activeConversationTitle || "MedArt Copilot"}</p>
          </div>
          <TourReplayButton tour="assistant" className="h-10 w-10 rounded-full" />
          <button
            type="button"
            data-tour="asst-history-phone"
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
          // motion-swap: the thread rises in where the welcome screen was (its
          // AnimatePresence mounts with it, so the bubbles' own entrance is skipped).
          <div className="motion-swap relative min-h-0 w-full max-w-full flex-1">
            {/* The thread: overflow-x-hidden + overscroll-x-none + touch-action
                pan-y(+pinch-zoom) means a long token, a wide table or a stray
                horizontal swipe can never move the page sideways. Tables and
                code blocks scroll INSIDE their own wrappers instead. */}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="copilot-thread-fade h-full w-full max-w-full overflow-y-auto overflow-x-hidden overscroll-none [-ms-overflow-style:none] [scrollbar-width:none] [touch-action:pan-y_pinch-zoom] [&::-webkit-scrollbar]:hidden"
            >
              <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-5 px-3 pb-[calc(var(--copilot-composer-h,0px)+1rem)] pt-[calc(var(--copilot-header-h,0px)+1rem)] sm:px-5 md:px-6 md:pb-[calc(var(--copilot-composer-h,0px)+1.5rem)] md:pt-[calc(var(--copilot-header-h,0px)+1.5rem)]">
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

            {/* Back to the latest message: a round arrow-only button that surfaces once the student has scrolled away, filled blue while a reply is streaming (the moment missing it matters most). Centred with inset-x-0 + mx-auto, not a translate: framer-motion owns this element's transform for its entrance, and used to wipe -translate-x-1/2, leaving it off-centre. */}
            <AnimatePresence>
              {!isAtBottom && (
                <motion.button
                  type="button"
                  onClick={() => {
                    haptic();
                    scrollToBottom();
                  }}
                  aria-label={isTyping ? tAssistant("newResponseInProgress", language) : tAssistant("backToBottom", language)}
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "touch-target absolute inset-x-0 bottom-[calc(var(--copilot-composer-h,0px)+0.75rem)] z-10 mx-auto flex h-10 w-10 items-center justify-center rounded-full border shadow-glass transition-colors dark:shadow-glass-dark",
                    isTyping
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

        {/* The composer dock: chips and hub float on the atmosphere itself —
            no bar behind them; the thread dissolves before it gets there
            (.copilot-thread-fade). Bottom safe-area only while the keyboard is
            CLOSED: with it open the home indicator is hidden under the
            keyboard, and keeping that inset is exactly the "awkward gap above
            the keyboard". */}
        <div
          ref={composerDockRef}
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 pt-4 lg:pb-6",
            keyboardOpen ? "pb-2" : "pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          )}
        >
          <div className="mx-auto w-full max-w-3xl">
            <div className="px-3 sm:px-4">
              <div data-tour="asst-composer" className={COPILOT_HUB_CLASSES}>
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
                      <div className="flex items-center gap-2 px-5 pt-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-600 py-1 pl-2.5 pr-1 text-xs font-semibold text-white">
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
                  <div className="flex items-center gap-3 px-4 pt-3.5">
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

                <div className="flex w-full items-end gap-1.5 p-3.5">
                  <div className="relative shrink-0">
                    <button
                      ref={attachmentButtonRef}
                      type="button"
                      data-tour="asst-attach"
                      onClick={() => {
                        haptic();
                        setIsAttachmentMenuOpen((prev) => !prev);
                      }}
                      disabled={isAttachmentBusy || isListening}
                      aria-label={tAssistant("addAttachment", language)}
                      aria-expanded={isAttachmentMenuOpen}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-full text-slate-800 transition-[transform,background-color,color] duration-150 active:scale-90 dark:text-white",
                        isAttachmentBusy || isListening ? "cursor-not-allowed opacity-40" : "hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
                      )}
                    >
                      {isAttachmentBusy ? (
                        <RefreshCw strokeWidth={2} className="h-6 w-6 animate-spin" />
                      ) : (
                        <Plus strokeWidth={2} className={cn("h-6 w-6 transition-transform duration-200", isAttachmentMenuOpen && "rotate-45")} />
                      )}
                    </button>

                    {/* Hidden native file inputs, one per attachment kind (camera gets its own `capture` input rather than sharing the gallery one, matching the ChatRoom.tsx group-chat pattern this mirrors) — triggered programmatically from the menu items below. */}
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChosen} />
                    <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleImageFileChosen} />
                    <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handlePdfFileChosen} />

                    {/* Desktop: a small popover above the button. Phones and tablets get
                        the bottom sheet below instead (AttachmentSheet). */}
                    <AnimatePresence>
                      {isAttachmentMenuOpen && !isPhoneLayout && (
                        <motion.div
                          ref={attachmentMenuRef}
                          initial={{ opacity: 0, y: 12, scale: 0.92 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.14, ease: "easeIn" } }}
                          transition={{ type: "spring", stiffness: 480, damping: 32, mass: 0.7 }}
                          style={{ transformOrigin: "bottom left" }}
                          className="absolute bottom-full left-0 z-50 mb-3 w-80 overflow-hidden rounded-3xl border border-black/[0.06] bg-white/90 p-1.5 text-popover-foreground shadow-[0_24px_60px_-18px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#14171b]/90 dark:shadow-[0_28px_70px_-18px_rgba(0,0,0,0.85)]"
                        >
                          {ATTACHMENT_ITEMS.map(({ kind, icon: Icon, label }, index) => (
                            <motion.button
                              key={kind}
                              type="button"
                              onClick={() => pickAttachment(kind)}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 0.04 + index * 0.035, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                              className="flex min-h-[60px] w-full cursor-pointer items-center gap-3 rounded-2xl px-2.5 text-left transition-colors hover:bg-sky-500/[0.08] focus-visible:bg-sky-500/[0.1] focus-visible:outline-none active:bg-sky-500/[0.14]"
                            >
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_8px_18px_-8px_rgba(14,165,233,0.8)]">
                                <Icon className="h-5 w-5" strokeWidth={1.75} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[15px] font-medium text-foreground">{attachmentLabel(kind, label)}</span>
                                <span className="block truncate text-xs text-muted-foreground">{ATTACHMENT_HINTS[kind][language]}</span>
                              </span>
                            </motion.button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Phones and tablets: the same choices as a bottom sheet that slides up
                        (Dialog's mobile sheet — swipe down or tap outside to dismiss). */}
                    <Dialog open={isAttachmentMenuOpen && isPhoneLayout} onOpenChange={setIsAttachmentMenuOpen}>
                      <DialogContent className="p-0 sm:max-w-sm sm:p-0">
                        <div className="px-4 pb-4 pr-12 pt-7">
                          <DialogTitle className="text-base font-bold">{tAssistant("addAttachment", language)}</DialogTitle>
                          <DialogDescription className="sr-only">{tAssistant("addAttachment", language)}</DialogDescription>
                        </div>
                        <div className="grid grid-cols-3 gap-2.5 px-3 pb-4">
                          {ATTACHMENT_ITEMS.map(({ kind, icon: Icon, label }, index) => (
                            <motion.button
                              key={kind}
                              type="button"
                              onClick={() => pickAttachment(kind)}
                              initial={{ opacity: 0, y: 10, scale: 0.96 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ delay: 0.08 + index * 0.05, type: "spring", stiffness: 420, damping: 30 }}
                              whileTap={{ scale: 0.96 }}
                              className="flex min-h-[112px] flex-col items-center justify-center gap-2.5 rounded-3xl border border-black/[0.06] bg-white/70 px-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 active:bg-sky-500/[0.08] dark:border-white/10 dark:bg-white/[0.04]"
                            >
                              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_10px_22px_-10px_rgba(14,165,233,0.85)]">
                                <Icon className="h-6 w-6" strokeWidth={1.75} />
                              </span>
                              <span className="text-[13px] font-semibold leading-tight text-foreground">{attachmentLabel(kind, label)}</span>
                            </motion.button>
                          ))}
                        </div>
                      </DialogContent>
                    </Dialog>
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
                      className="scrollbar-hide min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2 py-[10px] text-[16px] leading-6 text-foreground outline-none transition-[height] duration-100 ease-out animate-in fade-in-0 placeholder:truncate placeholder:text-slate-400 focus:ring-0 dark:placeholder:text-white/40"
                    />
                  )}

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
                      isListening ? "bg-sky-600 text-white shadow-[0_0_0_4px_rgba(14,165,233,0.18)]" : "text-slate-800 hover:bg-black/[0.06] dark:text-white dark:hover:bg-white/[0.1]",
                      (!micSupported || isTranscribing) && "cursor-not-allowed opacity-40"
                    )}
                  >
                    {isTranscribing ? (
                      <RefreshCw strokeWidth={2} className="h-5 w-5 animate-spin" />
                    ) : isListening ? (
                      <Square className="h-[18px] w-[18px] fill-current" />
                    ) : (
                      <Mic strokeWidth={2} className="h-6 w-6" />
                    )}
                  </button>

                  {/* One fixed slot: voice mode while there's nothing to send, Send once there is, Stop while a reply streams. They swap in place (the old one leaves at once, so a fast second tap can never land on it), and the row never reflows. */}
                  <div className="relative h-11 w-11 shrink-0">
                    <AnimatePresence initial={false}>
                      {isTyping ? (
                        <motion.button
                          key="stop"
                          type="button"
                          onClick={stopGeneration}
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                          whileTap={{ scale: 0.9 }}
                          aria-label={tAssistant("stopGeneration", language)}
                          className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground text-background"
                        >
                          <Square className="h-[18px] w-[18px] fill-current" />
                        </motion.button>
                      ) : canSend && !isListening ? (
                        <motion.button
                          key="send"
                          type="button"
                          onClick={handleSubmit}
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                          whileTap={{ scale: 0.9 }}
                          aria-label={tAssistant("sendMessage", language)}
                          className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_8px_20px_-8px_rgba(14,165,233,0.75)]"
                        >
                          <ArrowUp strokeWidth={2.25} className="h-6 w-6" />
                        </motion.button>
                      ) : (
                        <motion.button
                          key="voice"
                          type="button"
                          onClick={() => {
                            haptic();
                            setVoiceModeOpen(true);
                          }}
                          disabled={!micSupported || isListening}
                          initial={{ scale: 0.6, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                          whileTap={{ scale: 0.9 }}
                          aria-label="Mode vocal"
                          title="Mode vocal (conversation à la voix)"
                          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/[0.06] text-slate-800 transition-colors duration-150 hover:bg-black/[0.1] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/[0.12] dark:text-white dark:hover:bg-white/[0.18]"
                        >
                          <AudioLines strokeWidth={2} className="h-6 w-6" />
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
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
