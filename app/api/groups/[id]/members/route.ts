import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { isMissingColumnError } from "@/lib/group-chat";
import type { ChatMember } from "@/types/group-chat";

export const runtime = "nodejs";

interface ChatMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  status: "pending" | "accepted";
  display_name: string | null;
  joined_at: string;
  last_read_at?: string | null;
}

function toMember(row: ChatMemberRow, academicYearName: string | null): ChatMember {
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    status: row.status,
    displayName: row.display_name,
    joinedAt: row.joined_at,
    lastReadAt: row.last_read_at ?? null,
    academicYearName,
  };
}

/**
 * chat_members.user_id references auth.users, not profiles — there's no FK
 * PostgREST can embed through, so this is two small manual lookups (real
 * data, not fabricated): profiles.academic_year_id per member, then
 * curriculum_academic_years.name for the distinct year ids found. No
 * "Professeur"/role badge is built from this — that concept doesn't exist
 * anywhere in this schema (see the ChatMember type's own comment).
 */
async function academicYearNamesByUserId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[]
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id, academic_year_id")
    .in("id", userIds);
  if (profileError || !profileRows) return new Map();

  const yearIdByUserId = new Map<string, number>();
  const yearIds = new Set<number>();
  for (const row of profileRows as { id: string; academic_year_id: number | null }[]) {
    if (row.academic_year_id === null) continue;
    yearIdByUserId.set(row.id, row.academic_year_id);
    yearIds.add(row.academic_year_id);
  }
  if (yearIds.size === 0) return new Map();

  const { data: yearRows, error: yearError } = await supabase
    .from("curriculum_academic_years")
    .select("id, name")
    .in("id", Array.from(yearIds));
  if (yearError || !yearRows) return new Map();

  const nameByYearId = new Map((yearRows as { id: number; name: string }[]).map((y) => [y.id, y.name]));
  const result = new Map<string, string>();
  for (const [userId, yearId] of yearIdByUserId) {
    const name = nameByYearId.get(yearId);
    if (name) result.set(userId, name);
  }
  return result;
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

  // last_read_at feeds the "Vu" receipts; tolerated when the live database predates its migration.
  const runQuery = (columns: string) => {
    let query = supabase.from("chat_members").select(columns).eq("group_id", groupId);
    if (!isAdmin) query = query.eq("status", "accepted");
    return query.order("joined_at", { ascending: true });
  };
  let { data, error } = await runQuery("id, group_id, user_id, status, display_name, joined_at, last_read_at");
  if (isMissingColumnError(error)) ({ data, error } = await runQuery("id, group_id, user_id, status, display_name, joined_at"));
  if (error) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ChatMemberRow[];
  const yearByUserId = await academicYearNamesByUserId(supabase, rows.map((r) => r.user_id));

  return NextResponse.json({
    success: true,
    members: rows.map((row) => toMember(row, yearByUserId.get(row.user_id) ?? null)),
    isAdmin,
  });
}
