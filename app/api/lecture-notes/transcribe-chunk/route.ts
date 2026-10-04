import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { transcribeAudioViaOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { LECTURE_TRANSCRIPTION_PROMPT } from "@/lib/ai/lecture-notes-prompts";
import { LECTURE_RECORDINGS_BUCKET, MAX_CHUNK_BYTES, MAX_CHUNK_INDEX, UPLOAD_ID_PATTERN, lectureChunkPath } from "@/lib/lecture-notes-storage";

export const runtime = "nodejs";
// One 4-minute chunk: a Storage download plus one Whisper call — well under this.
export const maxDuration = 120;

/**
 * Step 2 of a chunk's journey (step 1: app/api/lecture-notes/upload-url).
 * The browser already uploaded the chunk straight to Storage; this route
 * only receives `{ uploadId, chunkIndex }` (a few bytes), downloads the WAV
 * server-to-server, and transcribes it. Stateless and idempotent — the
 * client can retry a chunk safely, and runs up to 3 in parallel.
 *
 * Deliberately NOT quota-gated per chunk (one lecture = one generation,
 * reserved once in app/api/lecture-notes/process); RATE_LIMITS.lectureChunk
 * is this route's cost guardrail.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`lecture-notes-chunk:${user.id}`, RATE_LIMITS.lectureChunk);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête invalide : ${errorMessage(error)}` }, { status: 400 });
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

  const supabase = getSupabaseAdmin();
  const path = lectureChunkPath(user.id, uploadId, chunkIndex);

  let buffer: Buffer;
  try {
    const { data, error } = await supabase.storage.from(LECTURE_RECORDINGS_BUCKET).download(path);
    if (error || !data) throw error ?? new Error("segment introuvable");
    if (data.size > MAX_CHUNK_BYTES) {
      return NextResponse.json({ success: false, error: "Segment audio trop volumineux." }, { status: 413 });
    }
    buffer = Buffer.from(await data.arrayBuffer());
  } catch (error) {
    console.error("[lecture-notes/transcribe-chunk] Segment illisible dans Storage:", error);
    return NextResponse.json({ success: false, error: "Le segment audio n'a pas été trouvé — renvoi nécessaire." }, { status: 404 });
  }

  const audioUrl = supabase.storage.from(LECTURE_RECORDINGS_BUCKET).getPublicUrl(path).data.publicUrl;

  try {
    const { text } = await transcribeAudioViaOpenRouter(buffer, "wav", { prompt: LECTURE_TRANSCRIPTION_PROMPT, timeoutMs: 100_000 });
    return NextResponse.json({ success: true, text, audioUrl });
  } catch (error) {
    const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
    const status = error instanceof OpenRouterError ? error.status : 502;
    // A silent chunk (pause, break between two parts of the lecture) is not a failure of the whole lecture.
    if (/vide|silencieux/i.test(message)) {
      return NextResponse.json({ success: true, text: "", audioUrl });
    }
    console.error("[lecture-notes/transcribe-chunk] Échec transcription:", message);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
