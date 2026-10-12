import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { STUDIO_SECTION_KEYS } from "@/lib/ai/studio-prompts";
import type { JsonSectionId } from "@/lib/demo-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight read of ONE generated Studio section — what the module page
 * polls to recover a generation whose connection dropped after the server
 * accepted it (the server finishes and saves regardless; see
 * lib/http/keep-alive.ts). Deliberately separate from GET /api/studio/courses/[id],
 * which also returns the full raw_text and is far too heavy to poll.
 *
 * GET ?section=qcm|cas_clinique|resume|exemples_analogies|explication
 * → { success, data: <section JSON or null>, updatedAt }
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const courseId = Number(params.id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ success: false, error: "Identifiant de cours invalide." }, { status: 400 });
  }

  const section = request.nextUrl.searchParams.get("section");
  if (!section || !Object.prototype.hasOwnProperty.call(STUDIO_SECTION_KEYS, section)) {
    return NextResponse.json({ success: false, error: "Section invalide." }, { status: 400 });
  }
  const column = STUDIO_SECTION_KEYS[section as JsonSectionId];

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("studio_courses")
    .select(`${column}, updated_at`)
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    console.error("[studio/courses/[id]/section] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: "Lecture échouée. Réessaie." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: "Cours introuvable." }, { status: 404 });
  }

  return NextResponse.json(
    { success: true, data: data[column] ?? null, updatedAt: data.updated_at ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
