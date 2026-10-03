import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** GET — one group's basic info, plus the caller's own membership status (403s if they have no membership row at all). */
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

  const { data: group, error: groupError } = await supabase
    .from("chat_groups")
    .select("id, name, admin_id, join_code, created_at, pinned_message_id")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${groupError.message}` }, { status: 500 });
  }
  if (!group) {
    return NextResponse.json({ success: false, error: "Groupe introuvable." }, { status: 404 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("chat_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ success: false, error: `Lecture échouée : ${membershipError.message}` }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ success: false, error: "Tu n'es pas membre de ce groupe." }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    group: {
      id: group.id,
      name: group.name,
      adminId: group.admin_id,
      joinCode: group.join_code,
      createdAt: group.created_at,
      pinnedMessageId: group.pinned_message_id ?? null,
    },
    myStatus: membership.status,
  });
}

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_GROUP_NAME_CHARS = 80;

function newJoinCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join("");
}

/** Loads the group and checks the caller is its admin. */
async function requireAdmin(groupId: string, userId: string) {
  const supabase = getSupabaseAdmin();
  const { data: group, error } = await supabase.from("chat_groups").select("id, admin_id").eq("id", groupId).maybeSingle();
  if (error) return { supabase, response: NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 }) };
  if (!group) return { supabase, response: NextResponse.json({ success: false, error: "Groupe introuvable." }, { status: 404 }) };
  if (group.admin_id !== userId) {
    return { supabase, response: NextResponse.json({ success: false, error: "Seul l'administrateur du groupe peut faire ça." }, { status: 403 }) };
  }
  return { supabase, response: null };
}

/**
 * PATCH — admin settings. Body (any combination):
 *   { name?: string, regenerateJoinCode?: true, transferAdminTo?: userId }
 * transferAdminTo must be an ACCEPTED member; it is how an admin can later leave.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });

  const rl = rateLimit(`group-settings:${user.id}`, RATE_LIMITS.mutation);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes — réessaie dans quelques instants." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } }
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Corps de requête JSON invalide." }, { status: 400 });
  }
  const { name, regenerateJoinCode, transferAdminTo } = (body ?? {}) as { name?: unknown; regenerateJoinCode?: unknown; transferAdminTo?: unknown };

  const { supabase, response } = await requireAdmin(params.id, user.id);
  if (response) return response;

  const update: { name?: string; join_code?: string; admin_id?: string } = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > MAX_GROUP_NAME_CHARS) {
      return NextResponse.json({ success: false, error: `Le nom est requis (max ${MAX_GROUP_NAME_CHARS} caractères).` }, { status: 400 });
    }
    update.name = sanitizeForPostgres(name.trim());
  }
  if (regenerateJoinCode === true) update.join_code = newJoinCode();
  if (transferAdminTo !== undefined) {
    if (typeof transferAdminTo !== "string" || transferAdminTo === user.id) {
      return NextResponse.json({ success: false, error: "Nouvel administrateur invalide." }, { status: 400 });
    }
    const { data: target } = await supabase
      .from("chat_members")
      .select("status")
      .eq("group_id", params.id)
      .eq("user_id", transferAdminTo)
      .maybeSingle<{ status: string }>();
    if (target?.status !== "accepted") {
      return NextResponse.json({ success: false, error: "Le nouvel administrateur doit être un membre accepté du groupe." }, { status: 400 });
    }
    update.admin_id = transferAdminTo;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: "Aucune modification demandée." }, { status: 400 });
  }

  // A regenerated code can (very rarely) collide with another group's: retry with a fresh one.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("chat_groups")
      .update(update)
      .eq("id", params.id)
      .select("id, name, admin_id, join_code, created_at, pinned_message_id")
      .single();
    if (!error && data) {
      return NextResponse.json({
        success: true,
        group: {
          id: data.id,
          name: data.name,
          adminId: data.admin_id,
          joinCode: data.join_code,
          createdAt: data.created_at,
          pinnedMessageId: data.pinned_message_id ?? null,
        },
      });
    }
    if (error?.code !== "23505" || !update.join_code) {
      return NextResponse.json({ success: false, error: `Mise à jour échouée : ${error?.message ?? "raison inconnue"}` }, { status: 500 });
    }
    update.join_code = newJoinCode();
  }
  return NextResponse.json({ success: false, error: "Impossible de générer un nouveau code. Réessaie." }, { status: 500 });
}

/** DELETE — deletes the whole group (members and messages cascade). Admin-only. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }
  const { supabase, response } = await requireAdmin(params.id, user.id);
  if (response) return response;

  const { error } = await supabase.from("chat_groups").delete().eq("id", params.id);
  if (error) return NextResponse.json({ success: false, error: `Suppression échouée : ${error.message}` }, { status: 500 });
  return NextResponse.json({ success: true });
}
