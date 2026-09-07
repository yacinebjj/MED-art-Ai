import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { transcribeAudioViaOpenRouter, OpenRouterError } from "@/lib/ai/openrouter";
import { LECTURE_RECORDINGS_BUCKET, MAX_CHUNK_BYTES, ensureLectureRecordingsBucket } from "@/lib/lecture-notes-storage";

export const runtime = "nodejs";
// One chunk (~8 min of audio, ~15.4 MB) transcribes fast — generous headroom
// over what a single OpenRouter call should ever need, same class as every
// other single-AI-call route in this app.
export const maxDuration = 120;

/**
 * Transcribes ONE small audio chunk produced client-side by
 * lib/audio/browser-chunking.ts (see that file's own header comment for WHY
 * this exists: OpenRouter's transcription endpoint hard-caps the whole
 * request body at 50 MiB, confirmed live 2026-09-02 via a real 413 — a raw
 * 1-2h lecture recording routinely exceeds that in ONE piece, chunked or
 * not, JSON or multipart). Stateless and per-chunk: no `lecture_notes_jobs`
 * row here — the client accumulates every chunk's `{ text, audioUrl }` and
 * sends the FULL joined transcript to app/api/lecture-notes/process, which
 * owns creating that row and running Phase 2 extraction exactly once.
 *
 * Deliberately NOT gated by reserveGeneration/refundGeneration per chunk —
 * that would spend multiple quota units for what the product treats as ONE
 * generation event (same "one quota unit for the whole thing" convention as
 * Slides' N-parallel-image-calls-per-deck). RATE_LIMITS.lectureChunk is this
 * route's only real cost guardrail; the one quota unit is reserved once, in
 * app/api/lecture-notes/process, after all chunks are already done.
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Aucun segment audio reçu." }, { status: 400 });
  }

  if (file.size > MAX_CHUNK_BYTES) {
    return NextResponse.json(
      { success: false, error: `Segment trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_CHUNK_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  const uploadIdField = formData.get("uploadId");
  const chunkIndexField = formData.get("chunkIndex");
  const uploadId = typeof uploadIdField === "string" && uploadIdField.trim() ? uploadIdField.trim() : randomUUID();
  const chunkIndex = typeof chunkIndexField === "string" && /^\d+$/.test(chunkIndexField) ? chunkIndexField : "0";

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const buffer = Buffer.from(await file.arrayBuffer());

  let audioUrl: string;
  try {
    await ensureLectureRecordingsBucket(supabase);
    const path = `${user.id}/${uploadId}/chunk-${chunkIndex}.wav`;
    const { error: uploadError } = await supabase.storage
      .from(LECTURE_RECORDINGS_BUCKET)
      .upload(path, buffer, { contentType: "audio/wav", upsert: true });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(LECTURE_RECORDINGS_BUCKET).getPublicUrl(path);
    audioUrl = publicUrlData.publicUrl;
  } catch (error) {
    console.error("[lecture-notes/transcribe-chunk] Échec de l'upload du segment:", error);
    return NextResponse.json(
      { success: false, error: `L'envoi du segment audio a échoué : ${errorMessage(error)}` },
      { status: 500 }
    );
  }

  try {
    // Chunks are always small mono 16kHz WAV (see lib/audio/browser-
    // chunking.ts) — always well under the multipart-safe threshold, so
    // this always takes the reliable, documented multipart path.
    const { text } = await transcribeAudioViaOpenRouter(buffer, "wav");
    return NextResponse.json({ success: true, text, audioUrl });
  } catch (error) {
    const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
    const status = error instanceof OpenRouterError ? error.status : 502;
    console.error("[lecture-notes/transcribe-chunk] Échec transcription:", message);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
