import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { isAllowedReactionEmoji } from "@/lib/group-chat-reactions";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { WRITE_CONFLICT, WRITE_CONFLICT_MESSAGE, retryOnWriteConflict, updateIfUnchanged } from "@/lib/supabase/compare-and-set";
import type { MessageReactions } from "@/types/group-chat";

export const runtime = "nodejs";

/**
 * POST — toggles the calling user's reaction on one message. Body: { emoji }.
 * Read-modify-write on the `reactions` jsonb column, made race-safe by a
 * compare-and-set (lib/supabase/compare-and-set.ts): two students reacting to
 * the same message at the same instant — any emoji, since the whole map is
 * rewritten — used to erase one of the two reactions. A very large map
 * (beyond what a URL can compare) is still written without the check.
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

  const outcome = await retryOnWriteConflict(async () => {
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

    const written = await updateIfUnchanged<{ reactions: MessageReactions | null }>(
      supabase.from("chat_messages").update({ reactions: nextReactions }).eq("id", messageId),
      "reactions",
      existing.reactions,
      "jsonb",
      "reactions"
    );
    if (written === WRITE_CONFLICT) return WRITE_CONFLICT;

    const updated = written.rows?.[0];
    if (written.error || !updated) {
      return NextResponse.json({ success: false, error: `La réaction a échoué : ${written.error?.message ?? "raison inconnue"}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, reactions: updated.reactions ?? {} });
  });

  if (outcome === WRITE_CONFLICT) {
    return NextResponse.json({ success: false, error: WRITE_CONFLICT_MESSAGE }, { status: 409 });
  }
  return outcome;
}
