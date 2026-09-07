import { NextResponse } from "next/server";
import type { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Shared "is this user an accepted member of this group" gate — every group
 * chat route that reads/writes chat_messages or serves group details needs
 * exactly this check, done here once instead of duplicated per route file.
 * Mirrors (and is the actual enforcement for, since these routes use the
 * service-role client) the RLS policy on chat_messages/chat_members.
 */
export async function assertAcceptedMember(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  groupId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const { data, error } = await supabase
    .from("chat_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, response: NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 }) };
  }
  if (!data || data.status !== "accepted") {
    return { ok: false, response: NextResponse.json({ success: false, error: "Tu n'es pas membre accepté(e) de ce groupe." }, { status: 403 }) };
  }
  return { ok: true };
}
