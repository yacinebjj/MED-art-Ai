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

/** One row of "my groups" — the group plus MY OWN membership status/role in it, for the lobby list. */
export interface MyChatGroup extends ChatGroup {
  myStatus: ChatMemberStatus;
  isAdmin: boolean;
  pendingCount: number;
}
