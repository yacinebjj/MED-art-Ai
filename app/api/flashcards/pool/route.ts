import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { parseContentLanguage } from "@/lib/ai/language-directive";
import type { FlashcardPoolItem } from "@/types/flashcard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One study batch — the opening batch of a session (cards already served before, shuffled across the selected courses). Later batches come from /api/flashcards/generate. */
const MAX_POOL_SIZE = 25;

interface StudioCourseFlashcardRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  /** `lang` absent = served before languages existed = French. */
  flashcard_queue: { id: string; question: string; answer: string; lang?: "fr" | "en" }[] | null;
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
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  // Global AI-content language (store/useLanguageStore.ts): only cards served in this language are pooled.
  const language = parseContentLanguage(request.nextUrl.searchParams.get("language"));

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
    if (activeModuleIds.length === 0) {
      return NextResponse.json({ success: true, items: [], activeModuleCount: 0, activeModuleIds: [], activeCourseIds: [] });
    }

    // STRICT course selection: when the student ticked specific courses in
    // the picker modal, ONLY those courses' flashcards may appear — the query
    // itself is restricted to their ids (still inside the activated modules,
    // and always the student's own rows). With nothing ticked, the whole
    // activated modules apply, as before.
    let coursesQuery = supabase
      .from("studio_courses")
      .select("id, title, curriculum_module_id, flashcard_queue")
      .eq("user_id", user.id)
      .in("curriculum_module_id", activeModuleIds);
    if (activeCourseIds.length > 0) coursesQuery = coursesQuery.in("id", activeCourseIds);
    const { data: courses, error: coursesError } = await coursesQuery;

    if (coursesError) {
      console.error("[flashcards/pool] Échec lecture studio_courses:", coursesError);
      return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
    }

    const rows = (courses ?? []) as StudioCourseFlashcardRow[];
    const items: FlashcardPoolItem[] = shuffle(
      rows.flatMap((row) =>
        (row.flashcard_queue ?? [])
          .filter((card) => (card.lang ?? "fr") === language)
          .map((card) => ({
            id: card.id,
            question: card.question,
            answer: card.answer,
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
