import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * PATCH — pins (or, with messageId: null, unpins) one message for the whole
 * group. One pin per group, deliberately simple for a first version — see
 * supabase/schema.sql's own migration comment. Open to any ACCEPTED member,
 * not admin-only: a shared cas clinique/QCM anchor is a collaborative
 * revision tool, matching the same permission level as sending a message,
 * not a moderation action like accepting/rejecting a join request.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`group-pin:${user.id}`, RATE_LIMITS.mutation);
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

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { messageId } = (body ?? {}) as { messageId?: unknown };
  if (messageId !== null && typeof messageId !== "string") {
    return NextResponse.json({ success: false, error: "'messageId' doit être une chaîne ou null." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  // Unpinning never needs the message-ownership check below — there's
  // nothing to validate about a message id that's about to stop being
  // referenced.
  if (messageId !== null) {
    const { data: message, error: messageError } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("id", messageId)
      .eq("group_id", groupId)
      .maybeSingle();

    if (messageError) {
      return NextResponse.json({ success: false, error: `Lecture échouée : ${messageError.message}` }, { status: 500 });
    }
    if (!message) {
      return NextResponse.json({ success: false, error: "Message introuvable dans ce groupe." }, { status: 404 });
    }
  }

  const { error: updateError } = await supabase.from("chat_groups").update({ pinned_message_id: messageId }).eq("id", groupId);
  if (updateError) {
    return NextResponse.json({ success: false, error: `L'épinglage a échoué : ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, pinnedMessageId: messageId });
}
