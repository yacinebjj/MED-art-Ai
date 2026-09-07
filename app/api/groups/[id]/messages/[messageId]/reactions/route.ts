import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { isAllowedReactionEmoji } from "@/lib/group-chat-reactions";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { MessageReactions } from "@/types/group-chat";

export const runtime = "nodejs";

/**
 * POST — toggles the calling user's reaction on one message. Body: { emoji }.
 * Read-modify-write on the `reactions` jsonb column (not a single atomic SQL
 * update) — a known, accepted tradeoff for a purely cosmetic feature: two
 * students tapping the SAME emoji on the SAME message in the same instant
 * could rarely clobber each other's toggle. Worth a stored procedure if this
 * ever needs to be airtight; not worth the extra schema surface for a quick
 * reaction. Real membership/moderation-relevant writes in this app (message
 * sends, member status) don't have this shape of race.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string; messageId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`group-reaction:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques instants." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  const { id: groupId, messageId } = params;
  if (!groupId || !messageId) {
    return NextResponse.json({ success: false, error: "Identifiant invalide." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { emoji } = (body ?? {}) as { emoji?: unknown };
  if (typeof emoji !== "string" || !isAllowedReactionEmoji(emoji)) {
    return NextResponse.json({ success: false, error: "Réaction non supportée." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  const { data: existing, error: readError } = await supabase
    .from("chat_messages")
    .select("id, group_id, reactions")
    .eq("id", messageId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${readError.message}` }, { status: 500 });
  }
  // Scoped to THIS group, not just "does the message id exist anywhere" —
  // a message id from a DIFFERENT group (one this user may not even be a
  // member of) must never be reachable through this route.
  if (!existing || existing.group_id !== groupId) {
    return NextResponse.json({ success: false, error: "Message introuvable." }, { status: 404 });
  }

  const reactions: MessageReactions = (existing.reactions as MessageReactions | null) ?? {};
  const current = reactions[emoji] ?? [];
  const alreadyReacted = current.includes(user.id);
  const nextForEmoji = alreadyReacted ? current.filter((id) => id !== user.id) : [...current, user.id];

  const nextReactions: MessageReactions = { ...reactions };
  if (nextForEmoji.length > 0) nextReactions[emoji] = nextForEmoji;
  else delete nextReactions[emoji]; // last person un-reacted — don't leave an empty array sitting in the map forever

  const { data: updated, error: updateError } = await supabase
    .from("chat_messages")
    .update({ reactions: nextReactions })
    .eq("id", messageId)
    .select("reactions")
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ success: false, error: `La réaction a échoué : ${updateError?.message ?? "raison inconnue"}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, reactions: (updated.reactions as MessageReactions | null) ?? {} });
}
