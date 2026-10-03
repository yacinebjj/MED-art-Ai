"use client";

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowLeft,
  AtSign,
  BarChart3,
  Bookmark,
  Check,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Settings2,
  Smile,
  Square,
  Stethoscope,
  Users,
  Video,
  X,
} from "lucide-react";
import { gradientFor } from "@/lib/group-avatar-gradient";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/generate-id";
import { EMOJI_CATEGORIES } from "@/lib/composer-emoji";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { useSmartPaste } from "@/hooks/useBlockPaste";
import { useChatTheme } from "@/hooks/useChatTheme";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useSavedMessages } from "@/hooks/useSavedMessages";
import { PrintGuard } from "@/components/security/PrintGuard";
import { useLanguage } from "@/providers/LanguageProvider";
import type { Language } from "@/providers/LanguageProvider";
import { tGroups } from "@/lib/translations/groups";
import { ThemePicker } from "./ThemePicker";
import { DayDivider } from "./DayDivider";
import { MemberDrawer } from "./MemberDrawer";
import { MediaVaultPanel } from "./MediaVaultPanel";
import { SavedMessagesPanel } from "./SavedMessagesPanel";
import { CommandPalette } from "./CommandPalette";
import { MessageBubble, type LocalChatMessage, type MessageReceipt } from "./MessageBubble";
import { GroupSettingsPanel } from "./GroupSettingsPanel";
import { PollComposer } from "./PollComposer";
import { applyPollVote, decodeEnvelope, encodeEnvelope, excerpt, previewText, type ChatPoll, type MessageEnvelope } from "@/lib/group-chat-envelope";
import type { ChatGroup, ChatMember, ChatMessage, MessageReactions } from "@/types/group-chat";

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
  reactions: MessageReactions | null;
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
    reactions: row.reactions ?? {},
    status: "sent",
  };
}

/** How long a "typing" broadcast stays valid before this client treats that student as having stopped — see the presence/typing effect below. Broadcasts, unlike postgres_changes, never persist, so a client that goes away mid-typing (closed tab, lost connection) would otherwise leave a stale "en train d'écrire" forever without this. */
const TYPING_TIMEOUT_MS = 4000;
/** Minimum gap between two "I'm typing" broadcasts from this client — every keystroke would otherwise flood the channel. */
const TYPING_BROADCAST_THROTTLE_MS = 2000;

const GROUP_GAP_MS = 5 * 60 * 1000; // consecutive same-sender messages within 5 minutes visually merge into one block.

/** Minimum gap between two "I've read up to now" updates (presence + last_read_at) while the chat is open. */
const READ_MARK_THROTTLE_MS = 4000;
const COMPOSER_MAX_HEIGHT_PX = 160;
const ACCEPTED_DOCUMENT_TYPES = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt";

/** The "@word" being typed right before the caret, if any (for the mention autocomplete). */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\p{L}\p{N}_.-]{0,30})$/u.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

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
  pattern: string;
}

