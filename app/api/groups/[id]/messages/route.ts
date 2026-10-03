import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import {
  MAX_POLL_OPTION_CHARS,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION_CHARS,
  decodeEnvelope,
  encodeEnvelope,
  excerpt,
  extractMentionIds,
  plainText,
  type MessageEnvelope,
} from "@/lib/group-chat-envelope";
import { dispatchPushToUser } from "@/lib/push/dispatch";
import type { ChatMessage } from "@/types/group-chat";

export const runtime = "nodejs";

const MESSAGE_HISTORY_LIMIT = 200;
const MAX_MESSAGE_CHARS = 2000;

interface ChatMessageRow {
  id: string;
  group_id: string;
  user_id: string;
  type: ChatMessage["type"];
  content_text: string | null;
  media_url: string | null;
  sender_name: string | null;
  created_at: string;
  reactions: ChatMessage["reactions"] | null;
}

function toMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    type: row.type,
    contentText: row.content_text,
    mediaUrl: row.media_url,
    senderName: row.sender_name,
    createdAt: row.created_at,
    // Fails open to an empty map rather than crashing the whole feed on a
    // row from before this column existed, or before the migration in
    // supabase/schema.sql has actually been run against this database.
    reactions: row.reactions ?? {},
  };
}

/**
 * GET — message history for this group (oldest first, capped at the most
 * recent MESSAGE_HISTORY_LIMIT). Live updates after this initial load come
 * from the client's own direct Realtime subscription (see
 * components/groups/ChatRoom.tsx), not from polling this route.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const groupId = params.id;
  if (!groupId) {
    return NextResponse.json({ success: false, error: "Identifiant de groupe invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, group_id, user_id, type, content_text, media_url, sender_name, created_at, reactions")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_HISTORY_LIMIT);

  if (error) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const messages = ((data ?? []) as ChatMessageRow[]).map(toMessage).reverse();
  return NextResponse.json({ success: true, messages });
}

const MEDIA_REPLY_LABEL: Record<Exclude<ChatMessage["type"], "text">, string> = {
  image: "📷 Photo",
  video: "🎥 Vidéo",
  audio: "🎤 Message vocal",
};

/**
 * POST — sends a text message. Body:
 *   { contentText: string, replyToId?: string, poll?: { question, options: string[], multi? } }
 * Replies, @mentions ("@[Name](userId)" tokens in the text) and polls are
 * packed into a rich envelope inside content_text (lib/group-chat-envelope.ts)
 * — no schema change needed. Everything is validated HERE: a quoted message
 * must belong to this group, a mention must be an accepted member of it.
 * Media messages go through /media instead.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`group-message:${user.id}`, RATE_LIMITS.chatMessage);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Tu envoies des messages trop vite — respire un instant." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const groupId = params.id;
  if (!groupId) {
    return NextResponse.json({ success: false, error: "Identifiant de groupe invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { contentText: rawContentText, replyToId, poll: rawPoll } = (body ?? {}) as { contentText?: unknown; replyToId?: unknown; poll?: unknown };
  const contentText = typeof rawContentText === "string" ? rawContentText : "";

  // ---- Poll (optional): question + 2..8 distinct non-empty options.
  let poll: MessageEnvelope["poll"];
  if (rawPoll !== undefined && rawPoll !== null) {
    const candidate = rawPoll as { question?: unknown; options?: unknown; multi?: unknown };
    const question = typeof candidate.question === "string" ? candidate.question.trim() : "";
    const labels = Array.isArray(candidate.options)
      ? Array.from(new Set(candidate.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)))
      : [];
    if (!question || question.length > MAX_POLL_QUESTION_CHARS) {
      return NextResponse.json({ success: false, error: `La question du sondage est requise (max ${MAX_POLL_QUESTION_CHARS} caractères).` }, { status: 400 });
    }
    if (labels.length < 2 || labels.length > MAX_POLL_OPTIONS || labels.some((l) => l.length > MAX_POLL_OPTION_CHARS)) {
      return NextResponse.json(
        { success: false, error: `Un sondage a entre 2 et ${MAX_POLL_OPTIONS} choix (max ${MAX_POLL_OPTION_CHARS} caractères chacun).` },
        { status: 400 }
      );
    }
    poll = {
      question: sanitizeForPostgres(question),
      options: labels.map((label, index) => ({ id: `o${index + 1}`, label: sanitizeForPostgres(label) })),
      multi: candidate.multi === true,
    };
  }

  if (!contentText.trim() && !poll) {
    return NextResponse.json({ success: false, error: "Le message est vide." }, { status: 400 });
  }
  if (contentText.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ success: false, error: `Message trop long (max ${MAX_MESSAGE_CHARS} caractères).` }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  const senderName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  const text = sanitizeForPostgres(contentText.trim());
  const envelope: MessageEnvelope = { text, ...(poll ? { poll } : {}) };

  // ---- Reply: the quoted message must exist IN THIS GROUP; its excerpt is frozen now.
  if (typeof replyToId === "string" && replyToId) {
    const { data: quoted, error: quotedError } = await supabase
      .from("chat_messages")
      .select("id, group_id, type, content_text, sender_name")
      .eq("id", replyToId)
      .maybeSingle();
    if (quotedError) {
      return NextResponse.json({ success: false, error: `Lecture échouée : ${quotedError.message}` }, { status: 500 });
    }
    if (quoted && quoted.group_id === groupId) {
      const quotedEnvelope = decodeEnvelope(quoted.content_text);
      const quotedText =
        quoted.type === "text"
          ? quotedEnvelope.poll
            ? `📊 ${quotedEnvelope.poll.question}`
            : plainText(quotedEnvelope.text) || (quotedEnvelope.attachment ? `📄 ${quotedEnvelope.attachment.name}` : "")
          : MEDIA_REPLY_LABEL[quoted.type as Exclude<ChatMessage["type"], "text">] ?? "";
      envelope.replyTo = { id: quoted.id, senderName: quoted.sender_name, excerpt: excerpt(quotedText) };
    }
  }

  // ---- Mentions: only accepted members of this group (never the sender).
  const requestedMentions = extractMentionIds(text).filter((id) => id !== user.id.toLowerCase());
  if (requestedMentions.length > 0) {
    const { data: mentionedRows } = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("status", "accepted")
      .in("user_id", requestedMentions);
    const valid = ((mentionedRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (valid.length > 0) envelope.mentions = valid;
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      group_id: groupId,
      user_id: user.id,
      type: "text",
      content_text: encodeEnvelope(envelope),
      sender_name: senderName,
    })
    .select("id, group_id, user_id, type, content_text, media_url, sender_name, created_at, reactions")
    .single();

  if (error || !data) {
    console.error("[groups/messages:send] Échec insertion Supabase:", error);
    // Surfaces the real Postgres error (unlike a swallowed generic message)
    // — same convention every GET route in this app already uses
    // (`Lecture échouée : ${error.message}`). This one write path was the
    // odd one out, which made a real schema mismatch indistinguishable from
    // any other failure from the client/Network tab alone.
    return NextResponse.json({ success: false, error: `L'envoi a échoué : ${error?.message ?? "raison inconnue"}` }, { status: 500 });
  }

  // @mention push notifications — after the message exists, never blocking the reply to the sender.
  if (envelope.mentions && envelope.mentions.length > 0) {
    const { data: groupRow } = await supabase.from("chat_groups").select("name").eq("id", groupId).maybeSingle<{ name: string }>();
    const body = excerpt(plainText(text) || (poll ? `📊 ${poll.question}` : ""), 120);
    const title = `${senderName ?? "Quelqu'un"} t'a mentionné(e)${groupRow?.name ? ` · ${groupRow.name}` : ""}`;
    await Promise.allSettled(envelope.mentions.map((mentionedId) => dispatchPushToUser(mentionedId, { title, body, url: `/dashboard/groups/${groupId}` })));
  }

  return NextResponse.json({ success: true, message: toMessage(data as ChatMessageRow) });
}
