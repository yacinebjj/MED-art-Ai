"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence } from "framer-motion";
import { ArrowLeft, ImageIcon, Mic, Send, Square, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { useBlockPaste } from "@/hooks/useBlockPaste";
import { useChatTheme } from "@/hooks/useChatTheme";
import { PrintGuard } from "@/components/security/PrintGuard";
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

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });
const DAY_LABEL_WITH_YEAR_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  return date.getFullYear() === now.getFullYear() ? DAY_LABEL_FORMAT.format(date) : DAY_LABEL_WITH_YEAR_FORMAT.format(date);
}

type FeedItem = { kind: "day"; key: string; label: string } | { kind: "message"; key: string; message: LocalChatMessage; isFirstInGroup: boolean; isLastInGroup: boolean };

/** Builds the render feed: day dividers inserted where the calendar day changes, plus first/last-in-group flags for bubble corner rounding. */
function buildFeed(messages: LocalChatMessage[]): FeedItem[] {
  const feed: FeedItem[] = [];
  let lastDay: string | null = null;

  messages.forEach((message, i) => {
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) {
      feed.push({ kind: "day", key: `day-${day}`, label: dayLabel(message.createdAt) });
      lastDay = day;
    }

    const prev = messages[i - 1];
    const next = messages[i + 1];
    const isFirstInGroup =
      !prev || prev.userId !== message.userId || new Date(prev.createdAt).toDateString() !== day || new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUP_GAP_MS;
    const isLastInGroup =
      !next || next.userId !== message.userId || new Date(next.createdAt).toDateString() !== day || new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime() > GROUP_GAP_MS;

    feed.push({ kind: "message", key: message.id, message, isFirstInGroup, isLastInGroup });
  });

  return feed;
}

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
  const blockPaste = useBlockPaste();
  const { theme, themeId, selectTheme } = useChatTheme();

  const [groupName, setGroupName] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const feed = useMemo(() => buildFeed(messages), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed.length]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const [groupRes, messagesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`).then((r) => r.json()),
        fetch(`/api/groups/${groupId}/messages`).then((r) => r.json()),
      ]);
      if (cancelled) return;

      if (!groupRes.success) {
        setAccessError(groupRes.error ?? "Impossible d'accéder à ce groupe.");
        return;
      }
      setGroupName(groupRes.group.name);

      if (messagesRes.success) {
        setMessages((messagesRes.messages as ChatMessage[]).map((m) => ({ ...m, status: "sent" as const })));
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
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
    const tempId = existing?.id ?? `temp-${crypto.randomUUID()}`;

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

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        uploadMedia(new File([blob], "vocal.webm", { type: "audio/webm" }));
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      toast({ variant: "error", title: "Impossible d'accéder au micro." });
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }

  if (accessError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm text-muted-foreground">{accessError}</p>
        <Link href="/dashboard/groups" className="text-sm font-semibold text-primary hover:underline">
          Retour aux groupes
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PrintGuard />

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-3">
        <Link href="/dashboard/groups" className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <p className="flex-1 truncate text-sm font-bold text-foreground">{groupName ?? "..."}</p>
        <ThemePicker themeId={themeId} onSelect={selectTheme} />
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
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
                isLastInGroup={item.isLastInGroup}
                theme={theme}
                onRetry={handleRetry}
              />
            )
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex shrink-0 items-center gap-1.5 border-t border-border p-2.5">
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); e.target.value = ""; }} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMedia(f); e.target.value = ""; }} />

        <button type="button" onClick={() => imageInputRef.current?.click()} disabled={isUploadingMedia} className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50" aria-label="Envoyer une image">
          <ImageIcon className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => videoInputRef.current?.click()} disabled={isUploadingMedia} className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50" aria-label="Envoyer une vidéo">
          <Video className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isUploadingMedia}
          className={`rounded-full p-2 disabled:opacity-50 ${isRecording ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
          aria-label={isRecording ? "Arrêter l'enregistrement" : "Message vocal"}
        >
          {isRecording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={blockPaste}
          placeholder="Écris un message (le collage est désactivé)..."
          className="flex-1 rounded-xl border border-input bg-transparent px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button type="submit" disabled={!input.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
