import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST — the caller leaves the group (or withdraws a pending join request).
 * The admin cannot simply leave: they first hand the group over
 * (PATCH /api/groups/[id] { transferAdminTo }) or delete it — a group is
 * never left without an admin.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: group, error: groupError } = await supabase.from("chat_groups").select("admin_id").eq("id", params.id).maybeSingle();
  if (groupError) return NextResponse.json({ success: false, error: `Lecture échouée : ${groupError.message}` }, { status: 500 });
  if (!group) return NextResponse.json({ success: false, error: "Groupe introuvable." }, { status: 404 });
  if (group.admin_id === user.id) {
    return NextResponse.json(
      { success: false, error: "En tant qu'administrateur, transmets d'abord le groupe à un membre — ou supprime-le." },
      { status: 400 }
    );
  }

  const { error, count } = await supabase.from("chat_members").delete({ count: "exact" }).eq("group_id", params.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ success: false, error: `Échec : ${error.message}` }, { status: 500 });
  if (count === 0) return NextResponse.json({ success: false, error: "Tu n'es pas membre de ce groupe." }, { status: 404 });
  return NextResponse.json({ success: true });
}
