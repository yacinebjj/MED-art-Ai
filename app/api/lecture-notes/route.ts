import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface LectureNotesJobListRow {
  id: number;
  title: string;
  status: "processing" | "done" | "failed";
  updated_at: string;
}

/**
 * "Notes récentes" list on the Audio to Smart Notes workspace
 * (app/dashboard/audio-workspace/page.tsx) — the missing piece that let a
 * saved note ever be found again. Only `status = "done"` rows: a
 * "processing"/"failed" job has no smart_notes/complete audio_urls set to
 * show, and surfacing it here would just be a dead link. Ordered newest
 * first (updated_at), capped at 50 — a simple flat list, no pagination yet,
 * matching this feature's current scale.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("lecture_notes_jobs")
    .select("id, title, status, updated_at")
    .eq("user_id", user.id)
    .eq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[lecture-notes:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const jobs = ((data ?? []) as LectureNotesJobListRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ success: true, jobs });
}
