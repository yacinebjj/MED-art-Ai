import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { callOpenRouter, CHEAP_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import {
  LECTURE_NOTES_SYSTEM_PROMPT,
  MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION,
  buildLectureNotesUserMessage,
} from "@/lib/ai/lecture-notes-prompts";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Dashboard "Audio to Smart Notes" — Phase 2 only. The raw audio never
 * reaches this route anymore: a real 1-2h recording (50-300+ Mo) blows past
 * OpenRouter's confirmed hard 50 MiB request-body ceiling in one shot no
 * matter how it's encoded (see lib/ai/openrouter.ts's own comment), so the
 * client (components/dashboard/LectureNotesUploader.tsx) decodes and splits
 * the recording into small chunks itself (lib/audio/browser-chunking.ts),
 * transcribes each one via app/api/lecture-notes/transcribe-chunk, and sends
 * this route the ALREADY-JOINED full transcript plus the ordered list of
 * chunk Storage URLs. This route's only job now: create the
 * `lecture_notes_jobs` row, run the Phase 2 extraction call, save the
 * result.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`lecture-notes:${user.id}`, RATE_LIMITS.ai);
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
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { title: titleRaw, transcript, audioUrls } = (body ?? {}) as {
    title?: unknown;
    transcript?: unknown;
    audioUrls?: unknown;
  };

  if (typeof transcript !== "string" || transcript.trim().length < 20) {
    return NextResponse.json(
      { success: false, error: "'transcript' est requis (transcription vide ou trop courte)." },
      { status: 400 }
    );
  }
  if (!Array.isArray(audioUrls) || audioUrls.some((u) => typeof u !== "string")) {
    return NextResponse.json({ success: false, error: "'audioUrls' doit être un tableau de chaînes." }, { status: 400 });
  }

  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim() : "Cours enregistré";

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: job, error: insertError } = await supabase
    .from("lecture_notes_jobs")
    .insert({ user_id: user.id, title, audio_urls: audioUrls, status: "processing" })
    .select("id")
    .single();

  if (insertError || !job) {
    // If `lecture_notes_jobs` doesn't exist yet (migration not run) or its
    // `audio_urls` column is missing/wrong-typed, THIS is where it surfaces
    // — insertError.message will say so explicitly (e.g. a Postgres
    // "column does not exist" error) instead of a generic message.
    console.error("[lecture-notes/process] Échec création du job:", insertError);
    return NextResponse.json(
      { success: false, error: `La création du job a échoué : ${insertError?.message ?? "raison inconnue"}` },
      { status: 500 }
    );
  }

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    await supabase.from("lecture_notes_jobs").update({ status: "failed", error_message: quotaGate.reason }).eq("id", job.id);
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  try {
    const excerpt = transcript.slice(0, MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION);
    const smartNotes = await callOpenRouter(
      [
        { role: "system", content: LECTURE_NOTES_SYSTEM_PROMPT },
        { role: "user", content: buildLectureNotesUserMessage(excerpt) },
      ],
      { model: CHEAP_MODEL, maxTokens: 2000, bypassMock: true }
    );

    await supabase
      .from("lecture_notes_jobs")
      .update({ status: "done", transcript, smart_notes: smartNotes, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    return NextResponse.json({ success: true, jobId: job.id, smartNotes });
  } catch (error) {
    await refundGeneration(user.id);
    const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
    const status = error instanceof OpenRouterError ? error.status : 502;

    await supabase
      .from("lecture_notes_jobs")
      .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
      .eq("id", job.id);

    console.error("[lecture-notes/process] Échec extraction:", message);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
