import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Same threshold as app/api/lecture-notes/process (its maxDuration + 60 s). */
const STALE_AFTER_MS = 360 * 1000;

/**
 * Lightweight poll target for the asynchronous extraction job
 * (app/api/lecture-notes/process). Returns the notes only once the job is
 * done — never the (large) transcript — so polling every few seconds stays
 * cheap. `stale: true` means the background run died without writing a
 * result; the client then offers a one-click relaunch.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }
  const jobId = Number(request.nextUrl.searchParams.get("jobId"));
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ success: false, error: "'jobId' invalide." }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const { data: job, error } = await getSupabaseAdmin()
    .from("lecture_notes_jobs")
    .select("id, status, smart_notes, error_message, updated_at")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: number; status: "processing" | "done" | "failed"; smart_notes: string | null; error_message: string | null; updated_at: string }>();

  if (error) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ success: false, error: "Note introuvable." }, { status: 404 });
  }

  return NextResponse.json(
    {
      success: true,
      jobId: job.id,
      status: job.status,
      smartNotes: job.status === "done" ? job.smart_notes : null,
      error: job.status === "failed" ? job.error_message : null,
      stale: job.status === "processing" && Date.now() - new Date(job.updated_at).getTime() > STALE_AFTER_MS,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
