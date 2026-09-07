import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The individual weakest QCM/QROC attempts for the signed-in student in ONE
 * course — powers the "Statistiques" modal's "Points faibles" section
 * (components/dashboard/CourseStatsModal.tsx, lib/weak-points.ts). The
 * aggregation runs inside Postgres — the `course_weak_qcms` SQL function —
 * same pattern as app/api/srs/course-mastery/route.ts.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const courseSlug = request.nextUrl.searchParams.get("courseSlug");
  if (!courseSlug) {
    return NextResponse.json({ error: "Le paramètre 'courseSlug' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ weakQcms: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("course_weak_qcms", {
    p_user_id: user.id,
    p_course_slug: courseSlug,
  });

  if (error) {
    console.error("[srs/course-weak-points] Échec:", { code: error.code, message: error.message });
    return NextResponse.json({ weakQcms: [] });
  }

  return NextResponse.json({ weakQcms: data ?? [] });
}
