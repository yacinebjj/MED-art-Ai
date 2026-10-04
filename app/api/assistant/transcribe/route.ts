import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { transcribeAudioViaOpenRouter, OpenRouterError, type TranscriptionFormat } from "@/lib/ai/openrouter";

export const runtime = "nodejs";
// A single short dictation clip (a spoken chat question, well under a
// minute) transcribes fast — same generous headroom as every other
// single-AI-call route in this app (see e.g. lecture-notes/transcribe-chunk).
export const maxDuration = 60;

/**
 * Replaces the MedArt Assistant composer's old browser-native
 * SpeechRecognition dictation (app/dashboard/(shell)/assistant/page.tsx),
 * which depended on the browser vendor's own remote recognition service
 * reachable AFTER mic permission was granted — a network hiccup, an
 * unsupported locale, or a browser without full continuous-dictation
 * support could all make `onerror` fire with literally no feedback to the
 * student ("grants the permission, then nothing happens").
 *
 * Reuses this app's own proven MediaRecorder → server-side Whisper
 * pipeline (same `transcribeAudioViaOpenRouter` call as
 * app/api/lecture-notes/transcribe-chunk/route.ts) instead. Deliberately
 * NOT persisted to Supabase Storage first, unlike that route — a lecture
 * recording is saved alongside the generated notes, but a dictated chat
 * question is a fully ephemeral clip: nothing downstream ever needs the
 * audio again once it's transcribed, so skipping the upload step avoids
 * a real (Storage bucket + public URL) round trip for no benefit.
 *
 * Max clip size is intentionally small (8 MB — generous for a spoken
 * question, well under OpenRouter's ~24 MB multipart-safe ceiling) since
 * this is a short dictation, not a lecture chunk.
 */
const MAX_CLIP_BYTES = 8 * 1024 * 1024;

// MediaRecorder's actual output container varies by browser (Chrome/Edge:
// webm/opus, Safari: mp4/aac) — accept the common ones rather than assuming
// one, and fall back to "webm" (Whisper tolerates a slightly wrong-but-close
// container/codec hint far better than an outright rejected upload).
const MIME_TO_FORMAT: Record<string, TranscriptionFormat> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

function resolveFormat(mimeType: string): TranscriptionFormat {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  return MIME_TO_FORMAT[normalized] ?? "webm";
}

/**
 * Context hint for Whisper (not an instruction it "follows", a vocabulary /
 * style prior): an Algerian medical student who may speak French, Arabic or
 * Darja and mix them, with correctly spelled French medical terms.
 */
const DICTATION_PROMPT =
  "Question d'un étudiant en médecine algérien, en français, en arabe ou en darija algérienne, parfois mélangés. Vocabulaire médical : insuffisance cardiaque, hypertension artérielle, physiopathologie, sémiologie, électrocardiogramme, glomérulonéphrite, pneumopathie, antibiothérapie, QCM, cas clinique. واش هي الأعراض تاع المرض ؟";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`assistant-transcribe:${user.id}`, RATE_LIMITS.assistantDictation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de dictées vocales — réessaie dans quelques minutes." },
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
    return NextResponse.json({ success: false, error: "Aucun enregistrement audio reçu." }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ success: false, error: "L'enregistrement est vide — réessaie en parlant un peu plus longtemps." }, { status: 400 });
  }

  if (file.size > MAX_CLIP_BYTES) {
    return NextResponse.json(
      { success: false, error: `Enregistrement trop long (${(file.size / (1024 * 1024)).toFixed(1)} Mo, max ${MAX_CLIP_BYTES / (1024 * 1024)} Mo).` },
      { status: 413 }
    );
  }

  const format = resolveFormat(file.type || "audio/webm");
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    // No forced language: Whisper auto-detects French, Arabic or Algerian
    // Darja (forcing "fr" bent Darja/Arabic speech into wrong French). The
    // prompt only biases spelling towards medical vocabulary and the
    // student's real languages, it never translates.
    const { text } = await transcribeAudioViaOpenRouter(buffer, format, { prompt: DICTATION_PROMPT });
    return NextResponse.json({ success: true, text });
  } catch (error) {
    const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
    const status = error instanceof OpenRouterError ? error.status : 502;
    console.error("[assistant/transcribe] Échec transcription:", message);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
