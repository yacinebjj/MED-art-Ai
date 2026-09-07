import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

async function assertIsAdmin(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  groupId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { data: group, error } = await supabase.from("chat_groups").select("admin_id").eq("id", groupId).maybeSingle();
  if (error) {
    return { ok: false, response: NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 }) };
  }
  if (!group) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Groupe introuvable." }, { status: 404 }) };
  }
  if (group.admin_id !== userId) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Seul l'administrateur du groupe peut faire ça." }, { status: 403 }) };
  }
  return { ok: true };
}

/** PATCH — accepts a pending member. Body: { status: "accepted" }. Admin-only, enforced server-side (mirrors the RLS UPDATE policy on chat_members). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string; memberId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`groups-member-update:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const groupId = params.id;
  const memberId = params.memberId;
  if (!groupId || !memberId) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { status } = (body ?? {}) as { status?: unknown };
  if (status !== "accepted") {
    return NextResponse.json({ success: false, error: "'status' doit être 'accepted'." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const adminCheck = await assertIsAdmin(supabase, groupId, user.id);
  if (!adminCheck.ok) return adminCheck.response;

  const { error, count } = await supabase
    .from("chat_members")
    .update({ status: "accepted" }, { count: "exact" })
    .eq("id", memberId)
    .eq("group_id", groupId);

  if (error) {
    console.error("[groups/members:accept] Échec update Supabase:", error);
    return NextResponse.json({ success: false, error: `Mise à jour échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Membre introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

/** DELETE — rejects a pending request, or removes an accepted member. Admin-only. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string; memberId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const groupId = params.id;
  const memberId = params.memberId;
  if (!groupId || !memberId) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const adminCheck = await assertIsAdmin(supabase, groupId, user.id);
  if (!adminCheck.ok) return adminCheck.response;

  const { data: target, error: targetError } = await supabase.from("chat_members").select("user_id").eq("id", memberId).eq("group_id", groupId).maybeSingle();
  if (targetError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${targetError.message}` }, { status: 500 });
  }
  if (target?.user_id === user.id) {
    return NextResponse.json({ success: false, error: "Tu ne peux pas te retirer toi-même en tant qu'administrateur." }, { status: 400 });
  }

  const { error, count } = await supabase.from("chat_members").delete({ count: "exact" }).eq("id", memberId).eq("group_id", groupId);

  if (error) {
    return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: false, error: "Membre introuvable." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
