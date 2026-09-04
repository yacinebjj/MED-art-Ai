/**
 * Group chat bubble themes — purely a client-side display preference
 * (persisted to localStorage via hooks/useChatTheme.ts), never sent to the
 * server. Only ever styles the CURRENT USER's own sent bubbles — the other
 * participants' bubbles stay a neutral, theme-independent color, same as
 * real chat apps scope a "chat theme" to your own side of the conversation.
 */
export interface ChatTheme {
  id: string;
  name: string;
  /** Tailwind classes for the sent-bubble background. */
  bubble: string;
  /** Small solid/gradient swatch shown in the theme picker. */
  swatch: string;
  /** Accent color (for the audio player's progress bar etc.) when rendered on MY OWN bubble. */
  accent: string;
  /** True for a light/white bubble background (needs dark controls/text for contrast) — every other theme is a colored/dark gradient (needs white controls/text). Read by AudioPlayer via MessageBubble's onColoredBubble prop, since AudioPlayer itself never receives the theme object. Omitted (falsy) for every colored theme — only the light one needs to opt in. */
  isLight?: boolean;
}

export const CHAT_THEMES: ChatTheme[] = [
  {
    id: "classic",
    name: "Blanc Classique",
    // Was bg-white/text-gray-900 with zero dark: variant — same bug already
    // fixed on the MedArt Assistant's own user bubble (see
    // app/dashboard/(shell)/assistant/page.tsx): a stark opaque white box in
    // dark mode instead of blending with the rest of the app's theme-token
    // surfaces. bg-card/text-card-foreground track light/dark automatically
    // (app/globals.css's CSS vars); `isLight` below still governs
    // AudioPlayer's own dark-controls-on-light-bubble contrast logic,
    // unrelated to this fix.
    bubble: "border border-border bg-card text-card-foreground shadow-sm",
    swatch: "border border-gray-300 bg-white",
    accent: "bg-primary-500",
    isLight: true,
  },
  {
    id: "medart",
    name: "MedArt Signature",
    bubble: "bg-gradient-to-br from-emerald-500 to-teal-600 text-white",
    swatch: "bg-gradient-to-br from-emerald-500 to-teal-600",
    accent: "bg-white",
  },
  {
    id: "messenger",
    name: "Messenger Glow",
    bubble: "bg-gradient-to-br from-blue-500 to-violet-600 text-white",
    swatch: "bg-gradient-to-br from-blue-500 to-violet-600",
    accent: "bg-white",
  },
  {
    id: "midnight",
    name: "Midnight Rose",
    bubble: "bg-gradient-to-br from-rose-600 to-neutral-900 text-white",
    swatch: "bg-gradient-to-br from-rose-600 to-neutral-900",
    accent: "bg-white",
  },
  {
    id: "imessage",
    name: "iMessage Classic",
    bubble: "bg-blue-500 text-white",
    swatch: "bg-blue-500",
    accent: "bg-white",
  },
];

export const DEFAULT_CHAT_THEME_ID = CHAT_THEMES[0].id;

export function getChatTheme(id: string | null): ChatTheme {
  return CHAT_THEMES.find((t) => t.id === id) ?? CHAT_THEMES[0];
}
