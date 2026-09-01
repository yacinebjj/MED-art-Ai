import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";

function parseCourseId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isFinite(id) ? id : null;
}

/**
 * Toggles ONE course in/out of `profiles.flashcard_active_course_ids` — the
 * per-course counterpart to /api/modules/[id]/flashcards's whole-module
 * toggle (see that route's own comment). Body: { active: boolean }. Mirrors
 * its exact read-modify-write shape for consistency, including the
 * optimistic-revert contract the frontend (FlashcardCoursePicker) relies on:
 * a non-2xx response here means the toggle DIDN'T take, and the caller
 * reverts its own local state rather than trusting an implicit success.
 */
export async function PATCH(request: NextRequest, { params }: { params: { courseId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`flashcards-course-picker-toggle:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const courseId = parseCourseId(params.courseId);
  if (courseId === null) {
    return NextResponse.json({ success: false, error: "Identifiant de cours invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { active } = (body ?? {}) as { active?: unknown };
  if (typeof active !== "boolean") {
    return NextResponse.json({ success: false, error: "'active' est requis et doit être un booléen." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  // Activating a course the student doesn't actually own would just sit as
  // a dead id in their own array (every downstream read still filters by
  // user_id — see /api/flashcards/pool's own comment), but confirming
  // ownership up front gives an honest 404 instead of a silent no-op, and
  // keeps the array meaningful.
  if (active) {
    const { data: course, error: courseError } = await supabase
      .from("studio_courses")
      .select("id")
      .eq("id", courseId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (courseError) {
      console.error("[flashcards/course-picker/[courseId]:patch] Échec vérification propriété:", courseError);
      return NextResponse.json({ success: false, error: `Vérification échouée : ${courseError.message}` }, { status: 500 });
    }
    if (!course) {
      return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
    }
  }

  const { data: profile, error: readError } = await supabase
    .from("profiles")
    .select("flashcard_active_course_ids")
    .eq("id", user.id)
    .maybeSingle<{ flashcard_active_course_ids: number[] | null }>();

  if (readError) {
    console.error("[flashcards/course-picker/[courseId]:patch] Échec lecture Supabase:", readError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${readError.message}` }, { status: 500 });
  }

  const current = profile?.flashcard_active_course_ids ?? [];
  const nextIds = active ? Array.from(new Set([...current, courseId])) : current.filter((id) => id !== courseId);

  const { error: updateError } = await supabase.from("profiles").update({ flashcard_active_course_ids: nextIds }).eq("id", user.id);

  if (updateError) {
    console.error("[flashcards/course-picker/[courseId]:patch] Échec écriture Supabase:", updateError);
    return NextResponse.json({ success: false, error: `Sauvegarde échouée : ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, active });
}
