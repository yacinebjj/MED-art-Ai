import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import {
  LECTURE_RECORDINGS_BUCKET,
  MAX_CHUNK_INDEX,
  UPLOAD_ID_PATTERN,
  ensureLectureRecordingsBucketCached,
  lectureChunkPath,
} from "@/lib/lecture-notes-storage";

export const runtime = "nodejs";

/**
 * Step 1 of a chunk's journey: a short-lived signed upload URL so the
 * BROWSER sends the ~7.7 MB WAV straight to Supabase Storage. Audio bytes
 * never transit through a Vercel Function body (hard ~4.5 MB ceiling), which
 * is what made long recordings fail before. Step 2 is
 * app/api/lecture-notes/transcribe-chunk (server-to-server download).
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`lecture-notes-sign:${user.id}`, RATE_LIMITS.lectureChunk);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  const { uploadId, chunkIndex } = (body ?? {}) as { uploadId?: unknown; chunkIndex?: unknown };
  if (typeof uploadId !== "string" || !UPLOAD_ID_PATTERN.test(uploadId)) {
    return NextResponse.json({ success: false, error: "'uploadId' invalide." }, { status: 400 });
  }
  if (typeof chunkIndex !== "number" || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > MAX_CHUNK_INDEX) {
    return NextResponse.json({ success: false, error: "'chunkIndex' invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  try {
    const supabase = getSupabaseAdmin();
    await ensureLectureRecordingsBucketCached(supabase);
    const path = lectureChunkPath(user.id, uploadId, chunkIndex);
    // upsert: a retried chunk (network drop mid-upload) overwrites its own partial attempt.
    const { data, error } = await supabase.storage.from(LECTURE_RECORDINGS_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) {
      console.error("[lecture-notes/upload-url] Échec URL signée:", error);
      return NextResponse.json({ success: false, error: "Impossible de préparer l'envoi du segment audio." }, { status: 500 });
    }
    return NextResponse.json({ success: true, bucket: LECTURE_RECORDINGS_BUCKET, path: data.path, token: data.token });
  } catch (error) {
    console.error("[lecture-notes/upload-url] Erreur inattendue:", error);
    return NextResponse.json({ success: false, error: "Impossible de préparer l'envoi du segment audio." }, { status: 500 });
  }
}
