import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ChatMember } from "@/types/group-chat";

export const runtime = "nodejs";

interface ChatMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  status: "pending" | "accepted";
  display_name: string | null;
  joined_at: string;
}

function toMember(row: ChatMemberRow): ChatMember {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    status: row.status,
    displayName: row.display_name,
    joinedAt: row.joined_at,
  };
}

/**
 * GET — the group's member list. Admins see everyone (pending included, for
 * the "Demandes en attente" tab); ordinary accepted members only ever see
 * the accepted roster, never who else has a pending request in.
 */
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

  const { data: group, error: groupError } = await supabase.from("chat_groups").select("admin_id").eq("id", groupId).maybeSingle();
  if (groupError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${groupError.message}` }, { status: 500 });
  }
  if (!group) {
    return NextResponse.json({ success: false, error: "Groupe introuvable." }, { status: 404 });
  }

  const isAdmin = group.admin_id === user.id;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("chat_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (myMembershipError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${myMembershipError.message}` }, { status: 500 });
  }
  if (!isAdmin && myMembership?.status !== "accepted") {
    return NextResponse.json({ success: false, error: "Tu n'es pas membre de ce groupe." }, { status: 403 });
  }

  let query = supabase.from("chat_members").select("id, group_id, user_id, status, display_name, joined_at").eq("group_id", groupId);
  if (!isAdmin) query = query.eq("status", "accepted");

  const { data, error } = await query.order("joined_at", { ascending: true });
  if (error) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, members: ((data ?? []) as ChatMemberRow[]).map(toMember), isAdmin });
}
