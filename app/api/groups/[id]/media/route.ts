import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { ChatMessage, ChatMessageType } from "@/types/group-chat";

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

  const messageType = MIME_TO_TYPE[file.type];
  if (!messageType) {
    return NextResponse.json({ success: false, error: `Type de fichier non supporté : "${file.type}".` }, { status: 400 });
  }

  const maxBytes = maxBytesFor(messageType);
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
    const extension = EXTENSION_BY_MIME[file.type] ?? "bin";
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
    .insert({ group_id: groupId, user_id: user.id, type: messageType, media_url: mediaUrl, sender_name: senderName })
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
