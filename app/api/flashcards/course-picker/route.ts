import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CoursePickerRow {
  id: number;
  title: string;
  curriculum_module_id: number;
  curriculum_modules: { title: string } | null;
}

/**
 * Every eligible course (has an Explication generated — same eligibility
 * bar as /api/flashcards/generate) across EVERY module the student has, not
 * just the ones already activated whole via flashcard_active_module_ids —
 * this is what powers FlashcardCoursePicker's ad-hoc "pick 2-3 specific
 * courses for this session" list, distinct from (and additive to) the
 * whole-module toggle on CurriculumView's cards.
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

  const [{ data: profile, error: profileError }, { data: courses, error: coursesError }] = await Promise.all([
    supabase.from("profiles").select("flashcard_active_course_ids").eq("id", user.id).maybeSingle<{ flashcard_active_course_ids: number[] | null }>(),
    supabase
      .from("studio_courses")
      .select("id, title, curriculum_module_id, curriculum_modules(title)")
      .eq("user_id", user.id)
      .not("explication", "is", null)
      .order("title", { ascending: true }),
  ]);

  if (profileError) {
    console.error("[flashcards/course-picker:get] Échec lecture profil:", profileError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${profileError.message}` }, { status: 500 });
  }
  if (coursesError) {
    console.error("[flashcards/course-picker:get] Échec lecture cours:", coursesError);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${coursesError.message}` }, { status: 500 });
  }

  const activeCourseIds = new Set(profile?.flashcard_active_course_ids ?? []);
  const rows = (courses ?? []) as unknown as CoursePickerRow[];

  const items = rows.map((row) => ({
    id: row.id,
    title: row.title,
    moduleId: row.curriculum_module_id,
    moduleName: row.curriculum_modules?.title ?? "Module",
    active: activeCourseIds.has(row.id),
  }));

  return NextResponse.json({ success: true, courses: items });
}
