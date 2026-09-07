import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which curriculum modules the current student has activated flashcards for
 * — powers the badge/label on CurriculumView's module cards. Reads
 * `profiles.flashcard_active_module_ids` (see supabase/schema.sql) rather
 * than a dedicated join table — that table's own PostgREST schema-cache
 * entry never picked up in this project, while `profiles` is a
 * long-established table already recognized by PostgREST.
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
  const { data, error } = await supabase
    .from("profiles")
    .select("flashcard_active_module_ids")
    .eq("id", user.id)
    .maybeSingle<{ flashcard_active_module_ids: number[] | null }>();

  if (error) {
    console.error("[modules/flashcards:get] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${errorMessage(error)}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, activeModuleIds: data?.flashcard_active_module_ids ?? [] });
}
