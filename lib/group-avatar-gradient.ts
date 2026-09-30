// A few gradient pairs (same palette family as the app's other icon badges)
// cycled by a cheap string hash — purely cosmetic, gives each group (or
// group-chat header) a distinct identity color instead of every avatar
// looking identical. Shared between GroupCard.tsx (lobby list) and
// ChatRoom.tsx (chat header) so both render the SAME color for the same
// group id.
export const AVATAR_GRADIENTS = [
  "from-teal-500 to-cyan-500",
  "from-violet-500 to-fuchsia-500",
  "from-blue-500 to-indigo-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-emerald-500 to-teal-600",
];

export function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}
