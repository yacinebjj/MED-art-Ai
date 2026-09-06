import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import type { MyChatGroup } from "@/types/group-chat";

export const runtime = "nodejs";

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids visually-ambiguous codes read aloud/copied by hand.
const JOIN_CODE_LENGTH = 6;
const MAX_JOIN_CODE_ATTEMPTS = 5;

function generateJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    code += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return code;
}

interface ChatGroupRow {
  id: string;
  name: string;
  admin_id: string;
  join_code: string;
  created_at: string;
  pinned_message_id: string | null;
}

interface MemberWithGroupRow {
  status: "pending" | "accepted";
  chat_groups: ChatGroupRow | null;
}

/** GET — every group the student administers or belongs to (any status), with a live pending-request count for the ones they admin. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data: memberRows, error } = await supabase
    .from("chat_members")
    .select("status, chat_groups(id, name, admin_id, join_code, created_at, pinned_message_id)")
    .eq("user_id", user.id);

  if (error) {
    console.error("[groups:list] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const rows = (memberRows ?? []) as unknown as MemberWithGroupRow[];
  const adminGroupIds = rows.filter((r) => r.chat_groups?.admin_id === user.id).map((r) => r.chat_groups!.id);

  const pendingCounts = new Map<string, number>();
  if (adminGroupIds.length > 0) {
    const { data: pendingRows, error: pendingError } = await supabase
      .from("chat_members")
      .select("group_id")
      .in("group_id", adminGroupIds)
      .eq("status", "pending");

    if (pendingError) {
      console.error("[groups:list] Échec lecture des demandes en attente:", pendingError);
    } else {
      for (const row of (pendingRows ?? []) as { group_id: string }[]) {
        pendingCounts.set(row.group_id, (pendingCounts.get(row.group_id) ?? 0) + 1);
      }
    }
  }

  const groups: MyChatGroup[] = rows
    .filter((r): r is MemberWithGroupRow & { chat_groups: ChatGroupRow } => r.chat_groups !== null)
    .map((r) => ({
      id: r.chat_groups.id,
      name: r.chat_groups.name,
      adminId: r.chat_groups.admin_id,
      joinCode: r.chat_groups.join_code,
      createdAt: r.chat_groups.created_at,
      myStatus: r.status,
      isAdmin: r.chat_groups.admin_id === user.id,
      pendingCount: pendingCounts.get(r.chat_groups.id) ?? 0,
      pinnedMessageId: r.chat_groups.pinned_message_id ?? null,
    }));

  return NextResponse.json({ success: true, groups });
}

/** POST — creates a group. Body: { name: string }. The creator becomes admin AND is immediately its own 'accepted' member. */
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Tu dois être connecté(e)." }, { status: 401 });
  }

  const rl = rateLimit(`groups-create:${user.id}`, RATE_LIMITS.mutation);
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

  const { name } = (body ?? {}) as { name?: unknown };
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, error: "Le nom du groupe est requis." }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ success: false, error: "Supabase n'est pas configuré sur le serveur." }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const displayName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

  let group: ChatGroupRow | null = null;
  for (let attempt = 1; attempt <= MAX_JOIN_CODE_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from("chat_groups")
      .insert({ name: sanitizeForPostgres(name.trim()), admin_id: user.id, join_code: generateJoinCode() })
      .select("id, name, admin_id, join_code, created_at, pinned_message_id")
      .single();

    if (!error) {
      group = data as ChatGroupRow;
      break;
    }
    // Postgres unique_violation — a join_code collision. Vanishingly rare at
    // this alphabet/length, but retried rather than trusted blind.
    if (error.code !== "23505") {
      console.error("[groups:create] Échec insertion Supabase:", error);
      return NextResponse.json({ success: false, error: "La création du groupe a échoué. Réessaie." }, { status: 500 });
    }
  }

  if (!group) {
    return NextResponse.json({ success: false, error: "Impossible de générer un code d'invitation unique. Réessaie." }, { status: 500 });
  }

  const { error: memberError } = await supabase
    .from("chat_members")
    .insert({ group_id: group.id, user_id: user.id, status: "accepted", display_name: displayName });

  if (memberError) {
    console.error("[groups:create] Échec insertion de l'admin comme membre:", memberError);
    // The group row exists but its creator isn't a member yet — surfaced as
    // a failure rather than silently leaving an orphaned, unusable group.
    await supabase.from("chat_groups").delete().eq("id", group.id);
    return NextResponse.json({ success: false, error: "La création du groupe a échoué. Réessaie." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    group: {
      id: group.id,
      name: group.name,
      adminId: group.admin_id,
      joinCode: group.join_code,
      createdAt: group.created_at,
      myStatus: "accepted" as const,
      isAdmin: true,
      pendingCount: 0,
      pinnedMessageId: null,
    } satisfies MyChatGroup,
  });
}
