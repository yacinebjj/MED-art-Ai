/**
 * Rich message envelope for group chat — replies, @mentions, polls and
 * document attachments, stored INSIDE chat_messages.content_text so they
 * work on the production schema as it is (no new column, no new table, no
 * migration to run before the feature exists).
 *
 * Format: ENVELOPE_PREFIX + JSON. A message whose content_text does not start
 * with the prefix is a plain text message (every message sent before this
 * existed), so old history keeps rendering exactly as before.
 *
 * Poll votes live in the message's existing `reactions` jsonb under reserved
 * "poll:<optionId>" keys — reusing its realtime UPDATE propagation for free.
 * Reaction UI must ignore those keys (see isPollVoteKey).
 */

export const ENVELOPE_PREFIX = "⁣medart:v1⁣";

export interface ReplyRef {
  id: string;
  senderName: string | null;
  /** Short plain-text excerpt of the quoted message, frozen at reply time. */
  excerpt: string;
}

export interface ChatAttachment {
  url: string;
  name: string;
  mime: string;
  size: number;
}

export interface PollOption {
  id: string;
  label: string;
}

export interface ChatPoll {
  question: string;
  options: PollOption[];
  /** true = several options may be chosen. */
  multi: boolean;
}

export interface MessageEnvelope {
  text: string;
  replyTo?: ReplyRef;
  /** User ids mentioned with @ (resolved and validated server-side against the group's members). */
  mentions?: string[];
  attachment?: ChatAttachment;
  poll?: ChatPoll;
}

export const MAX_POLL_OPTIONS = 8;
export const MAX_POLL_OPTION_CHARS = 80;
export const MAX_POLL_QUESTION_CHARS = 200;
export const REPLY_EXCERPT_CHARS = 140;

export function encodeEnvelope(envelope: MessageEnvelope): string {
  const hasExtras = Boolean(envelope.replyTo || envelope.attachment || envelope.poll || (envelope.mentions && envelope.mentions.length > 0));
  // A plain message stays plain text: readable by any client, any SQL query, any export.
  if (!hasExtras) return envelope.text;
  return ENVELOPE_PREFIX + JSON.stringify(envelope);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Never throws: anything malformed degrades to its raw text. */
export function decodeEnvelope(contentText: string | null | undefined): MessageEnvelope {
  const raw = contentText ?? "";
  if (!raw.startsWith(ENVELOPE_PREFIX)) return { text: raw };
  try {
    const parsed: unknown = JSON.parse(raw.slice(ENVELOPE_PREFIX.length));
    if (!isRecord(parsed)) return { text: "" };
    const envelope: MessageEnvelope = { text: typeof parsed.text === "string" ? parsed.text : "" };
    if (isRecord(parsed.replyTo) && typeof parsed.replyTo.id === "string") {
      envelope.replyTo = {
        id: parsed.replyTo.id,
        senderName: typeof parsed.replyTo.senderName === "string" ? parsed.replyTo.senderName : null,
        excerpt: typeof parsed.replyTo.excerpt === "string" ? parsed.replyTo.excerpt : "",
      };
    }
    if (Array.isArray(parsed.mentions)) envelope.mentions = parsed.mentions.filter((id): id is string => typeof id === "string");
    if (isRecord(parsed.attachment) && typeof parsed.attachment.url === "string") {
      envelope.attachment = {
        url: parsed.attachment.url,
        name: typeof parsed.attachment.name === "string" ? parsed.attachment.name : "Document",
        mime: typeof parsed.attachment.mime === "string" ? parsed.attachment.mime : "application/octet-stream",
        size: typeof parsed.attachment.size === "number" ? parsed.attachment.size : 0,
      };
    }
    if (isRecord(parsed.poll) && typeof parsed.poll.question === "string" && Array.isArray(parsed.poll.options)) {
      const options = parsed.poll.options
        .filter((o): o is { id: string; label: string } => isRecord(o) && typeof o.id === "string" && typeof o.label === "string")
        .slice(0, MAX_POLL_OPTIONS);
      if (options.length >= 2) envelope.poll = { question: parsed.poll.question, options, multi: parsed.poll.multi === true };
    }
    return envelope;
  } catch {
    return { text: "" };
  }
}

/** One-line preview for the lobby / pinned bar / reply quote. */
export function previewText(contentText: string | null | undefined): string {
  const envelope = decodeEnvelope(contentText);
  if (envelope.poll) return `📊 ${envelope.poll.question}`;
  if (envelope.attachment && !envelope.text.trim()) return `📄 ${envelope.attachment.name}`;
  return plainText(envelope.text);
}

/** Text without Markdown marks, with "@[Name](id)" mention tokens shown as "@Name". */
export function plainText(text: string): string {
  return text
    .replace(MENTION_PATTERN, "@$1")
    .replace(/[*_`>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(text: string, max = REPLY_EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Poll votes in the reactions map

const POLL_KEY_PREFIX = "poll:";

export function pollVoteKey(optionId: string): string {
  return `${POLL_KEY_PREFIX}${optionId}`;
}

export function isPollVoteKey(key: string): boolean {
  return key.startsWith(POLL_KEY_PREFIX);
}

/** Next reactions map after `userId` picks `optionId` (toggle; single-choice polls move the vote). */
export function applyPollVote(reactions: Record<string, string[]>, poll: ChatPoll, optionId: string, userId: string): Record<string, string[]> {
  const next: Record<string, string[]> = { ...reactions };
  const key = pollVoteKey(optionId);
  const alreadyVoted = (next[key] ?? []).includes(userId);
  if (!poll.multi) {
    for (const option of poll.options) {
      const k = pollVoteKey(option.id);
      if (next[k]) next[k] = next[k].filter((id) => id !== userId);
    }
  }
  const current = (next[key] ?? []).filter((id) => id !== userId);
  next[key] = alreadyVoted ? current : [...current, userId];
  for (const k of Object.keys(next)) if (next[k].length === 0) delete next[k];
  return next;
}

// ---------------------------------------------------------------------------
// Mentions

/** Mention token as typed in the composer and stored in the text: "@[Name](userId)". */
export const MENTION_PATTERN = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/gi;

export function extractMentionIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) ids.add(match[2].toLowerCase());
  return Array.from(ids);
}
