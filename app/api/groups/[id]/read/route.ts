import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember, isMissingColumnError } from "@/lib/group-chat";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST — bumps the caller's chat_members.last_read_at to now() for this
 * group. Called once when ChatRoom mounts, so the groups lobby list's
 * unread count (computed in GET /api/groups) reflects "read" the next time
 * it's fetched. No body, no response payload beyond success — this is a
 * fire-and-forget mark-as-read, not something the caller branches on.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`group-read:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques instants." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const groupId = params.id;
  if (!groupId) {
    return NextResponse.json({ success: false, error: "Identifiant de groupe invalide." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  const { error } = await supabase
    .from("chat_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("user_id", user.id);

  // Database without the last_read_at migration: nothing to record — not an error for the chat room.
  if (isMissingColumnError(error)) return NextResponse.json({ success: true, tracked: false });
  if (error) {
    return NextResponse.json({ success: false, error: `Mise à jour échouée : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
