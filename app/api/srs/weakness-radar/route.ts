import { NextResponse } from "next/server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mastery percentage per module (Gastroentérologie, Infectiologie, ...) for
 * the signed-in student, powering the frontend's radar chart. The
 * aggregation itself runs inside Postgres (the `weakness_radar` SQL
 * function — see the architecture writeup) rather than being pulled client-
 * side and reduced in JS, since GROUP BY + percentage math belongs in the
 * database, not the API layer.
 */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ radar: [] });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("weakness_radar", { p_user_id: user.id });

  if (error) {
    console.error("[srs/weakness-radar] Échec:", { code: error.code, message: error.message });
    return NextResponse.json({ radar: [] });
  }

  return NextResponse.json({ radar: data ?? [] });
}