// No more per-theme `bgClass` (light pastel wash) — the room itself is now
// a fixed dark canvas regardless of theme (see the dark-glass redesign
// below), so each specialty's own pattern image renders directly over that
// canvas at low opacity instead of over a colored background of its own.
const medicalThemes: MedicalTheme[] = [
  {
    id: "cardiologie",
    nameKey: "cardiologyThemeName",
    color: "bg-rose-500",
    pattern: `url("/illustrations/group-chat-bg-cardiologie.jpeg")`,
  },
  {
    id: "neurologie",
    nameKey: "neurologyThemeName",
    color: "bg-indigo-500",
    pattern: `url("/illustrations/group-chat-bg-neurologie.jpeg")`,
  },
  {
    id: "pneumologie",
    nameKey: "pneumologyThemeName",
    color: "bg-cyan-500",
    pattern: `url("/illustrations/group-chat-bg-pneumologie.jpeg")`,
  },
  {
    id: "infectiologie",
    nameKey: "infectiologyThemeName",
    color: "bg-emerald-500",
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

  const [group, setGroup] = useState<ChatGroup | null>(null);
  const groupName = group?.name ?? null;
  const groupAdminId = group?.adminId ?? null;
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const handlePaste = useSmartPaste({ value: input, onChange: setInput });
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isMemberDrawerOpen, setIsMemberDrawerOpen] = useState(false);
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [isSavedOpen, setIsSavedOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPollComposerOpen, setIsPollComposerOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<LocalChatMessage | null>(null);
  // Mentions picked from the autocomplete: display name -> user id. The
  // textarea shows a readable "@Name"; it becomes a "@[Name](id)" token on send.
  const pickedMentionsRef = useRef<Map<string, string>>(new Map());
  const [mentionState, setMentionState] = useState<{ start: number; query: string; index: number } | null>(null);
  // Live "read up to" per member from Realtime presence (who has the chat open, and until when).
  const [presenceReadAt, setPresenceReadAt] = useState<Record<string, string>>({});
  // Messages another member's client had a live connection for — sticky once true.
  const [deliveredIds, setDeliveredIds] = useState<Set<string>>(new Set());
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const lastReadMarkRef = useRef(0);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Lifted out of MemberDrawer (which used to fetch its own copy only while
  // open) so ONE fetch of GET /api/groups/[id]/members can drive both the
  // drawer AND each MessageBubble's real academic-year badge below.
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const { saved: savedMessages, isSaved, toggle: toggleSaved, remove: removeSaved } = useSavedMessages();
  // Desktop-only "expand to cover the whole viewport" toggle — distinct
  // from the existing `lg:static`/`fixed` responsive split below (which
  // already goes edge-to-edge under `lg` unconditionally); this lets a
  // student on a wide screen do the same on demand. z-[100] clears this
  // component's own normal z-50 mobile layer too, so toggling it on
  // desktop can never end up UNDER the mobile-width fixed layer's stacking
  // order if the viewport is resized while open.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // iOS doesn't shrink 100dvh for the keyboard — same fix as the Assistant composer.
  const keyboardInset = useKeyboardInset();
  // Shown once the feed is scrolled up far enough that the latest message
  // is out of view — never shown from a fabricated "new messages" count,
  // just real scroll position (see handleFeedScroll below).
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Real presence — who's actually connected right now (Supabase Realtime
  // Presence, an in-memory channel feature with no table/column of its own,
  // see supabase/schema.sql's migration comment for why reactions/pin DID
  // need a schema change and this deliberately doesn't). Never fabricated:
  // if the presence channel hasn't synced yet, this is just empty rather
  // than showing everyone as "hors ligne".
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  // Real typing signal — Supabase Realtime Broadcast (also no persistence),
  // pruned by the interval in the effect below. Keyed by userId so the same
  // student re-broadcasting just refreshes their own timestamp.
  const [typingUsers, setTypingUsers] = useState<Record<string, { displayName: string | null; at: number }>>({});
  const lastTypingBroadcastAtRef = useRef(0);

  // "Système de Thèmes Médicaux Dynamiques" state — background pattern only,
  // independent of the bubble-color theme above.
  const [activeTheme, setActiveTheme] = useState<MedicalTheme>(medicalThemes[0]);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // Closes a real race: startRecording awaits getUserMedia before it sets
  // mediaRecorderRef/isRecording, so two rapid clicks on the mic button
  // (both still seeing isRecording === false, since React hasn't re-rendered
  // between them yet) could otherwise both reach getUserMedia and leave one
  // stream's mic running with nothing referencing it to stop later. Set
  // synchronously at the top of startRecording, before any `await`.
  const isStartingRecordingRef = useRef(false);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  // Caret position to restore once `input`'s new value actually lands in the
  // DOM — see insertEmoji below for why this can't just be a
  // requestAnimationFrame call at insert time.
  const pendingCaretRef = useRef<number | null>(null);

  const feed = useMemo(() => buildFeed(messages, language), [messages, language]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  /** Scrolls a specific message into view (pinned-bar "jump to" and the Command Palette's message results) — real DOM lookup by id, not a fabricated position. */
  function jumpToMessage(messageId: string) {
    document.getElementById(`chat-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Real curriculum year per sender (profiles.academic_year_id ->
  // curriculum_academic_years.name, joined server-side — see
  // app/api/groups/[id]/members/route.ts), keyed by userId for O(1) lookup
  // per message bubble. Empty until `members` has loaded.
  const academicYearByUserId = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members ?? []) {
      if (member.academicYearName) map.set(member.userId, member.academicYearName);
    }
    return map;
  }, [members]);

  /** Shows the "scroll to bottom" FAB once the feed is scrolled more than ~1.5 message-rows away from its true bottom — real scroll math, not a fabricated unread count. */
  function handleFeedScroll() {
    const el = feedRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 150);
  }

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

    // Fire-and-forget — bumps chat_members.last_read_at so the groups lobby
    // list's unread badge (GET /api/groups) clears next time it's fetched.
    // Never blocks/gates anything else here: a failed mark-as-read (offline,
    // rate-limited) just means the badge stays a little stale, not a broken
    // chat room.
    function markAsRead() {
      fetch(`/api/groups/${groupId}/read`, { method: "POST" }).catch(() => {});
    }

    async function bootstrap() {
      const [groupRes] = await Promise.all([fetch(`/api/groups/${groupId}`).then((r) => r.json()), fetchMessages()]);
      if (cancelled) return;

      if (!groupRes.success) {
        setAccessError(groupRes.error ?? "Impossible d'accéder à ce groupe.");
        return;
      }
      setGroup(groupRes.group as ChatGroup);
      setPinnedMessageId(groupRes.group.pinnedMessageId ?? null);
      markAsRead();
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
      if (document.visibilityState === "visible") {
        fetchMessages();
        markAsRead();
      }
    }

    bootstrap();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [groupId]);

  // The member roster — real data (accepted members only), used by
  // MemberDrawer, each MessageBubble's academic-year badge, and the Command
  // Palette's "Membres" section. Fetched once per group, not re-fetched on
  // every drawer open (that used to be MemberDrawer's own job).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/groups/${groupId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success) return;
        setMembers((data.members as ChatMember[]).filter((m) => m.status === "accepted"));
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // Global Ctrl/Cmd+K — opens the Command Palette from anywhere in the room,
  // not just while the composer input has focus.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      // Additive to the INSERT handling above — a reaction toggle (see
      // handleReact) is a plain UPDATE on an existing row, not a new
      // message, so it needs its own event type rather than replacing
      // anything here. Patches the existing message in place by id; a
      // message this client hasn't loaded yet (shouldn't happen in
      // practice — you can't react to a message you can't see) is a no-op.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `group_id=eq.${groupId}` },
        (payload) => {
          const row = payload.new as RawMessageRow;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, reactions: row.reactions ?? {} } : m)));
        }
      )
      .subscribe();

    // A pin/unpin (see handleTogglePin) updates chat_groups, not
    // chat_messages — its own channel/subscription rather than overloading
    // the message one above, since it's a structurally different table and
    // payload shape.
    const groupChannel = supabase
      .channel(`group-meta-${groupId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_groups", filter: `id=eq.${groupId}` },
        (payload) => {
          const row = payload.new as { pinned_message_id: string | null; name?: string; admin_id?: string; join_code?: string };
          setPinnedMessageId(row.pinned_message_id ?? null);
          setGroup((prev) =>
            prev
              ? { ...prev, name: row.name ?? prev.name, adminId: row.admin_id ?? prev.adminId, joinCode: row.join_code ?? prev.joinCode }
              : prev
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(groupChannel);
    };
  }, [groupId]);

  // Real presence (who's actually connected) + real typing broadcast — both
  // Supabase Realtime features that need no table/column of their own (see
  // this file's own state comments above). One effect since both are
  // ephemeral, per-connection channels scoped to this same groupId/user and
  // torn down together.
  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

    const presenceChannel = supabase.channel(`presence-group-${groupId}`, { config: { presence: { key: user.id } } });
    presenceChannel
      .on("presence", { event: "sync" }, () => {
        const state = presenceChannel.presenceState<{ userId?: string; readAt?: string | null }>();
        setOnlineUserIds(new Set(Object.keys(state)));
        const readAt: Record<string, string> = {};
        for (const [key, metas] of Object.entries(state)) {
          const latest = metas.map((m) => m.readAt).filter((v): v is string => typeof v === "string").sort().pop();
          if (latest) readAt[key] = latest;
        }
        setPresenceReadAt(readAt);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          const visible = document.visibilityState === "visible";
          void presenceChannel.track({ userId: user.id, displayName, readAt: visible ? new Date().toISOString() : null });
        }
      });
    presenceChannelRef.current = presenceChannel;

    const typingChannel = supabase.channel(`typing-group-${groupId}`);
    typingChannel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const typingUserId = payload?.userId;
        if (!typingUserId || typingUserId === user.id) return; // never show yourself as "typing"
        setTypingUsers((prev) => ({ ...prev, [typingUserId]: { displayName: payload?.displayName ?? null, at: Date.now() } }));
      })
      .subscribe();

    // Prunes any typing entry older than TYPING_TIMEOUT_MS every second —
    // the only way this client learns a typing student went quiet, since a
    // broadcast channel has no "they disconnected" signal of its own (unlike
    // presence, which fsyncs on disconnect).
    const pruneInterval = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => now - v.at < TYPING_TIMEOUT_MS));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);

    typingChannelRef.current = typingChannel;

    return () => {
      clearInterval(pruneInterval);
      typingChannelRef.current = null;
      presenceChannelRef.current = null;
      supabase.removeChannel(presenceChannel);
      supabase.removeChannel(typingChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, user?.id]);

  /** Broadcasts "I'm typing" at most once per TYPING_BROADCAST_THROTTLE_MS — called from the text input's onChange below. */
  function notifyTyping() {
    if (!user || !typingChannelRef.current) return;
    const now = Date.now();
    if (now - lastTypingBroadcastAtRef.current < TYPING_BROADCAST_THROTTLE_MS) return;
    lastTypingBroadcastAtRef.current = now;
    const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
    void typingChannelRef.current.send({ type: "broadcast", event: "typing", payload: { userId: user.id, displayName } });
  }

  /**
   * "I've seen everything up to now": refreshes my presence readAt (live
   * "Vu" for whoever is connected) and chat_members.last_read_at (persistent
   * "Vu" + lobby unread badge). Only while the tab is visible and the feed is
   * near its bottom; throttled.
   */
  function markSeenNow(force = false) {
    if (!user || document.visibilityState !== "visible") return;
    const el = feedRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 200) return;
    const now = Date.now();
    if (!force && now - lastReadMarkRef.current < READ_MARK_THROTTLE_MS) return;
    lastReadMarkRef.current = now;
    const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
    void presenceChannelRef.current?.track({ userId: user.id, displayName, readAt: new Date(now).toISOString() });
    fetch(`/api/groups/${groupId}/read`, { method: "POST" }).catch(() => {});
  }

  // New messages arriving while I'm looking at the bottom of the chat count as seen.
  useEffect(() => {
    markSeenNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Delivered: another member's client is connected while my message exists (sticky).
  useEffect(() => {
    if (!user) return;
    const othersOnline = Array.from(onlineUserIds).some((id) => id !== user.id);
    if (!othersOnline) return;
    setDeliveredIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const m of messages) {
        if (m.userId === user.id && m.status === "sent" && !next.has(m.id)) {
          next.add(m.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [onlineUserIds, messages, user]);

  /** Latest moment each OTHER member is known to have had the chat open (presence, else persisted last_read_at). */
  const othersReadAt = useMemo(() => {
    const readAt: string[] = [];
    const ids = new Set<string>([...Object.keys(presenceReadAt), ...(members ?? []).map((m) => m.userId)]);
    for (const id of ids) {
      if (id === user?.id) continue;
      const live = presenceReadAt[id];
      const stored = members?.find((m) => m.userId === id)?.lastReadAt ?? null;
      const best = [live, stored].filter((v): v is string => typeof v === "string").sort().pop();
      if (best) readAt.push(best);
    }
    return readAt.sort().pop() ?? null;
  }, [presenceReadAt, members, user?.id]);

  function receiptFor(message: LocalChatMessage): MessageReceipt {
    if (message.status === "sending") return "sending";
    if (message.status === "failed") return "failed";
    if (othersReadAt && othersReadAt >= message.createdAt) return "seen";
    if (deliveredIds.has(message.id)) return "delivered";
    return "sent";
  }

  /**
   * Inserts an emoji at the text input's current cursor position (not just
   * appended to the end) and hands focus back to it, so picking one
   * mid-sentence doesn't scatter the caret. Falls back to appending when the
   * input isn't mounted (recording view replaces it) or has no tracked
   * selection.
   *
   * The caret restore itself is NOT done here via requestAnimationFrame —
   * this is a controlled input, so `setInput` only *schedules* the DOM's
   * `.value` to change. Calling setSelectionRange before React actually
   * commits that new value loses the race in practice: the browser resets
   * the caret to the end of the input the moment `.value` is next written,
   * which can happen after the rAF fires. Recording the target position in a
   * ref and restoring it from a `useLayoutEffect` keyed on `input` (below)
   * runs synchronously right after the real DOM commit instead, so there's
   * no race to lose.
   */
  function insertEmoji(emoji: string) {
    const el = messageInputRef.current;
    const selectionStart = el?.selectionStart ?? input.length;
    const selectionEnd = el?.selectionEnd ?? input.length;
    const nextValue = input.slice(0, selectionStart) + emoji + input.slice(selectionEnd);
    pendingCaretRef.current = selectionStart + emoji.length;
    setInput(nextValue);
    notifyTyping();
    setIsEmojiPickerOpen(false);
  }

  useLayoutEffect(() => {
    if (pendingCaretRef.current === null) return;
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = messageInputRef.current;
    el?.focus();
    el?.setSelectionRange(caret, caret);
  }, [input]);

  /** Sends (or re-sends, on retry) a text message — optionally a reply and/or a poll. `existing` is set only when retrying an already-optimistic, failed message — reuses its id instead of minting a new temp one. */
  async function sendText(text: string, existing?: LocalChatMessage, extras?: { replyTo?: LocalChatMessage | null; poll?: { question: string; options: string[]; multi: boolean } }) {
    const tempId = existing?.id ?? `temp-${generateId()}`;
    // Optimistic envelope, so the reply quote / poll render instantly; the server rebuilds and validates its own.
    const replyRef = extras?.replyTo
      ? {
          id: extras.replyTo.id,
          senderName: extras.replyTo.senderName,
          excerpt: excerpt(extras.replyTo.type === "text" ? previewText(extras.replyTo.contentText) : extras.replyTo.type === "image" ? "📷 Photo" : extras.replyTo.type === "video" ? "🎥 Vidéo" : "🎤 Message vocal"),
        }
      : undefined;
    const optimisticPoll: ChatPoll | undefined = extras?.poll
      ? { question: extras.poll.question, options: extras.poll.options.map((label, i) => ({ id: `o${i + 1}`, label })), multi: extras.poll.multi }
      : undefined;
    const optimisticContent = existing
      ? existing.contentText
      : encodeEnvelope({ text, ...(replyRef ? { replyTo: replyRef } : {}), ...(optimisticPoll ? { poll: optimisticPoll } : {}) } satisfies MessageEnvelope);
    // On retry, rebuild the request from the failed message's own envelope.
    const retryEnvelope = existing ? decodeEnvelope(existing.contentText) : null;
    const requestBody = {
      contentText: existing ? retryEnvelope?.text ?? text : text,
      replyToId: existing ? retryEnvelope?.replyTo?.id : replyRef?.id,
      poll: existing
        ? retryEnvelope?.poll
          ? { question: retryEnvelope.poll.question, options: retryEnvelope.poll.options.map((o) => o.label), multi: retryEnvelope.poll.multi }
          : undefined
        : extras?.poll,
    };

    if (existing) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending" } : m)));
    } else {
      const optimistic: LocalChatMessage = {
        id: tempId,
        groupId,
        userId: user?.id ?? "",
        type: "text",
        contentText: optimisticContent,
        mediaUrl: null,
        senderName: typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null,
        createdAt: new Date().toISOString(),
        reactions: {},
        status: "sending",
      };
      setMessages((prev) => [...prev, optimistic]);
    }

    try {
      const res = await fetch(`/api/groups/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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

  /** "@Name" picked from the autocomplete → "@[Name](userId)" tokens the server can validate. */
  function withMentionTokens(text: string): string {
    let result = text;
    for (const [name, id] of pickedMentionsRef.current) {
      if (!result.includes(`@${name}`)) continue;
      result = result.split(`@${name}`).join(`@[${name}](${id})`);
    }
    return result;
  }

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    const reply = replyTo;
    setInput("");
    setReplyTo(null);
    setMentionState(null);
    const finalText = withMentionTokens(text);
    pickedMentionsRef.current = new Map();
    sendText(finalText, undefined, { replyTo: reply });
  }

  function handleRetry(message: LocalChatMessage) {
    if (message.type === "text" && message.contentText) {
      sendText(message.contentText, message);
    }
  }

  function startReply(message: LocalChatMessage) {
    setReplyTo(message);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  function handlePublishPoll(poll: { question: string; options: string[]; multi: boolean }) {
    sendText("", undefined, { poll, replyTo: null });
  }

  /** Optimistic vote (same reactions-map logic as the server), reconciled with the server's answer. */
  async function handleVote(messageId: string, optionId: string) {
    if (!user) return;
    const userId = user.id;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const poll = decodeEnvelope(m.contentText).poll;
        return poll ? { ...m, reactions: applyPollVote(m.reactions, poll, optionId, userId) } : m;
      })
    );
    try {
      const res = await fetch(`/api/groups/${groupId}/messages/${messageId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Le vote a échoué.");
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions ?? {} } : m)));
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "Le vote a échoué." });
    }
  }

  // ---- Mention autocomplete
  const mentionCandidates = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    return (members ?? [])
      .filter((m) => m.userId !== user?.id && (m.displayName ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionState, members, user?.id]);

  function updateMentionState(value: string, caret: number) {
    const found = mentionQueryAt(value, caret);
    setMentionState(found ? { ...found, index: 0 } : null);
  }

  function pickMention(member: ChatMember) {
    if (!mentionState) return;
    const name = (member.displayName ?? "Étudiant").replace(/[[\]()]/g, "").trim() || "Étudiant";
    pickedMentionsRef.current.set(name, member.userId);
    const el = messageInputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const next = `${input.slice(0, mentionState.start)}@${name} ${input.slice(caret)}`;
    pendingCaretRef.current = mentionState.start + name.length + 2;
    setInput(next);
    setMentionState(null);
  }

  function handleComposerKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (mentionState && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setMentionState((s) => (s ? { ...s, index: (s.index + delta + mentionCandidates.length) % mentionCandidates.length } : s));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionCandidates[mentionState.index] ?? mentionCandidates[0]);
        return;
      }
      if (e.key === "Escape") {
        setMentionState(null);
        return;
      }
    }
    if (e.key === "Escape" && replyTo) {
      setReplyTo(null);
      return;
    }
    // Enter sends, Shift+Enter = new line (desktop). On touch keyboards Enter inserts a line; the Send button sends.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      void handleSend();
    }
  }

  // Auto-grow the composer up to COMPOSER_MAX_HEIGHT_PX.
  useLayoutEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [input]);

  /** Optimistic toggle — flips the reaction locally right away (matches this file's own sendText pattern), then reconciles with the server's real map. The realtime UPDATE listener above will also deliver this same change to every OTHER open tab/member; this optimistic update is purely to avoid a visible round-trip delay for the person who just tapped it. */
  async function handleReact(messageId: string, emoji: string) {
    if (!user) return;
    const userId = user.id;

    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const current = m.reactions[emoji] ?? [];
        const already = current.includes(userId);
        const nextForEmoji = already ? current.filter((id) => id !== userId) : [...current, userId];
        const nextReactions = { ...m.reactions };
        if (nextForEmoji.length > 0) nextReactions[emoji] = nextForEmoji;
        else delete nextReactions[emoji];
        return { ...m, reactions: nextReactions };
      })
    );

    try {
      const res = await fetch(`/api/groups/${groupId}/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "La réaction a échoué.");
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions ?? {} } : m)));
    } catch (err) {
      toast({ variant: "error", title: err instanceof Error ? err.message : "La réaction a échoué." });
      // Best-effort rollback isn't attempted here — the next realtime UPDATE
      // (from the server's own unchanged row) or the periodic visibility
      // refetch will self-correct if this optimistic flip was wrong, same
      // fail-open philosophy as the rest of this file's realtime handling.
    }
  }

  async function handleTogglePin(messageId: string | null) {
    const previous = pinnedMessageId;
    setPinnedMessageId(messageId);
    try {
      const res = await fetch(`/api/groups/${groupId}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "L'épinglage a échoué.");
    } catch (err) {
      setPinnedMessageId(previous);
      toast({ variant: "error", title: err instanceof Error ? err.message : "L'épinglage a échoué." });
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
    // Set BEFORE any `await` below — a double-click can otherwise fire this
    // function twice while `isRecording` still reads false in both (React
    // hasn't re-rendered between the two clicks yet), reaching
    // getUserMedia() twice and leaking the first stream's open mic with
    // nothing left referencing it to stop. isStartingRecordingRef is a
    // plain ref specifically so this check is synchronous, unlike state.
    if (isStartingRecordingRef.current || mediaRecorderRef.current) return;
    isStartingRecordingRef.current = true;

    try {
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
          mediaRecorderRef.current = null;
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
          mediaRecorderRef.current = null;
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
    } finally {
      isStartingRecordingRef.current = false;
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
      mediaRecorderRef.current = null;
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
    // this ALWAYS breaks out of the shell's padded/rounded card via `fixed
    // inset-0` to cover the whole viewport (z-50 clears MobileBottomNav's
    // z-40) — true edge-to-edge Messenger-style chat on mobile, no shell
    // chrome showing through. Above `lg`, it's normally `static` (handing
    // layout back to the dashboard shell's own rounded-3xl card) UNLESS
    // `isFullscreen` is on, which forces the same `fixed inset-0` treatment
    // — z-[100] rather than z-50 so toggling it never ends up under
    // MobileBottomNav's z-40 if the viewport narrows while it's open.
    //
    // Every color below is a light/`dark:` PAIR — this subtree follows the
    // app's own light/dark toggle now, it no longer forces a literal `dark`
    // class on itself.
    <div
      className={cn(
        "flex h-[100dvh] w-screen min-h-0 flex-col overflow-hidden bg-white transition-colors duration-300 dark:bg-gradient-to-b dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950",
        // Edge-to-edge takeover: clear the notch, home indicator and landscape sides.
        "pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]",
        isFullscreen ? "fixed inset-0 z-[100]" : "fixed inset-0 z-50 lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-auto lg:p-0"
      )}
      style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}
    >
      <PrintGuard />

      <div className="relative z-20 flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-950/70">
        <Link
          href="/dashboard/groups"
          aria-label={tGroups("backToGroups", language)}
          className="touch-target relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-all duration-200 hover:-translate-x-0.5 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white active:scale-90"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        {/* Group avatar — same hashed gradient as the lobby's GroupCard, so
            the same group always reads as the same color in both places.
            The pulsing dot is real presence data (onlineUserIds, Supabase
            Realtime Presence), never shown unless someone besides me is
            actually connected right now — same "no fabricated status"
            standard as the text line below it. */}
        <div className="relative shrink-0">
          <span className={cn("absolute inset-0 rounded-full bg-gradient-to-br opacity-70 blur-md", gradientFor(groupId))} aria-hidden />
          <div
            className={cn(
              "relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-lg ring-2 ring-white/50 dark:ring-white/5",
              gradientFor(groupId)
            )}
          >
            {(groupName ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </div>
          {onlineUserIds.size > 1 && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight text-zinc-900 dark:text-white">{groupName ?? "..."}</p>
          {/* Real, derived status — never a fabricated "Session QCM en
              cours"-style claim with no data behind it. Presence-based
              online count when there's anyone besides me online; the
              typing indicator (real, from the broadcast channel) takes
              over this same line the instant someone starts typing, since
              it's more immediately relevant. */}
          <p className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            {Object.keys(typingUsers).length > 0 ? (
              <span className="text-cyan-600 dark:text-cyan-400">
                {tGroups("typingIndicator", language).replace(
                  "{name}",
                  Object.values(typingUsers)[0]?.displayName ?? tGroups("someoneTyping", language)
                )}
              </span>
            ) : onlineUserIds.size > 1 ? (
              `${onlineUserIds.size} ${tGroups("membersOnline", language)}`
            ) : (
              tGroups("onlyYouOnline", language)
            )}
          </p>
        </div>

        {/* Trailing header controls clustered as one tight toolbar (gap-0.5,
            p-1.5 icon buttons) rather than spread across the row's own wider
            gap-3 — a denser, more "command palette" icon rhythm than the
            previous loosely-spaced buttons. */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            className="hidden items-center gap-1.5 rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90 sm:flex"
            aria-label="Rechercher (Ctrl+K)"
            title="Rechercher (Ctrl+K)"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsVaultOpen(true)}
            className="rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90"
            aria-label="Ouvrir le Vault Médical"
            title="Vault Médical"
          >
            <FolderOpen className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsSavedOpen(true)}
            className="rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90"
            aria-label="Messages enregistrés"
            title="Messages enregistrés"
          >
            <Bookmark className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsMemberDrawerOpen(true)}
            className="flex items-center gap-1.5 rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90"
            aria-label={tGroups("openMembersAriaLabel", language)}
            title={tGroups("openMembersAriaLabel", language)}
          >
            <Users className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90"
            aria-label="Paramètres et invitation"
            title="Paramètres et invitation"
          >
            <Settings2 className="h-4 w-4" />
          </button>

          <ThemePicker themeId={themeId} onSelect={selectTheme} />

          {/* Medical background-theme picker — separate button/popover from ThemePicker above (different icon, different concern: room background vs. my own bubble color). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsThemeMenuOpen((open) => !open)}
              className="rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90"
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
                    className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-900/90 dark:shadow-black/40"
                  >
                    {medicalThemes.map((themeOption) => {
                      const isActive = themeOption.id === activeTheme.id;
                      return (
                        <button
                          key={themeOption.id}
                          type="button"
                          onClick={() => handleThemeChange(themeOption)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all duration-150 active:scale-[0.98]",
                            isActive
                              ? "bg-zinc-100 font-semibold text-zinc-900 dark:bg-white/10 dark:text-white"
                              : "text-zinc-500 hover:translate-x-0.5 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
                          )}
                        >
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", themeOption.color)} />
                          <span className="flex-1">{tGroups(themeOption.nameKey, language)}</span>
                          {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />}
                        </button>
                      );
                    })}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop-only — below `lg` the room is already always fullscreen
              (see the root div's own comment), so this toggle would have no
              visible effect there and is hidden rather than shown as a no-op. */}
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="hidden rounded-full p-1.5 text-zinc-500 transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-cyan-600 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-cyan-300 dark:hover:shadow-[0_0_12px_-2px_rgba(34,211,238,0.5)] active:scale-90 lg:flex"
            aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Ambient canvas — the panel holding both the feed and the composer.
          `relative` anchors the absolutely-positioned decorative layers
          below: neon glow blobs (dark mode only — a colored blur wash reads
          as premium against a dark canvas but as a stain on white), then
          the active specialty's pattern image with its own light/dark
          scrim on top of it. */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="pointer-events-none absolute inset-0 z-0 hidden overflow-hidden dark:block" aria-hidden>
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="absolute -right-20 top-1/3 h-64 w-64 rounded-full bg-blue-600/10 blur-3xl" />
          <div className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl" />
        </div>

        {/* cover/center/no-repeat, not a small tiled size — these are real
            generated photos (1024x1024), not infinitely-tileable vector
            SVGs; each one's pattern is dense/uniform enough across the
            whole canvas that stretching it to cover reads as a rich full
            background without ever risking a visible tile seam. Rendered at
            close to full strength now — the translucent scrim right below
            it (not the pattern's own opacity) is what keeps text legible on
            top, so the artwork itself actually "shines through" instead of
            being reduced to a barely-there texture. */}
        <div
          className="absolute inset-0 z-0 pointer-events-none opacity-90 transition-opacity duration-500"
          style={{ backgroundImage: activeTheme.pattern, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}
        />
        {/* The actual legibility guarantee: a near-opaque scrim over the
            pattern above, matching the room's own base surface color in
            each mode (white in light mode, near-black in dark) so message
            bubbles/text read at full contrast regardless of how busy the
            artwork underneath is. */}
        <div className="absolute inset-0 z-0 bg-white/80 transition-colors duration-500 dark:bg-zinc-950/85" aria-hidden />

        {/* Pinned message bar — a real anchor for a shared cas clinique/QCM/
            résumé (see handleTogglePin), not a decorative placeholder. Looks
            the pinned message up in already-loaded `messages` rather than a
            separate fetch; on the rare miss (a very old message pinned
            before this client loaded that far back) it still shows the pin
            control with a neutral fallback label instead of hiding the bar. */}
        {pinnedMessageId && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50/90 px-3 py-2 text-xs shadow-soft backdrop-blur-md dark:border-amber-800/50 dark:bg-amber-950/40"
          >
            <Pin className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <button
              type="button"
              onClick={() => jumpToMessage(pinnedMessageId)}
              className="min-w-0 flex-1 text-left"
              title="Aller au message épinglé"
            >
              <p className="truncate font-medium text-amber-900 dark:text-amber-200">
                {(() => {
                  const pinned = messages.find((m) => m.id === pinnedMessageId);
                  if (!pinned) return tGroups("pinnedMessageFallback", language);
                  return pinned.type === "text" ? previewText(pinned.contentText) || tGroups("pinnedMessageFallback", language) : pinned.type === "image" ? "📷 Photo" : pinned.type === "video" ? "🎥 Vidéo" : "🎤 Message vocal";
                })()}
              </p>
              {(() => {
                const pinnedSender = messages.find((m) => m.id === pinnedMessageId)?.senderName;
                return pinnedSender ? <p className="truncate text-[10px] text-amber-700/80 dark:text-amber-300/70">Épinglé · {pinnedSender}</p> : null;
              })()}
            </button>
            <button
              type="button"
              onClick={() => handleTogglePin(null)}
              className="shrink-0 rounded-full p-1 text-amber-700 transition-colors hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-900/60"
              aria-label={tGroups("unpinAriaLabel", language)}
              title={tGroups("unpinAriaLabel", language)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}

        {/* z-10 relative is load-bearing here: without it, this scroll region would sit in the same stacking context as the absolutely-positioned pattern layer above and could end up behind it, breaking message legibility and audio-player clicks. chat-scrollbar (app/globals.css) is the thin dark scrollbar treatment, scoped to this one scroll region rather than globally. */}
        <div
          ref={feedRef}
          onScroll={() => {
            handleFeedScroll();
            markSeenNow();
          }}
          className="chat-scrollbar relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto px-1"
        >
          {feed.length === 0 && group && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto mt-8 flex max-w-sm flex-col items-center gap-3 rounded-3xl border border-cyan-200/60 bg-white/70 px-6 py-8 text-center shadow-lg backdrop-blur-md dark:border-cyan-900/40 dark:bg-zinc-900/60"
            >
              <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}>
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-[0_0_30px_rgba(34,211,238,0.45)]">
                  <Stethoscope className="h-8 w-8" />
                </span>
              </motion.div>
              <p className="text-base font-extrabold text-zinc-900 dark:text-white">Le bloc est prêt. La garde commence.</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Invite tes collègues avec le code <span className="font-mono font-bold text-cyan-600 dark:text-cyan-300">{group.joinCode}</span>, lance un sondage ou partage ton premier cours.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => setIsSettingsOpen(true)} className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-cyan-500/30">
                  Inviter
                </button>
                <button type="button" onClick={() => setIsPollComposerOpen(true)} className="rounded-xl border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5">
                  Créer un sondage
                </button>
              </div>
            </motion.div>
          )}
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
                  onReact={handleReact}
                  isPinned={item.message.id === pinnedMessageId}
                  onTogglePin={handleTogglePin}
                  isSenderAdmin={!!groupAdminId && item.message.userId === groupAdminId}
                  senderAcademicYear={academicYearByUserId.get(item.message.userId) ?? null}
                  receipt={receiptFor(item.message)}
                  onReply={startReply}
                  onVote={handleVote}
                  onJumpTo={jumpToMessage}
                  isSaved={isSaved(item.message.id)}
                  onToggleSave={(m) =>
                    toggleSaved({
                      id: m.id,
                      groupId,
                      groupName: groupName ?? "Groupe",
                      senderName: m.senderName,
                      type: m.type,
                      contentText: m.type === "text" ? previewText(m.contentText) : m.contentText,
                      mediaUrl: m.mediaUrl,
                      createdAt: m.createdAt,
                    })
                  }
                />
              )
            )}
          </AnimatePresence>

          {/* Animated typing indicator — real (Object.keys(typingUsers).length
              > 0 comes straight from the presence/typing effect above), not
              shown speculatively. Styled as an incoming-message bubble so it
              reads as "someone is about to send this", not a separate UI
              element. */}
          <AnimatePresence>
            {Object.keys(typingUsers).length > 0 && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-end gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 ring-2 ring-white dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-950">
                  {(Object.values(typingUsers)[0]?.displayName ?? "?").trim().charAt(0).toUpperCase() || "?"}
                </div>
                <div className="flex items-center gap-1 rounded-xl rounded-tl-sm border border-zinc-200 bg-zinc-100 px-4 py-3 dark:border-white/5 dark:bg-zinc-900/70">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] dark:bg-zinc-500" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] dark:bg-zinc-500" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom FAB — only ever driven by real scroll position
            (handleFeedScroll), never a fabricated "N new messages" count. */}
        <AnimatePresence>
          {showScrollToBottom && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.8, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 8 }}
              onClick={scrollToBottom}
              className="absolute bottom-24 right-5 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:text-cyan-600 dark:border-white/5 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-cyan-300"
              aria-label="Aller aux derniers messages"
              title="Aller aux derniers messages"
            >
              <ArrowDown className="h-5 w-5" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Messaging-app composer (Telegram/WhatsApp shape): one "+" for
            attachments, a pill text field, and a single primary button that
            is the mic while the field is empty and Send once there's text.
            Three 44px controls instead of six ~32px ones — the old row
            couldn't fit the input's intrinsic width on a phone, which pushed
            Send out of the clipped container. */}
        {/* Reply preview */}
        <AnimatePresence>
          {replyTo && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="relative z-10 -mb-1 flex items-center gap-2 rounded-2xl border border-cyan-300/50 bg-white/90 px-3 py-2 shadow-md backdrop-blur-md dark:border-cyan-800/50 dark:bg-zinc-900/90"
            >
              <Reply className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
              <button type="button" onClick={() => jumpToMessage(replyTo.id)} className="min-w-0 flex-1 border-l-2 border-cyan-500 pl-2 text-left">
                <span className="block text-xs font-bold text-cyan-700 dark:text-cyan-300">Réponse à {replyTo.senderName ?? "Étudiant(e)"}</span>
                <span className="block truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {replyTo.type === "text" ? previewText(replyTo.contentText) : replyTo.type === "image" ? "📷 Photo" : replyTo.type === "video" ? "🎥 Vidéo" : "🎤 Message vocal"}
                </span>
              </button>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Annuler la réponse" className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSend} className="relative z-10 flex shrink-0 items-end gap-2">
          <input
            ref={documentInputRef}
            type="file"
            accept={ACCEPTED_DOCUMENT_TYPES}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadMedia(f);
              e.target.value = "";
            }}
          />
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); e.target.value = ""; }} />
          <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); e.target.value = ""; }} />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsAttachMenuOpen((v) => !v)}
              disabled={isUploadingMedia || isRecording}
              aria-label={tGroups("attachAriaLabel", language)}
              aria-expanded={isAttachMenuOpen}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-600 shadow-md shadow-zinc-300/30 ring-1 ring-zinc-200 transition-transform duration-150 hover:text-cyan-600 active:scale-90 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:shadow-black/40 dark:ring-white/10 dark:hover:text-cyan-300"
            >
              {isUploadingMedia ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Plus className={cn("h-5 w-5 transition-transform duration-200", isAttachMenuOpen && "rotate-45")} />
              )}
            </button>

            <AnimatePresence>
              {isAttachMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsAttachMenuOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-2xl border border-zinc-200 bg-white py-1 shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-900 dark:shadow-black/40"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        imageInputRef.current?.click();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 active:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/10 dark:active:bg-white/10"
                    >
                      <ImageIcon className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
                      {tGroups("sendImageAriaLabel", language)}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        videoInputRef.current?.click();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 active:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/10 dark:active:bg-white/10"
                    >
                      <Video className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" />
                      {tGroups("sendVideoAriaLabel", language)}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        documentInputRef.current?.click();
                      }}
                      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 active:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/10 dark:active:bg-white/10"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-rose-500 dark:text-rose-400" />
                      Document (PDF, Word, PPT…)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAttachMenuOpen(false);
                        setIsPollComposerOpen(true);
                      }}
                      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 active:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/10 dark:active:bg-white/10"
                    >
                      <BarChart3 className="h-5 w-5 shrink-0 text-violet-500 dark:text-violet-400" />
                      Sondage
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Live recording indicator — replaces the text field while a voice
              note is being captured, so it's obvious recording is in progress
              (a chronometer plus a decorative animated waveform), not just
              the mic button's own pulse. */}
          {isRecording ? (
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-rose-300 bg-rose-50 px-4 dark:border-rose-500/30 dark:bg-rose-950/60" role="status" aria-live="polite">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500 dark:bg-rose-400" aria-hidden />
              <div className="flex min-w-0 flex-1 items-center gap-[3px] overflow-hidden">
                {RECORDING_BAR_HEIGHTS.map((height, i) => (
                  <span
                    key={i}
                    style={{ height: `${height}px`, animationDelay: `${i * 90}ms` }}
                    className="w-[3px] shrink-0 animate-pulse rounded-full bg-rose-500/70 dark:bg-rose-400/70"
                  />
                ))}
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatRecordingDuration(recordingSeconds)}</span>
            </div>
          ) : (
            <div className="relative flex min-h-11 min-w-0 flex-1 items-end rounded-[22px] bg-white py-1 pl-4 pr-1 shadow-md shadow-zinc-300/30 ring-1 ring-zinc-200 transition-shadow duration-200 focus-within:ring-2 focus-within:ring-cyan-500/40 dark:bg-zinc-900 dark:shadow-black/40 dark:ring-white/10">
              {/* @mention autocomplete */}
              <AnimatePresence>
                {mentionState && mentionCandidates.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-zinc-900"
                    role="listbox"
                  >
                    {mentionCandidates.map((member, index) => (
                      <button
                        key={member.id}
                        type="button"
                        role="option"
                        aria-selected={index === mentionState.index}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMention(member);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
                          index === mentionState.index ? "bg-cyan-50 text-cyan-800 dark:bg-cyan-500/10 dark:text-cyan-200" : "text-zinc-700 dark:text-zinc-200"
                        )}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold dark:bg-zinc-800">
                          {(member.displayName ?? "?").trim().charAt(0).toUpperCase() || "?"}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{member.displayName ?? "Étudiant(e)"}</span>
                        {onlineUserIds.has(member.userId) && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <textarea
                ref={messageInputRef}
                value={input}
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value);
                  updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
                  notifyTyping();
                }}
                onKeyDown={handleComposerKeyDown}
                onClick={(e) => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
                onPaste={handlePaste}
                placeholder={tGroups("messagePlaceholder", language)}
                aria-label={tGroups("messagePlaceholder", language)}
                // min-w-0: without it the field's intrinsic width refuses to shrink on narrow phones.
                className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-[15px] leading-5 text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-white dark:placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => {
                  const el = messageInputRef.current;
                  const caret = el?.selectionStart ?? input.length;
                  const prefix = caret > 0 && !/\s$/.test(input.slice(0, caret)) ? " @" : "@";
                  const next = input.slice(0, caret) + prefix + input.slice(caret);
                  pendingCaretRef.current = caret + prefix.length;
                  setInput(next);
                  setMentionState({ start: caret + prefix.length - 1, query: "", index: 0 });
                }}
                className="mb-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-transform duration-150 hover:text-cyan-600 active:scale-90 dark:text-zinc-400 dark:hover:text-cyan-300 sm:flex"
                aria-label="Mentionner un membre"
                title="Mentionner (@)"
              >
                <AtSign className="h-[18px] w-[18px]" />
              </button>

              {/* Deliberately NOT `relative`: the picker anchors to the full-width
                  form instead, so its 18rem panel stays on-screen on 320px phones. */}
              <div className="mb-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsEmojiPickerOpen((v) => !v)}
                  disabled={isUploadingMedia}
                  className="touch-target relative flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-transform duration-150 hover:text-cyan-600 active:scale-90 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-cyan-300"
                  aria-label={tGroups("emojiPickerAriaLabel", language)}
                  title={tGroups("emojiPickerAriaLabel", language)}
                >
                  <Smile className="h-5 w-5" />
                </button>

                <AnimatePresence>
                  {isEmojiPickerOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsEmojiPickerOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.12 }}
                        className="chat-scrollbar absolute bottom-full right-0 z-50 mb-3 max-h-72 w-72 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-300/40 dark:border-white/5 dark:bg-zinc-900 dark:shadow-black/40"
                      >
                        {EMOJI_CATEGORIES.map((category) => (
                          <div key={category.label} className="mb-2 last:mb-0">
                            <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{category.label}</p>
                            <div className="grid grid-cols-6 gap-0.5">
                              {category.emojis.map((emoji) => (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => insertEmoji(emoji)}
                                  className="flex h-10 items-center justify-center rounded-lg text-xl leading-none transition-transform duration-150 hover:scale-125 hover:bg-zinc-100 active:scale-110 dark:hover:bg-white/10"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          <AnimatePresence mode="popLayout" initial={false}>
            {input.trim() && !isRecording ? (
              <motion.button
                key="send"
                type="submit"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
                whileTap={{ scale: 0.9 }}
                aria-label={tGroups("sendButton", language)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30 dark:shadow-cyan-950/50"
              >
                <Send className="h-5 w-5" />
              </motion.button>
            ) : (
              <motion.button
                key={isRecording ? "stop" : "mic"}
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isUploadingMedia}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
                whileTap={{ scale: 0.9 }}
                aria-label={isRecording ? tGroups("stopRecordingAriaLabel", language) : tGroups("voiceMessageAriaLabel", language)}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-lg disabled:opacity-50",
                  isRecording
                    ? "bg-rose-500 shadow-rose-500/30"
                    : "bg-gradient-to-br from-cyan-500 to-blue-600 shadow-cyan-500/30 dark:shadow-cyan-950/50"
                )}
              >
                {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
              </motion.button>
            )}
          </AnimatePresence>
        </form>
      </div>

      <MemberDrawer
        isOpen={isMemberDrawerOpen}
        onClose={() => setIsMemberDrawerOpen(false)}
        onlineUserIds={onlineUserIds}
        adminId={groupAdminId}
        members={members}
      />

      <MediaVaultPanel groupId={groupId} isOpen={isVaultOpen} onClose={() => setIsVaultOpen(false)} />

      <GroupSettingsPanel
        group={group}
        members={members}
        currentUserId={user?.id ?? null}
        onlineUserIds={onlineUserIds}
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onGroupUpdated={(updated) => setGroup(updated)}
      />

      <PollComposer open={isPollComposerOpen} onOpenChange={setIsPollComposerOpen} onSubmit={handlePublishPoll} />

      <SavedMessagesPanel
        isOpen={isSavedOpen}
        onClose={() => setIsSavedOpen(false)}
        saved={savedMessages}
        onRemove={removeSaved}
        currentGroupId={groupId}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        currentGroupId={groupId}
        messages={messages}
        members={members}
        isFullscreen={isFullscreen}
        onJumpToMessage={jumpToMessage}
        onOpenVault={() => setIsVaultOpen(true)}
        onOpenSaved={() => setIsSavedOpen(true)}
        onOpenMembers={() => setIsMemberDrawerOpen(true)}
        onToggleFullscreen={() => setIsFullscreen((v) => !v)}
      />
    </div>
  );
}
