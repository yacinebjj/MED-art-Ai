/**
 * Canonical quick-reaction set — shared by the API route (validates the
 * emoji is one of these before writing) and the client UI (renders exactly
 * these as quick-tap buttons), so the two can never drift out of sync.
 * Deliberately a small, fixed set rather than a full emoji picker: the brief
 * asked for a curated, med-student-relevant set ("D'accord", "À revoir",
 * "Cas important"), not a general-purpose reaction picker.
 */
export interface QuickReaction {
  emoji: string;
  label: string;
}

export const QUICK_REACTIONS: QuickReaction[] = [
  { emoji: "👍", label: "D'accord" },
  { emoji: "❤️", label: "Merci" },
  { emoji: "🔁", label: "À revoir" },
  { emoji: "⚠️", label: "Cas important" },
  { emoji: "😂", label: "Ahah" },
];

const ALLOWED_EMOJI = new Set(QUICK_REACTIONS.map((r) => r.emoji));

export function isAllowedReactionEmoji(value: string): boolean {
  return ALLOWED_EMOJI.has(value);
}
