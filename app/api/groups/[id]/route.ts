import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET — one group's basic info, plus the caller's own membership status (403s if they have no membership row at all). */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const groupId = params.id;
  if (!groupId) {
    return NextResponse.json({ success: false, error: "Identifiant de groupe invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: group, error: groupError } = await supabase
    .from("chat_groups")
    .select("id, name, admin_id, join_code, created_at")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${groupError.message}` }, { status: 500 });
  }
  if (!group) {
    return NextResponse.json({ success: false, error: "Groupe introuvable." }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("chat_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${membershipError.message}` }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ success: false, error: "Tu n'es pas membre de ce groupe." }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    group: { id: group.id, name: group.name, adminId: group.admin_id, joinCode: group.join_code, createdAt: group.created_at },
    myStatus: membership.status,
  });
}
