import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

function parseJobId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

/**
 * Powers the "Sauvegarder" button on the Audio to Smart Notes workspace
 * (app/dashboard/audio-workspace/page.tsx). The note is already persisted
 * the moment app/api/lecture-notes/process succeeds (status "done", real
 * row in `lecture_notes_jobs`) — this endpoint's real job is letting the
 * student rename it before confirming, not the persistence itself.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`lecture-notes-patch:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const id = parseJobId(params.id);
  if (id === null) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { title } = (body ?? {}) as { title?: unknown };
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ success: false, error: "'title' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // .eq("user_id", ...) on the UPDATE itself is what stops one student from renaming another's note by guessing an id.
  const { error, count } = await supabase
    .from("lecture_notes_jobs")
    .update({ title: title.trim().slice(0, 200), updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[lecture-notes/[id]:patch] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Note introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
