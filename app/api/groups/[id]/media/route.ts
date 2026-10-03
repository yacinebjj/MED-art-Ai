import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { ENVELOPE_PREFIX, decodeEnvelope, encodeEnvelope } from "@/lib/group-chat-envelope";
import type { ChatMessage, ChatMessageType, MessageReactions } from "@/types/group-chat";

// The Media Vault (GET below) needs every media message ever sent in the
// group, not just the newest ones — GET /api/groups/[id]/messages caps its
// own history at 200 rows (see that route's own MESSAGE_HISTORY_LIMIT) so a
// heavily-used group's older PDFs/photos/voice notes would silently vanish
// from a client-side filter of that already-truncated feed. This is its own
// separate, generously-capped query instead.
const VAULT_HISTORY_LIMIT = 500;

export const runtime = "nodejs";
export const maxDuration = 60; // media upload, not an AI call — but a large video/audio blob still needs headroom beyond the platform default.

const CHAT_MEDIA_BUCKET = "chat_media";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

const MIME_TO_TYPE: Record<string, ChatMessageType> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

/**
 * Course documents (PDF, Word, PowerPoint, Excel, plain text). Stored like
 * any attachment, but sent as a TEXT message carrying the file in its rich
 * envelope (lib/group-chat-envelope.ts) — chat_messages.type keeps its
 * existing check constraint (text/image/video/audio), no migration needed.
 */
const DOCUMENT_EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
};
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Keeps a readable, storage-safe original name for the download card. */
function safeDocumentName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "document").slice(0, 120);
}

function maxBytesFor(type: ChatMessageType): number {
  if (type === "image") return MAX_IMAGE_BYTES;
  if (type === "video") return MAX_VIDEO_BYTES;
  return MAX_AUDIO_BYTES;
}

async function ensureChatMediaBucket(supabase: ReturnType<typeof getSupabaseAdmin>): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket: { name: string }) => bucket.name === CHAT_MEDIA_BUCKET)) return;

  const { error } = await supabase.storage.createBucket(CHAT_MEDIA_BUCKET, { public: true });
  if (error && !/already exists/i.test(error.message)) {
    throw error;
  }
}

