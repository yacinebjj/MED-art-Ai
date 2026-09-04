"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, ImageIcon, Mic, Send, Square, Stethoscope, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/generate-id";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { useSmartPaste } from "@/hooks/useBlockPaste";
import { useChatTheme } from "@/hooks/useChatTheme";
import { PrintGuard } from "@/components/security/PrintGuard";
import { useLanguage } from "@/providers/LanguageProvider";
import type { Language } from "@/providers/LanguageProvider";
import { tGroups } from "@/lib/translations/groups";
import { ThemePicker } from "./ThemePicker";
import { DayDivider } from "./DayDivider";
import { MessageBubble, type LocalChatMessage } from "./MessageBubble";
import type { ChatMessage } from "@/types/group-chat";

interface ChatRoomProps {
  groupId: string;
}

interface RawMessageRow {
  id: string;
  group_id: string;
  user_id: string;
  type: ChatMessage["type"];
  content_text: string | null;
  media_url: string | null;
  sender_name: string | null;
  created_at: string;
}

function fromRow(row: RawMessageRow): LocalChatMessage {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    type: row.type,
    contentText: row.content_text,
    mediaUrl: row.media_url,
    senderName: row.sender_name,
    createdAt: row.created_at,
    status: "sent",
  };
}

const GROUP_GAP_MS = 5 * 60 * 1000; // consecutive same-sender messages within 5 minutes visually merge into one block.

/** mm:ss chronometer label for the live recording indicator (elapsed seconds since startRecording()). */
function formatRecordingDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Bar count/heights for the live recording indicator's decorative waveform —
// purely animated via staggered CSS delays (no real mic amplitude, same
// honestly-decorative approach as AudioPlayer's playback waveform).
const RECORDING_BAR_HEIGHTS = [10, 18, 24, 14, 20, 12, 22, 16];

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const DAY_LABEL_WITH_YEAR_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function dayLabel(iso: string, language: Language): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return tGroups("todayLabel", language);
  if (diffDays === 1) return "Hier";
  return date.getFullYear() === now.getFullYear() ? DAY_LABEL_FORMAT.format(date) : DAY_LABEL_WITH_YEAR_FORMAT.format(date);
}

type FeedItem = { kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: LocalChatMessage; isFirstInGroup: boolean };

/**
 * Builds the render feed: day dividers inserted where the calendar day
 * changes, plus an isFirstInGroup flag — used only to decide whether to
 * show the sender's name above a bubble (an avatar renders on every row
 * regardless, per the adopted design), not for corner-radius merging.
 */
function buildFeed(messages: LocalChatMessage[], language: Language): FeedItem[] {
  const feed: FeedItem[] = [];
  let lastDay: string | null = null;

  messages.forEach((message, i) => {
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) {
      feed.push({ kind: "day", key: `day-${day}`, label: dayLabel(message.createdAt, language) });
      lastDay = day;
    }

    const prev = messages[i - 1];
    const isFirstInGroup =
      !prev || prev.userId !== message.userId || new Date(prev.createdAt).toDateString() !== day || new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;

    feed.push({ kind: "message", key: message.id, message, isFirstInGroup });
  });

  return feed;
}

/**
 * "Système de Thèmes Médicaux Dynamiques" — decorative background for the
 * chat area, keyed by medical specialty. Declared at module scope (not
 * inside ChatRoom) so this literal array/object is never reallocated on
 * render.
 *
 * `pattern` used to be an inline data-URI SVG (hand-drawn line art) — per
 * explicit product direction this is now a real image generated via
 * OpenRouter's google/gemini-3.1-flash-image-preview ("nano-banana-2", the
 * same model used for the Dashboard illustrations and Studio's Infographie
 * tab), one static file per specialty under public/illustrations/, each
 * prompted for the SAME extremely pale/low-contrast "watermark, not a
 * foreground illustration" register so chat bubbles stay legible on top —
 * see this pattern's own comment on the rendering div below for why it's
 * `cover`, not tiled.
 *
 * Distinct from, and independent of, the bubble-color ThemePicker above
 * (lib/chat-themes.ts / hooks/useChatTheme.ts) — that one recolors MY OWN
 * sent bubbles; this one recolors the room's background. They intentionally
 * use two different localStorage keys (see STORAGE_KEY below) so picking
 * one never silently overwrites the other's saved preference.
 */
