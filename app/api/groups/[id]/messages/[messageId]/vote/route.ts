import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { assertAcceptedMember } from "@/lib/group-chat";
import { applyPollVote, decodeEnvelope } from "@/lib/group-chat-envelope";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { MessageReactions } from "@/types/group-chat";

export const runtime = "nodejs";

/**
 * POST — votes on a poll message (toggle; a single-choice poll moves the
 * vote). Body: { optionId }. Votes are stored in the message's `reactions`
 * jsonb under "poll:<optionId>" keys (lib/group-chat-envelope.ts), so every
 * member's screen updates through the existing realtime UPDATE subscription.
 * Same read-modify-write tradeoff as the reactions route.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string; messageId: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`group-vote:${user.id}`, RATE_LIMITS.mutation);
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
  const { optionId } = (body ?? {}) as { optionId?: unknown };
  if (typeof optionId !== "string" || !optionId) {
    return NextResponse.json({ success: false, error: "'optionId' est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const memberCheck = await assertAcceptedMember(supabase, groupId, user.id);
  if (!memberCheck.ok) return memberCheck.response;

  const { data: existing, error: readError } = await supabase
    .from("chat_messages")
    .select("id, group_id, content_text, reactions")
    .eq("id", messageId)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${readError.message}` }, { status: 500 });
  }
  if (!existing || existing.group_id !== groupId) {
    return NextResponse.json({ success: false, error: "Message introuvable." }, { status: 404 });
  }

  const poll = decodeEnvelope(existing.content_text).poll;
  if (!poll) {
    return NextResponse.json({ success: false, error: "Ce message n'est pas un sondage." }, { status: 400 });
  }
  if (!poll.options.some((option) => option.id === optionId)) {
    return NextResponse.json({ success: false, error: "Choix inconnu." }, { status: 400 });
  }

  const nextReactions = applyPollVote((existing.reactions as MessageReactions | null) ?? {}, poll, optionId, user.id);

  const { data: updated, error: updateError } = await supabase
    .from("chat_messages")
    .update({ reactions: nextReactions })
    .eq("id", messageId)
    .select("reactions")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ success: false, error: `Le vote a échoué : ${updateError?.message ?? "raison inconnue"}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, reactions: (updated.reactions as MessageReactions | null) ?? {} });
}
