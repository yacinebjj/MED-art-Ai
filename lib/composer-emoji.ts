/**
 * Curated emoji set for the group-chat composer's emoji picker (inserts a
 * character into the message text itself — distinct from
 * lib/group-chat-reactions.ts's fixed 5-emoji QUICK_REACTIONS, which react
 * to an already-sent message). Deliberately a hand-picked ~150-emoji list
 * grouped by category, not a full Unicode CLDR set pulled in via an
 * emoji-mart/emoji-picker-react dependency — this is a study-group chat for
 * médecine/pharmacie/dentaire students, not a general-purpose messenger, so
 * "the common ones, well organized" beats "every emoji ever standardized,
 * needing search/virtualization to stay usable."
 */
export interface EmojiCategory {
  label: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: "Smileys",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊",
      "😇", "🥰", "😍", "🤩", "😘", "😋", "😜", "🤪", "😝", "🤗", "🤔", "🫡",
      "😐", "😑", "😶", "🙄", "😏", "😮", "😴", "🥱", "😷", "🤒", "🥵", "🥶",
    ],
  },
  {
    label: "Gestes",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤞", "🤝", "🙏", "👏", "🙌", "💪", "✋", "👋",
      "🤙", "👆", "👉", "☝️", "✍️", "🫰",
    ],
  },
  {
    label: "Cœurs",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💕", "💞", "💗",
      "💓", "💖", "💘", "💝", "❤️‍🔥",
    ],
  },
  {
    label: "Études",
    emojis: [
      "📚", "📖", "✏️", "📝", "🖊️", "📌", "📎", "🗂️", "🔬", "🧪", "🩺", "💊",
      "🧠", "🫀", "🦴", "💉", "🩻", "⚗️", "🧬", "🔎", "💡", "⏰", "☕", "🧑‍⚕️",
    ],
  },
  {
    label: "Célébration",
    emojis: [
      "🎉", "🎊", "🥳", "🏆", "🥇", "✅", "🔥", "⭐", "🌟", "💯", "🚀", "🙌",
    ],
  },
  {
    label: "Réactions",
    emojis: [
      "😢", "😭", "😩", "😤", "😡", "🥺", "😬", "😳", "🤯", "😱", "🤢", "🤮",
      "⚠️", "❗", "❓", "💀", "👀", "🫣",
    ],
  },
];