interface MedicalTheme {
  id: string;
  /** Translation key for the displayed label (lib/translations/groups.ts) — `id` above stays untranslated since it's the localStorage/lookup key. */
  nameKey: Parameters<typeof tGroups>[0];
  color: string;
  bgClass: string;
  pattern: string;
}

const medicalThemes: MedicalTheme[] = [
  {
    id: "cardiologie",
    nameKey: "cardiologyThemeName",
    color: "bg-rose-500",
    bgClass: "bg-rose-50/50 dark:bg-rose-950/20",
    pattern: `url("/illustrations/group-chat-bg-cardiologie.jpeg")`,
  },
  {
    id: "neurologie",
    nameKey: "neurologyThemeName",
    color: "bg-indigo-500",
    bgClass: "bg-indigo-50/50 dark:bg-indigo-950/20",
    pattern: `url("/illustrations/group-chat-bg-neurologie.jpeg")`,
  },
  {
    id: "pneumologie",
    nameKey: "pneumologyThemeName",
    color: "bg-cyan-500",
    bgClass: "bg-cyan-50/50 dark:bg-cyan-950/20",
    pattern: `url("/illustrations/group-chat-bg-pneumologie.jpeg")`,
  },
  {
    id: "infectiologie",
    nameKey: "infectiologyThemeName",
    color: "bg-emerald-500",
    bgClass: "bg-emerald-50/50 dark:bg-emerald-950/20",
    pattern: `url("/illustrations/group-chat-bg-infectiologie.jpeg")`,
  },
];

// Deliberately NOT "medart_chat_theme" as literally suggested — that key
// already belongs to hooks/useChatTheme.ts's bubble-color preference.
// Reusing it here would make picking a background silently corrupt the
// saved bubble theme (and vice versa), the exact kind of regression this
// feature's own brief says never to introduce.
const MEDICAL_THEME_STORAGE_KEY = "medart_chat_background_theme";

/**
 * The Messenger-style chat room — history fetched once via GET
 * /api/groups/[id]/messages, then kept live by subscribing DIRECTLY to
 * Supabase Realtime with the browser client (lib/supabase/client.ts). This
 * is the one place in the whole app that talks to Supabase's data plane as
 * the user rather than through a server route — see chat_messages' RLS
 * policy comment in supabase/schema.sql for why that's unavoidable here.
 */
