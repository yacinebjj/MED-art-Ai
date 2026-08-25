import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
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
    .select("id, group_id, user_id, type, content_text, media_url, sender_name, created_at")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_HISTORY_LIMIT);

  if (error) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const messages = ((data ?? []) as ChatMessageRow[]).map(toMessage).reverse();
  return NextResponse.json({ success: true, messages });
}

/** POST — sends a text message. Body: { contentText: string }. Media messages go through /media instead. */
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

  const { contentText } = (body ?? {}) as { contentText?: unknown };
  if (typeof contentText !== "string" || !contentText.trim()) {
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

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      group_id: groupId,
      user_id: user.id,
      type: "text",
      content_text: sanitizeForPostgres(contentText.trim()),
      sender_name: senderName,
    })
    .select("id, group_id, user_id, type, content_text, media_url, sender_name, created_at")
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

  return NextResponse.json({ success: true, message: toMessage(data as ChatMessageRow) });
}
