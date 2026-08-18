import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TOTAL_SECTIONS = 5; // explication, resume, cas_clinique, qcms, exemples_analogies

interface StudioCourseProgressRow {
  id: number;
  title: string;
  explication: string | null;
  resume: unknown;
  cas_clinique: unknown;
  qcms: unknown;
  exemples_analogies: string | null;
}

/**
 * "Voir statistiques" on a module card's ⋮ menu. Combines two real signals:
 *  - QCM mastery from qcm_attempts, via the same `course_mastery` Postgres
 *    function the Dashboard's own course cards use — it groups purely by
 *    course_slug with no join to any courses table, so it already covers
 *    this pipeline's synthetic `studio-course-{id}` slugs the moment real
 *    attempts exist (GastriteQcmsStudio here no longer runs in preview mode).
 *  - How much of each course's Studio content has actually been generated —
 *    the only signal available for a course with zero QCM attempts yet, and
 *    still a fair "à compléter en priorité" proxy on its own.
 * A course with no QCM attempts at all shows an honest "—" for mastery
 * rather than a fabricated 0%.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const moduleIdParam = request.nextUrl.searchParams.get("moduleId");
  const moduleId = moduleIdParam ? Number(moduleIdParam) : NaN;
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ success: false, error: "'moduleId' est requis et doit être un nombre." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("studio_courses")
    .select("id, title, explication, resume, cas_clinique, qcms, exemples_analogies")
    .eq("user_id", user.id)
    .eq("curriculum_module_id", moduleId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[studio/courses/stats] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const { data: masteryData, error: masteryError } = await supabase.rpc("course_mastery", { p_user_id: user.id });
  if (masteryError) {
    console.error("[studio/courses/stats] Échec lecture course_mastery:", masteryError);
  }
  const masteryBySlug = new Map<string, number>(
    ((masteryData ?? []) as { course_slug: string; mastery_pct: number }[]).map((row) => [row.course_slug, row.mastery_pct])
  );

  const rows = (data ?? []) as StudioCourseProgressRow[];
  const courses = rows.map((row) => {
    const generatedSections = [row.explication, row.resume, row.cas_clinique, row.qcms, row.exemples_analogies].filter(
      (value) => value !== null && value !== undefined
    ).length;
    return {
      id: row.id,
      title: row.title,
      generatedSections,
      totalSections: TOTAL_SECTIONS,
      progressPct: Math.round((generatedSections / TOTAL_SECTIONS) * 100),
      qcmSuccessPct: masteryBySlug.get(`studio-course-${row.id}`),
    };
  });

  const needsReview = courses
    .filter((c) => c.progressPct < 50 || (c.qcmSuccessPct !== undefined && c.qcmSuccessPct < 50))
    .sort((a, b) => (a.qcmSuccessPct ?? a.progressPct) - (b.qcmSuccessPct ?? b.progressPct));

  return NextResponse.json({ success: true, courseCount: courses.length, courses, needsReview });
}