export function ChatRoom({ groupId }: ChatRoomProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { language } = useLanguage();
  const { theme, themeId, selectTheme } = useChatTheme();

  const [groupName, setGroupName] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const handlePaste = useSmartPaste({ value: input, onChange: setInput });
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // "Système de Thèmes Médicaux Dynamiques" state — background pattern only,
  // independent of the bubble-color theme above.
  const [activeTheme, setActiveTheme] = useState<MedicalTheme>(medicalThemes[0]);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const feed = useMemo(() => buildFeed(messages, language), [messages, language]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  // Restore the saved background theme (if any) on mount.
  useEffect(() => {
    const savedId = localStorage.getItem(MEDICAL_THEME_STORAGE_KEY);
    if (!savedId) return;
    const saved = medicalThemes.find((t) => t.id === savedId);
    if (saved) setActiveTheme(saved);
  }, []);

  function handleThemeChange(next: MedicalTheme) {
    setActiveTheme(next);
    localStorage.setItem(MEDICAL_THEME_STORAGE_KEY, next.id);
    setIsThemeMenuOpen(false);
  }

  useEffect(() => {
    let cancelled = false;

    /**
     * Merges a fresh server snapshot into local state instead of replacing
     * it outright — a bare replace would silently drop any not-yet-confirmed
     * optimistic message (still `temp-*`, sent while offline/backgrounded)
     * that the server doesn't know about yet.
     */
    function mergeServerMessages(serverMessages: LocalChatMessage[]) {
      setMessages((prev) => {
        const pendingLocal = prev.filter((m) => m.id.startsWith("temp-"));
        return [...serverMessages, ...pendingLocal].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });
    }

    async function fetchMessages() {
      const messagesRes = await fetch(`/api/groups/${groupId}/messages`).then((r) => r.json());
      if (cancelled || !messagesRes.success) return;
      mergeServerMessages((messagesRes.messages as ChatMessage[]).map((m) => ({ ...m, status: "sent" as const })));
    }

    async function bootstrap() {
      const [groupRes] = await Promise.all([fetch(`/api/groups/${groupId}`).then((r) => r.json()), fetchMessages()]);
      if (cancelled) return;

      if (!groupRes.success) {
        setAccessError(groupRes.error ?? "Impossible d'accéder à ce groupe.");
        return;
      }
      setGroupName(groupRes.group.name);
    }

    // Mobile-specific gap this closes: Realtime's `postgres_changes` only
    // pushes messages sent WHILE the client is actively connected — it
    // never backfills a gap. A mobile browser tab backgrounded for a while
    // (the student switches apps, or the OS just suspends the socket to
    // save battery) can silently miss a message; the socket itself
    // reconnects on its own once the tab is foregrounded again (that's
    // supabase-js's own job), but anything sent during the gap is gone
    // unless something re-fetches. This does exactly that, every time the
    // tab becomes visible again — cheap (one GET), and merged rather than
    // replacing state so it never clobbers a message still mid-send.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") fetchMessages();
    }

    bootstrap();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [groupId]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`group-messages-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row = payload.new as RawMessageRow;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, fromRow(row)]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);

  /** Sends (or re-sends, on retry) a text message. `existing` is set only when retrying an already-optimistic, failed message — reuses its id instead of minting a new temp one. */
  async function sendText(text: string, existing?: LocalChatMessage) {
    const tempId = existing?.id ?? `temp-${generateId()}`;

    if (existing) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending" } : m)));
    } else {
      const optimistic: LocalChatMessage = {
        id: tempId,
        groupId,
        userId: user?.id ?? "",
        type: "text",
        contentText: text,
        mediaUrl: null,
        senderName: typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
        createdAt: new Date().toISOString(),
        status: "sending",
      };
      setMessages((prev) => [...prev, optimistic]);
    }

    try {
      const res = await fetch(`/api/groups/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentText: text }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'envoi a échoué.");

      const confirmed: LocalChatMessage = { ...data.message, status: "sent" };
      setMessages((prev) => {
        // Drop a duplicate the Realtime subscription may have already
        // delivered under the real id (a genuine race: the INSERT event can
        // arrive before this fetch() resolves) before renaming the
        // optimistic placeholder to that same real id/content.
        const withoutRealtimeDup = prev.filter((m) => m.id !== confirmed.id);
        return withoutRealtimeDup.map((m) => (m.id === tempId ? confirmed : m));
      });
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)));
      toast({ variant: "error", title: err instanceof Error ? err.message : "L'envoi a échoué." });
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendText(text);
  }

  function handleRetry(message: LocalChatMessage) {
    if (message.type === "text" && message.contentText) {
      sendText(message.contentText, message);
    }
  }

  async function uploadMedia(file: File) {
    setIsUploadingMedia(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/groups/${groupId}/media`, { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'envoi a échoué.");
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, { ...data.message, status: "sent" }]));
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "L'envoi a échoué." });
    } finally {
      setIsUploadingMedia(false);
    }
  }

  /** Stops the chronometer interval driving the recording indicator's mm:ss display — idempotent, safe to call even if it was never started or already cleared. */
  function clearRecordingTimer() {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }

  async function startRecording() {
    if (typeof MediaRecorder === "undefined") {
      toast({ variant: "error", title: "L'enregistrement vocal n'est pas supporté par ce navigateur." });
      return;
    }

    // getUserMedia (like crypto.randomUUID) only exists in a secure context
    // (HTTPS, or localhost). Over plain HTTP on a LAN/local IP the browser
    // doesn't expose mediaDevices at all — catching that here gives a clear
    // explanation instead of the generic message below.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      toast({
        variant: "error",
        title: "L'enregistrement vocal nécessite une connexion sécurisée (HTTPS) ou localhost.",
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ variant: "error", title: "Le microphone n'est pas accessible sur cette connexion (HTTPS ou localhost requis)." });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        clearRecordingTimer();
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        if (blob.size > 0) uploadMedia(new File([blob], "vocal.webm", { type: "audio/webm" }));
      };
      // A mid-recording failure (device unplugged, driver error, ...) puts the
      // recorder into "inactive" without ever firing onstop — without this,
      // isRecording would stay stuck true forever with no way to clear it,
      // since a later stopRecording() call would then throw on an
      // already-inactive recorder instead of resetting state.
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        clearRecordingTimer();
        setIsRecording(false);
        toast({ variant: "error", title: "L'enregistrement a été interrompu." });
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingIntervalRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      toast({ variant: "error", title: "Impossible d'accéder au micro." });
    }
  }

  function stopRecording() {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      // Already inactive (e.g. the device errored out mid-recording) —
      // nothing left to stop, but the UI must still fall back out of
      // "recording" state below rather than staying stuck.
    } finally {
      setIsRecording(false);
      clearRecordingTimer();
    }
  }

  // If the student navigates away from the group mid-recording, the mic
  // stream must not keep running in the background — a real privacy/battery
  // leak otherwise, since only the Square button's onClick used to stop it.
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stream.getTracks().forEach((track) => track.stop());
      }
      clearRecordingTimer();
    };
  }, []);

  if (accessError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">{accessError}</p>
        <Link href="/dashboard/groups" className="text-sm font-semibold text-primary hover:underline">
          {tGroups("backToGroups", language)}
        </Link>
      </div>
    );
  }

  return (
    // Below `lg` (the same breakpoint Sidebar/MobileBottomNav switch on),
    // this breaks out of the shell's padded/rounded card via `fixed inset-0`
    // to cover the whole viewport (z-50 clears MobileBottomNav's z-40) —
    // true edge-to-edge Messenger-style chat on mobile, no shell chrome
    // showing through. `lg:static` hands control back to the dashboard
    // shell's page.tsx wrapper (the rounded-3xl bordered card) unchanged.
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-screen min-h-0 flex-col bg-background lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-auto lg:bg-transparent">
      <PrintGuard />

      <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-border/60 bg-card/70 px-3 py-3 backdrop-blur-xl">
        <Link
          href="/dashboard/groups"
          aria-label={tGroups("backToGroups", language)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-foreground shadow-lg backdrop-blur-md transition-all duration-200 hover:-translate-x-0.5 hover:bg-white/20 active:scale-90"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <p className="flex-1 truncate text-sm font-bold tracking-tight text-foreground">{groupName ?? "..."}</p>

        <ThemePicker themeId={themeId} onSelect={selectTheme} />

        {/* Medical background-theme picker — separate button/popover from ThemePicker above (different icon, different concern: room background vs. my own bubble color). */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsThemeMenuOpen((open) => !open)}
            className="rounded-full p-1.5 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground active:scale-90"
            aria-label="Choisir un thème médical de fond"
            title={tGroups("medicalThemeTitle", language)}
          >
            <Stethoscope className="h-4 w-4" />
          </button>

          <AnimatePresence>
            {isThemeMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsThemeMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full z-50 mt-2 w-52 rounded-2xl border border-border/60 bg-card/90 p-1.5 shadow-glass backdrop-blur-xl dark:shadow-glass-dark"
                >
                  {medicalThemes.map((themeOption) => {
                    const isActive = themeOption.id === activeTheme.id;
                    return (
                      <button
                        key={themeOption.id}
                        type="button"
                        onClick={() => handleThemeChange(themeOption)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-all duration-150 active:scale-[0.98]",
                          isActive ? "bg-accent font-semibold text-foreground" : "text-muted-foreground hover:translate-x-0.5 hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", themeOption.color)} />
                        <span className="flex-1">{tGroups(themeOption.nameKey, language)}</span>
                        {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Rounded, softly-tinted panel holding both the feed and the input card. `relative` anchors the absolutely-positioned SVG pattern layer below; bgClass/transition come from the active medical theme. */}
      <div className={cn("relative flex min-h-0 flex-1 flex-col gap-3 p-3 transition-colors duration-500", activeTheme.bgClass)}>
        {/* cover/center/no-repeat, not a small tiled size — these are real
            generated photos (1024x1024), not infinitely-tileable vector
            SVGs; each one's pattern is dense/uniform enough across the
            whole canvas that stretching it to cover reads as a rich full
            background without ever risking a visible tile seam. */}
        <div
          className="absolute inset-0 z-0 pointer-events-none transition-all duration-500"
          style={{ backgroundImage: activeTheme.pattern, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
        />

        {/* z-10 relative is load-bearing here: without it, this scroll region would sit in the same stacking context as the absolutely-positioned pattern layer above and could end up behind it, breaking message legibility and audio-player clicks. */}
        <div className="relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
          <AnimatePresence initial={false}>
            {feed.map((item) =>
              item.kind === "day" ? (
                <DayDivider key={item.key} label={item.label} />
              ) : (
                <MessageBubble
                  key={item.key}
                  message={item.message}
                  isMine={item.message.userId === user?.id}
                  isFirstInGroup={item.isFirstInGroup}
                  theme={theme}
                  onRetry={handleRetry}
                />
              )
            )}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="relative z-10 flex shrink-0 items-center gap-1.5 rounded-2xl border border-border/50 bg-card/90 px-3 py-2 shadow-glass backdrop-blur-xl transition-shadow duration-300 focus-within:shadow-glow dark:shadow-glass-dark"
        >
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); e.target.value = ""; }} />
          <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); e.target.value = ""; }} />

          <button type="button" onClick={() => imageInputRef.current?.click()} disabled={isUploadingMedia || isRecording} className="rounded-full p-2 text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-foreground active:scale-90 disabled:opacity-50 disabled:hover:translate-y-0" aria-label={tGroups("sendImageAriaLabel", language)}>
            <ImageIcon className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => videoInputRef.current?.click()} disabled={isUploadingMedia || isRecording} className="rounded-full p-2 text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent hover:text-foreground active:scale-90 disabled:opacity-50 disabled:hover:translate-y-0" aria-label={tGroups("sendVideoAriaLabel", language)}>
            <Video className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isUploadingMedia}
            className={cn(
              "rounded-full p-2 transition-all duration-200 active:scale-90 disabled:opacity-50",
              isRecording ? "bg-destructive/10 text-destructive animate-pulse" : "text-muted-foreground hover:-translate-y-0.5 hover:bg-accent hover:text-foreground"
            )}
            aria-label={isRecording ? tGroups("stopRecordingAriaLabel", language) : tGroups("voiceMessageAriaLabel", language)}
          >
            {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {/* Live recording indicator — replaces the text input while a voice
              note is being captured, so it's obvious recording is in progress
              (a chronometer plus a decorative animated waveform), not just
              the mic button's own pulse. */}
          {isRecording ? (
            <div className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5" role="status" aria-live="polite">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
              <div className="flex flex-1 items-center gap-[3px]">
                {RECORDING_BAR_HEIGHTS.map((height, i) => (
                  <span
                    key={i}
                    style={{ height: `${height}px`, animationDelay: `${i * 90}ms` }}
                    className="w-[3px] shrink-0 animate-pulse rounded-full bg-destructive/70"
                  />
                ))}
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-destructive">{formatRecordingDuration(recordingSeconds)}</span>
            </div>
          ) : (
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              placeholder={tGroups("messagePlaceholder", language)}
              className="h-10 flex-1 rounded-xl border border-input bg-transparent px-3.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <button
            type="submit"
            disabled={!input.trim() || isRecording}
            aria-label={tGroups("sendButton", language)}
            className="flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-sm font-semibold text-white shadow-soft transition-all duration-200 hover:bg-primary-700 hover:shadow-glow active:scale-95 disabled:opacity-50 disabled:hover:shadow-soft sm:w-auto sm:px-4 sm:py-2"
          >
            <span className="hidden sm:inline">{tGroups("sendButton", language)}</span>
            <Send className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
