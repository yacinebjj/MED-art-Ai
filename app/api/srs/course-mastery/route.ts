import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real mastery percentage per COURSE (as opposed to weakness-radar's
 * per-module aggregation) for the signed-in student, powering the dual
 * performance indicator on individual course cards in "Mes Cours Récents"
 * (components/dashboard/PublicCourseCard.tsx). The aggregation runs inside
 * Postgres — the `course_mastery` SQL function — same pattern as
 * app/api/srs/weakness-radar/route.ts.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ mastery: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("course_mastery", { p_user_id: user.id });

  if (error) {
    console.error("[srs/course-mastery] Échec:", { code: error.code, message: error.message });
    return NextResponse.json({ mastery: [] });
  }

  return NextResponse.json({ mastery: data ?? [] });
}