/**
 * POST — uploads one image/video/audio attachment (multipart form, field
 * "file") and creates its chat_messages row in the same request. Covers all
 * three attachment buttons the Messenger UI offers, incl. the voice-note
 * blob MediaRecorder produces client-side (audio/webm).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`group-media:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const groupId = params.id;
  if (!groupId) {
    return NextResponse.json({ success: false, error: "Identifiant de groupe invalide." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Aucun fichier reçu." }, { status: 400 });
  }

  const documentExtension = DOCUMENT_EXTENSION_BY_MIME[file.type];
  const messageType: ChatMessageType | undefined = documentExtension ? "text" : MIME_TO_TYPE[file.type];
  if (!messageType) {
    return NextResponse.json(
      { success: false, error: `Type de fichier non supporté : "${file.type || "inconnu"}". Images, vidéos, audios, PDF, Word, PowerPoint, Excel ou texte.` },
      { status: 400 }
    );
  }

  const maxBytes = documentExtension ? MAX_DOCUMENT_BYTES : maxBytesFor(messageType);
  if (file.size > maxBytes) {
    return NextResponse.json(
      { success: false, error: `Fichier trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${maxBytes / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  let mediaUrl: string;
  try {
    await ensureChatMediaBucket(supabase);
    const extension = documentExtension ?? EXTENSION_BY_MIME[file.type] ?? "bin";
    const path = `${groupId}/${randomUUID()}.${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
    mediaUrl = data.publicUrl;
  } catch (error) {
    console.error("[groups/media] Échec de l'upload vers Supabase Storage:", error);
    return NextResponse.json({ success: false, error: "L'envoi du média a échoué. Réessaie." }, { status: 500 });
  }

  const senderName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

  const { data: inserted, error: insertError } = await supabase
    .from("chat_messages")
    .insert(
      documentExtension
        ? {
            group_id: groupId,
            user_id: user.id,
            type: "text",
            content_text: encodeEnvelope({
              text: "",
              attachment: { url: mediaUrl, name: safeDocumentName(file.name), mime: file.type, size: file.size },
            }),
            sender_name: senderName,
          }
        : { group_id: groupId, user_id: user.id, type: messageType, media_url: mediaUrl, sender_name: senderName }
    )
    .select("id, group_id, user_id, type, content_text, media_url, sender_name, created_at, reactions")
    .single();

  if (insertError || !inserted) {
    console.error("[groups/media] Échec insertion Supabase (média déjà uploadé):", insertError);
    return NextResponse.json(
      { success: false, error: `Le média a été envoyé mais le message n'a pas pu être créé : ${insertError?.message ?? "raison inconnue"}` },
      { status: 500 }
    );
  }

  const message: ChatMessage = {
    id: inserted.id,
    groupId: inserted.group_id,
    userId: inserted.user_id,
    type: inserted.type,
    contentText: inserted.content_text,
    mediaUrl: inserted.media_url,
    senderName: inserted.sender_name,
    createdAt: inserted.created_at,
    reactions: inserted.reactions ?? {},
  };

  return NextResponse.json({ success: true, message });
}

interface MediaMessageRow {
  id: string;
  group_id: string;
  user_id: string;
  type: ChatMessageType;
  content_text: string | null;
  media_url: string | null;
  sender_name: string | null;
  created_at: string;
  reactions: MessageReactions | null;
}

/** First http(s) links found in a message, for the library's "Liens" tab. */
function extractLinks(text: string): string[] {
  return Array.from(new Set(text.match(/https?:\/\/[^\s)<>"']+/gi) ?? [])).slice(0, 5);
}

/**
 * GET — the group library ("Vault"): every image/video/audio message, plus
 * every shared document and every link, newest first, capped at
 * VAULT_HISTORY_LIMIT each. Same access level as reading
 * the chat itself (assertAcceptedMember) — this is a different VIEW of
 * chat_messages the student can already see one-by-one in the feed, not a
 * new permission surface.
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
    .in("type", ["image", "video", "audio"])
    .order("created_at", { ascending: false })
    .limit(VAULT_HISTORY_LIMIT);

  if (error) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  // Documents (rich-envelope attachments) and links live in TEXT messages.
  // Two plain filters rather than one .or() string: the envelope prefix
  // contains ":" which PostgREST's or-syntax would misparse.
  const textQuery = () =>
    supabase.from("chat_messages").select("id, content_text, sender_name, created_at").eq("group_id", groupId).eq("type", "text");
  const [envelopeRows, linkRows] = await Promise.all([
    textQuery().like("content_text", `${ENVELOPE_PREFIX}%`).order("created_at", { ascending: false }).limit(VAULT_HISTORY_LIMIT),
    textQuery().ilike("content_text", "%http%").order("created_at", { ascending: false }).limit(VAULT_HISTORY_LIMIT),
  ]);
  type TextRow = { id: string; content_text: string | null; sender_name: string | null; created_at: string };
  const textRows = new Map<string, TextRow>();
  for (const row of [...((envelopeRows.data ?? []) as TextRow[]), ...((linkRows.data ?? []) as TextRow[])]) textRows.set(row.id, row);

  const documents: { messageId: string; senderName: string | null; createdAt: string; name: string; url: string; mime: string; size: number }[] = [];
  const links: { messageId: string; senderName: string | null; createdAt: string; url: string }[] = [];
  for (const row of Array.from(textRows.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const envelope = decodeEnvelope(row.content_text);
    if (envelope.attachment) {
      documents.push({ messageId: row.id, senderName: row.sender_name, createdAt: row.created_at, ...envelope.attachment });
    }
    for (const url of extractLinks(envelope.text)) links.push({ messageId: row.id, senderName: row.sender_name, createdAt: row.created_at, url });
  }

  const media: ChatMessage[] = ((data ?? []) as MediaMessageRow[]).map((row) => ({
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    type: row.type,
    contentText: row.content_text,
    mediaUrl: row.media_url,
    senderName: row.sender_name,
    createdAt: row.created_at,
    reactions: row.reactions ?? {},
  }));

  return NextResponse.json({ success: true, media, documents, links });
}
