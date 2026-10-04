import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";
import { callOpenRouter, ECONOMY_MODEL, OpenRouterError } from "@/lib/ai/openrouter";
import { LECTURE_NOTES_SYSTEM_PROMPT, MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION, buildLectureNotesUserMessage } from "@/lib/ai/lecture-notes-prompts";
import { stripTimestamps } from "@/lib/lecture-transcript";
import { reserveGeneration, refundGeneration } from "@/lib/subscription";

export const runtime = "nodejs";
// The background extraction below keeps this invocation alive (waitUntil) up to this ceiling.
export const maxDuration = 300;

/** A job still "processing" this long after its last update was killed mid-flight (deploy, crash) — it may be relaunched without a second quota charge. */
const STALE_AFTER_MS = (maxDuration + 60) * 1000;

type Supabase = ReturnType<typeof getSupabaseAdmin>;

/**
 * Phase 2 of "Audio to Smart Notes" as an asynchronous job: this route
 * creates (or relaunches) the `lecture_notes_jobs` row, answers IMMEDIATELY
 * with `{ jobId, status: "processing" }`, and runs the extraction in the
 * background (`waitUntil`). The client polls app/api/lecture-notes/status.
 *
 * Why not a held-open request: a 2-hour transcript takes 1-3 minutes to
 * structure, and mobile carriers drop idle connections after 30-120 s of
 * silence (documented in app/api/studio/generate/explication-part). With a
 * job id, a dropped connection, a locked phone or a closed tab loses
 * nothing — the result is written to the row either way.
 *
 * Body: `{ title, transcript, audioUrls }` to create, or `{ jobId }` to
 * relaunch a failed/stale job from its saved transcript.
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

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }
  const supabase = getSupabaseAdmin();
  const { title: titleRaw, transcript, audioUrls, jobId: relaunchId } = (body ?? {}) as {
    title?: unknown;
    transcript?: unknown;
    audioUrls?: unknown;
    jobId?: unknown;
  };

  // ── Relaunch an existing job ───────────────────────────────────────────
  if (relaunchId !== undefined) {
    if (typeof relaunchId !== "number" || !Number.isInteger(relaunchId)) {
      return NextResponse.json({ success: false, error: "'jobId' invalide." }, { status: 400 });
    }
    const { data: job } = await supabase
      .from("lecture_notes_jobs")
      .select("id, status, transcript, updated_at")
      .eq("id", relaunchId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: number; status: string; transcript: string | null; updated_at: string }>();
    if (!job || !job.transcript) {
      return NextResponse.json({ success: false, error: "Note introuvable ou sans transcription." }, { status: 404 });
    }
    const stale = job.status === "processing" && Date.now() - new Date(job.updated_at).getTime() > STALE_AFTER_MS;
    if (job.status === "done") return NextResponse.json({ success: true, jobId: job.id, status: "done" });
    if (job.status === "processing" && !stale) return NextResponse.json({ success: true, jobId: job.id, status: "processing" });

    // A "failed" run was refunded, so it is charged again; a stale one never got to refund, so it is not.
    if (job.status === "failed") {
      const gate = await reserveGeneration(user);
      if (!gate.allowed) return NextResponse.json({ success: false, error: gate.reason }, { status: 403 });
    }
    await supabase.from("lecture_notes_jobs").update({ status: "processing", error_message: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    waitUntil(runExtraction(supabase, user.id, job.id, job.transcript));
    return NextResponse.json({ success: true, jobId: job.id, status: "processing" });
  }

  // ── Create a new job ───────────────────────────────────────────────────
  if (typeof transcript !== "string" || stripTimestamps(transcript).trim().length < 20) {
    return NextResponse.json({ success: false, error: "La transcription est vide ou trop courte — l'audio est peut-être silencieux." }, { status: 400 });
  }
  if (!Array.isArray(audioUrls) || audioUrls.some((u) => typeof u !== "string")) {
    return NextResponse.json({ success: false, error: "'audioUrls' doit être un tableau de chaînes." }, { status: 400 });
  }
  const title = typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim().slice(0, 200) : "Cours enregistré";

  const quotaGate = await reserveGeneration(user);
  if (!quotaGate.allowed) {
    return NextResponse.json({ success: false, error: quotaGate.reason }, { status: 403 });
  }

  // The transcript is saved with the row from the start: a later relaunch
  // never needs the (already uploaded, already paid) audio again.
  const { data: job, error: insertError } = await supabase
    .from("lecture_notes_jobs")
    .insert({ user_id: user.id, title, audio_urls: audioUrls, transcript, status: "processing" })
    .select("id")
    .single();

  if (insertError || !job) {
    await refundGeneration(user.id);
    console.error("[lecture-notes/process] Échec création du job:", insertError);
    return NextResponse.json({ success: false, error: `La création du job a échoué : ${insertError?.message ?? "raison inconnue"}` }, { status: 500 });
  }

  waitUntil(runExtraction(supabase, user.id, job.id, transcript));
  return NextResponse.json({ success: true, jobId: job.id, status: "processing" });
}

async function runExtraction(supabase: Supabase, userId: string, jobId: number, transcript: string): Promise<void> {
  try {
    const spoken = stripTimestamps(transcript).slice(0, MAX_TRANSCRIPT_CHARS_FOR_EXTRACTION);
    const smartNotes = await callOpenRouter(
      [
        { role: "system", content: LECTURE_NOTES_SYSTEM_PROMPT },
        { role: "user", content: buildLectureNotesUserMessage(spoken) },
      ],
      // Low temperature: factual fidelity over fluency. Reasoning capped low so
      // hidden thinking never eats the visible notes' budget.
      { model: ECONOMY_MODEL, maxTokens: 12_000, temperature: 0.15, reasoning: { effort: "low" }, timeoutMs: 240_000, bypassMock: true, providerSort: "throughput" }
    );
    if (!smartNotes.trim()) throw new Error("L'IA a renvoyé des notes vides.");

    await supabase
      .from("lecture_notes_jobs")
      .update({ status: "done", smart_notes: smartNotes, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch (error) {
    await refundGeneration(userId);
    const message = error instanceof OpenRouterError ? error.message : errorMessage(error);
    console.error("[lecture-notes/process] Échec extraction:", message);
    await supabase
      .from("lecture_notes_jobs")
      .update({ status: "failed", error_message: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", jobId);
  }
}
