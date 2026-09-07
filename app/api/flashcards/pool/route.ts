import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import type { FlashcardPoolItem } from "@/types/flashcard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session hard ceiling — mirrors ActiveFlashcardsDeck's own SESSION_CAP; see this file's header comment. */
const MAX_POOL_SIZE = 60;

interface StudioCourseFlashcardRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  flashcard_queue: { id: string; question: string; answer: string }[] | null;
}

/** Fisher-Yates — used instead of `.sort(() => Math.random() - 0.5)`, which is a well-known non-uniform shuffle. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Pools every already-generated Q&A flashcard
 * (studio_courses.flashcard_queue) from ALL of the current user's activated
 * modules — and every course within each of them — shuffled together into
 * one rich, blended deck. Used by ActiveFlashcardsDeck. `activeModuleCount`
 * lets the frontend tell "no modules activated at all" apart from "modules
 * activated, but none has any flashcard generated yet" — two different
 * empty states, never conflated. No more QCM/QROC data here at all — this
 * feature moved entirely to freshly-generated Q&A pairs (see
 * app/api/flashcards/generate/route.ts).
 *
 * Capped at MAX_POOL_SIZE: with activation additive across possibly many
 * modules and cards accumulating in `flashcard_queue` across every past
 * session, the true pool can grow unbounded — this keeps one session's
 * initial payload bounded and never hands the frontend more than a single
 * session ever needs (see ActiveFlashcardsDeck's own SESSION_CAP).
 */
export async function GET(_request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("flashcard_active_module_ids, flashcard_active_course_ids")
      .eq("id", user.id)
      .maybeSingle<{ flashcard_active_module_ids: number[] | null; flashcard_active_course_ids: number[] | null }>();

    if (profileError) {
      console.error("[flashcards/pool] Échec lecture profiles:", profileError);
      return NextResponse.json({ success: false, error: `Lecture échouée : ${profileError.message}` }, { status: 500 });
    }

    const activeModuleIds = profile?.flashcard_active_module_ids ?? [];
    const activeCourseIds = profile?.flashcard_active_course_ids ?? [];
    if (activeModuleIds.length === 0 && activeCourseIds.length === 0) {
      return NextResponse.json({ success: true, items: [], activeModuleCount: 0, activeModuleIds: [], activeCourseIds: [] });
    }

    // A course is eligible if EITHER its whole module was activated OR it
    // was individually picked (FlashcardCoursePicker) — additive, never one
    // overriding the other. `.or()` unions both conditions in one query
    // instead of two round trips + a client-side merge.
    const orFilters: string[] = [];
    if (activeModuleIds.length > 0) orFilters.push(`curriculum_module_id.in.(${activeModuleIds.join(",")})`);
    if (activeCourseIds.length > 0) orFilters.push(`id.in.(${activeCourseIds.join(",")})`);

    const { data: courses, error: coursesError } = await supabase
      .from("studio_courses")
      .select("id, title, curriculum_module_id, flashcard_queue")
      .eq("user_id", user.id)
      .or(orFilters.join(","));

    if (coursesError) {
      console.error("[flashcards/pool] Échec lecture studio_courses:", coursesError);
      return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
    }

    const rows = (courses ?? []) as StudioCourseFlashcardRow[];
    const items: FlashcardPoolItem[] = shuffle(
      rows.flatMap((row) =>
        (row.flashcard_queue ?? []).map((card) => ({
          ...card,
          courseTitle: row.title,
          moduleId: row.curriculum_module_id,
        }))
      )
    ).slice(0, MAX_POOL_SIZE);

    // `activeModuleIds`/`activeCourseIds` are echoed back (not just their
    // counts) so the frontend can build a stable localStorage key for
    // "resume where I left off" — see ActiveFlashcardsDeck's own getStorageKey.
    return NextResponse.json({
      success: true,
      items,
      activeModuleCount: activeModuleIds.length,
      activeModuleIds,
      activeCourseIds,
    });
  } catch (error) {
    console.error("[flashcards/pool] Erreur non gérée:", error);
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
  }
}
