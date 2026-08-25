import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** POST — Body: { joinCode: string }. Creates a 'pending' membership row awaiting the group admin's approval. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`groups-join:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` }, { status: 400 });
  }

  const { joinCode } = (body ?? {}) as { joinCode?: unknown };
  if (typeof joinCode !== "string" || !joinCode.trim()) {
    return NextResponse.json({ success: false, error: "Le code d'invitation est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();

  const { data: group, error: groupError } = await supabase
    .from("chat_groups")
    .select("id, name")
    .eq("join_code", joinCode.trim().toUpperCase())
    .maybeSingle();

  if (groupError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${groupError.message}` }, { status: 500 });
  }
  if (!group) {
    return NextResponse.json({ success: false, error: "Aucun groupe ne correspond à ce code." }, { status: 404 });
  }

  const { data: existing, error: existingError } = await supabase
    .from("chat_members")
    .select("id, status")
    .eq("group_id", group.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${existingError.message}` }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({
      success: false,
      error: existing.status === "pending" ? "Ta demande pour ce groupe est déjà en attente." : "Tu es déjà membre de ce groupe.",
    }, { status: 409 });
  }

  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
  const { error: insertError } = await supabase
    .from("chat_members")
    .insert({ group_id: group.id, user_id: user.id, status: "pending", display_name: displayName });

  if (insertError) {
    console.error("[groups/join] Échec insertion Supabase:", insertError);
    return NextResponse.json({ success: false, error: "La demande n'a pas pu être envoyée. Réessaie." }, { status: 500 });
  }

  return NextResponse.json({ success: true, groupName: group.name });
}
