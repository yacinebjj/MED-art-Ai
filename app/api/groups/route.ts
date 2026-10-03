import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/supabase/session-server";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import { errorMessage, sanitizeForPostgres } from "@/lib/course-generation-shared";
import { RATE_LIMITS, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { isMissingColumnError } from "@/lib/group-chat";
import { previewText } from "@/lib/group-chat-envelope";
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
  /** Absent when the live database predates the last_read_at migration — see GET below. */
  last_read_at?: string | null;
  joined_at?: string | null;
  chat_groups: ChatGroupRow | null;
}

interface LastMessageRow {
  content_text: string | null;
  type: "text" | "image" | "video" | "audio";
  created_at: string;
}

const MEDIA_PREVIEW_LABEL: Record<Exclude<LastMessageRow["type"], "text">, string> = {
  image: "📷 Photo",
  video: "🎥 Vidéo",
  audio: "🎤 Message vocal",
};

const PREVIEW_MAX_LENGTH = 80;

/** Short, single-line preview text for the lobby list — media messages get a fixed emoji label (there's no caption to show), text messages their own content (rich envelopes — polls, documents, mentions — rendered readable by previewText), truncated to one line. */
function previewFor(row: LastMessageRow): string {
  if (row.type !== "text") return MEDIA_PREVIEW_LABEL[row.type];
  const text = previewText(row.content_text);
  if (text.length <= PREVIEW_MAX_LENGTH) return text;
  return `${text.slice(0, PREVIEW_MAX_LENGTH).trimEnd()}…`;
}

const GROUP_COLUMNS = "chat_groups(id, name, admin_id, join_code, created_at, pinned_message_id)";

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
  // Schema-tolerant read: chat_members.last_read_at only exists once its
  // migration has run (supabase/schema.sql). Without this fallback, a
  // database missing that one column made THIS whole route fail — the lobby
  // received nothing and every group looked deleted right after creation.
  // Unread counts are an enhancement; the list itself must never depend on them.
  let unreadSupported = true;
  const full = await supabase.from("chat_members").select(`status, last_read_at, joined_at, ${GROUP_COLUMNS}`).eq("user_id", user.id);
  let memberRows: unknown[] | null = full.data;
  let error = full.error;
  if (isMissingColumnError(error)) {
    unreadSupported = false;
    console.warn("[groups:list] chat_members.last_read_at absente — liste servie sans compteur de non-lus (migration à appliquer).");
    const reduced = await supabase.from("chat_members").select(`status, joined_at, ${GROUP_COLUMNS}`).eq("user_id", user.id);
    memberRows = reduced.data;
    error = reduced.error;
  }

  if (error) {
    console.error("[groups:list] Échec lecture Supabase:", error);
    return NextResponse.json({ success: false, error: `Lecture échouée : ${error.message}` }, { status: 500 });
  }

  const rows = (memberRows ?? []) as unknown as MemberWithGroupRow[];
  const adminGroupIds = rows.filter((r) => r.chat_groups?.admin_id === user.id).map((r) => r.chat_groups!.id);
  // Only accepted memberships can read chat_messages at all (see that
  // table's own SELECT policy) — computing last-message/unread for a
  // pending membership would just be a wasted query that RLS-equivalent
  // logic below would zero out anyway.
  const acceptedRows = rows.filter((r): r is MemberWithGroupRow & { chat_groups: ChatGroupRow } => r.chat_groups !== null && r.status === "accepted");

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

  // Last message + unread count per group — a handful of groups per
  // student, so two small indexed queries per group (in parallel) stays
  // cheap and, unlike a denormalized counter, never needs a trigger to stay
  // in sync with deletes/edits. See supabase/schema.sql's last_read_at
  // migration comment for why this isn't computed in a single batched call.
  const lastMessages = new Map<string, { preview: string; createdAt: string } | null>();
  const unreadCounts = new Map<string, number>();

  await Promise.all(
    acceptedRows.map(async (r) => {
      const groupId = r.chat_groups.id;

      const lastReadAt = unreadSupported ? r.last_read_at ?? null : null;
      const [lastMessageResult, unreadResult] = await Promise.all([
        supabase
          .from("chat_messages")
          .select("content_text, type, created_at")
          .eq("group_id", groupId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        lastReadAt
          ? supabase
              .from("chat_messages")
              .select("id", { count: "exact", head: true })
              .eq("group_id", groupId)
              .neq("user_id", user.id)
              .gt("created_at", lastReadAt)
          : Promise.resolve({ count: 0, error: null }),
      ]);

      if (lastMessageResult.error) {
        console.error("[groups:list] Échec lecture du dernier message:", lastMessageResult.error);
      } else if (lastMessageResult.data) {
        const row = lastMessageResult.data as LastMessageRow;
        lastMessages.set(groupId, { preview: previewFor(row), createdAt: row.created_at });
      } else {
        lastMessages.set(groupId, null);
      }

      if (unreadResult.error) {
        console.error("[groups:list] Échec comptage des messages non lus:", unreadResult.error);
      } else {
        unreadCounts.set(groupId, unreadResult.count ?? 0);
      }
    })
  );

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
      lastMessage: lastMessages.get(r.chat_groups.id) ?? null,
      unreadCount: unreadCounts.get(r.chat_groups.id) ?? 0,
    }))
    // Most recent activity first (last message, else creation).
    .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));

  return NextResponse.json({ success: true, groups, unreadSupported });
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
      lastMessage: null,
      unreadCount: 0,
    } satisfies MyChatGroup,
  });
}
