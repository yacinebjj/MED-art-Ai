import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** QCMs due for review right now for the signed-in student, oldest-due first. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ due: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("qcm_attempts")
    .select("course_slug, qcm_id, leitner_box, next_review_at")
    .eq("user_id", user.id)
    .lte("next_review_at", new Date().toISOString())
    .order("next_review_at", { ascending: true });

  if (error) {
    console.error("[srs/due] Échec lecture:", { code: error.code, message: error.message });
    return NextResponse.json({ due: [] });
  }

  return NextResponse.json({ due: data ?? [] });
}
