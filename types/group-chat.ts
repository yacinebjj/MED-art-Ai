/**
 * NEXUS — Group Chat. Backed by `chat_groups` / `chat_members` /
 * `chat_messages` (see supabase/schema.sql). `chat_messages` is Realtime-
 * enabled and is the one table in this app whose RLS is load-bearing, not
 * just defense-in-depth — see that table's schema comment.
 *
 * Every id below is a `uuid` (string), not a number — matches this schema's
 * own dominant convention (most tables use `uuid default gen_random_uuid()`;
 * bigint identity, which these types originally and wrongly assumed, is the
 * minority pattern here). Treat ids as opaque strings everywhere, never
 * `Number()`-parsed.
 */

export type ChatMemberStatus = "pending" | "accepted";

export interface ChatGroup {
  id: string;
  name: string;
  adminId: string;
  joinCode: string;
  createdAt: string;
  /** One pin per group — see supabase/schema.sql's own migration comment. Null when nothing is pinned. */
  pinnedMessageId: string | null;
}

export interface ChatMember {
  id: string;
  groupId: string;
  userId: string;
  status: ChatMemberStatus;
  /** Snapshotted display name — see chat_members.display_name's own schema comment. */
  displayName: string | null;
  joinedAt: string;
  /** When this member last had the chat open (chat_members.last_read_at) — drives "Vu" receipts. Null when unknown or when the column isn't migrated yet. */
  lastReadAt: string | null;
  /** Real curriculum year (e.g. "4ème Année Médecine"), joined server-side from profiles.academic_year_id -> curriculum_academic_years.name — see app/api/groups/[id]/members/route.ts. Null when the member hasn't set their year in Paramètres. There is no "Professeur"/role concept anywhere in this schema — never invent one. */
  academicYearName: string | null;
}

/** One row of "my groups" — the group plus MY OWN membership status/role in it, for the lobby list. */
export interface MyChatGroup extends ChatGroup {
  myStatus: ChatMemberStatus;
  isAdmin: boolean;
  pendingCount: number;
  /** Null when the group has no messages yet. */
  lastMessage: { preview: string; createdAt: string } | null;
  /** Messages from OTHER members created after my last_read_at — see supabase/schema.sql's chat_members.last_read_at migration comment. Always 0 while myStatus is "pending" (RLS blocks reading messages until accepted). */
  unreadCount: number;
}

export type ChatMessageType = "text" | "image" | "video" | "audio";

/** Emoji -> array of user ids who reacted with it — see supabase/schema.sql's own migration comment on chat_messages.reactions. */
export type MessageReactions = Record<string, string[]>;

export interface ChatMessage {
  id: string;
  groupId: string;
  userId: string;
  type: ChatMessageType;
  contentText: string | null;
  mediaUrl: string | null;
  /** Snapshotted display name — see chat_messages.sender_name's own schema comment. */
  senderName: string | null;
  createdAt: string;
  reactions: MessageReactions;
}
