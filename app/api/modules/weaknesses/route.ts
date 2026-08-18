import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which curriculum modules the current student has activated "Points Faibles & Plan de Remédiation" for — powers the badge/label on CurriculumView's module cards. Mirrors GET /api/modules/flashcards exactly. */
export async function GET(_request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("profiles")
    .select("weakness_active_module_ids")
    .eq("id", user.id)
    .maybeSingle<{ weakness_active_module_ids: number[] | null }>();

  if (error) {
    console.error("[modules/weaknesses:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${errorMessage(error)}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, activeModuleIds: data?.weakness_active_module_ids ?? [] });
}
