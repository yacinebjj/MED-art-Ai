import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/flashcards/focus — body { moduleId }.
 *
 * "Lancer Flashcards 50" on a dashboard module card: the flashcard selection
 * becomes exactly THIS module (profiles.flashcard_active_module_ids =
 * [moduleId], flashcard_active_course_ids = [] → every course of the module).
 * Without clearing the course ids, a course ticked earlier in ANOTHER module
 * would keep this module's cards out of the batch (the generator serves
 * ticked courses only when any are ticked). The student can widen the
 * selection again from the Study page's course picker.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`flashcards-focus:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // handled below
  }
  const moduleId = Number((body as { moduleId?: unknown } | null)?.moduleId);
  if (!Number.isInteger(moduleId) || moduleId <= 0) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis (entier positif)." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: moduleRow, error: moduleError } = await supabase.from("curriculum_modules").select("id").eq("id", moduleId).maybeSingle();
  if (moduleError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${moduleError.message}` }, { status: 500 });
  }
  if (!moduleRow) {
    return NextResponse.json({ success: false, error: "Module introuvable." }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ flashcard_active_module_ids: [moduleId], flashcard_active_course_ids: [] })
    .eq("id", user.id);
  if (updateError) {
    console.error("[flashcards/focus] Échec mise à jour du profil :", updateError);
    return NextResponse.json({ success: false, error: `Mise à jour échouée : ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, activeModuleIds: [moduleId] });
}
