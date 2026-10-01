/**
 * Shared (client + server) identifiers for the MedArt Assistant's quick
 * actions and answer styles. Ids only — the actual instruction text lives in
 * lib/ai/assistant-prompts.ts and is applied SERVER-side from a whitelist, so
 * a client can never send its own free-form system instructions.
 */

export const ASSISTANT_MODES = ["clinical_case", "mcq", "differential", "summary", "simplify", "flashcards"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export const ASSISTANT_STYLES = ["academic", "simple", "patient"] as const;
export type AssistantStyle = (typeof ASSISTANT_STYLES)[number];

export function isAssistantMode(value: unknown): value is AssistantMode {
  return typeof value === "string" && (ASSISTANT_MODES as readonly string[]).includes(value);
}

export function isAssistantStyle(value: unknown): value is AssistantStyle {
  return typeof value === "string" && (ASSISTANT_STYLES as readonly string[]).includes(value);
}

export interface AssistantPrefs {
  style: AssistantStyle;
  stepByStep: boolean;
}

export const DEFAULT_ASSISTANT_PREFS: AssistantPrefs = { style: "academic", stepByStep: false };
