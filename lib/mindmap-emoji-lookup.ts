/**
 * Resolves the same kebab-case icon-name vocabulary the Mind Map prompt is
 * constrained to (see lib/ai/studio-prompts.ts's STUDIO_MIND_MAP_SYSTEM_PROMPT
 * icon list) to a colored emoji "sticker" instead of a Lucide line icon —
 * scoped to DynamicMindMapStudio.tsx only. Deliberately a SEPARATE map from
 * lib/lucide-icon-lookup.ts, which GastriteCasCliniqueStudio (a locked,
 * unrelated component) also depends on — this file must never be imported
 * there, and lucide-icon-lookup.ts must never be edited for this feature.
 */
const MINDMAP_EMOJI_LOOKUP: Record<string, string> = {
  shield: "🛡️",
  bug: "🦠",
  pill: "💊",
  flame: "🔥",
  stethoscope: "🩺",
  activity: "📈",
  "alert-triangle": "⚠️",
  "bar-chart-3": "📊",
  "check-circle-2": "✅",
  wind: "🌬️",
  zap: "⚡",
  "heart-pulse": "💓",
  brain: "🧠",
  thermometer: "🌡️",
  syringe: "💉",
  microscope: "🔬",
  ear: "👂",
  eye: "👁️",
  droplet: "💧",
  clock: "⏰",
  skull: "💀",
  waves: "🌊",
  baby: "👶",
  bone: "🦴",
  "test-tube": "🧪",
  siren: "🚨",
  "scan-line": "🩻",
  "heart-crack": "💔",
  "shield-alert": "🛑",
  hourglass: "⏳",
};

export function resolveMindMapEmoji(name: string): string {
  return MINDMAP_EMOJI_LOOKUP[name] ?? "🩺";
}

/** Deterministic tiny tilt per node id — never Math.random() (would mismatch between server/client render and re-roll on every zoom/pan re-render). */
export function stickerTilt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 13) - 6; // -6..+6 degrees
}
