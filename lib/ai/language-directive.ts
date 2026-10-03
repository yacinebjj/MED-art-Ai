/**
 * Server-side half of the global AI-content language (store/useLanguageStore.ts
 * on the client). Every Studio / Lab / flashcard route reads `language` from
 * its request body through parseContentLanguage and appends
 * buildLanguageDirective to its system prompt.
 *
 * Kept in English on purpose: it overrides prompts that are themselves
 * written in French, and must read as a hard rule, not as more French prose.
 */

export type ContentLanguage = "fr" | "en";

/** Anything other than an explicit "en" is French — the platform default, and what every existing cache entry was generated in. */
export function parseContentLanguage(value: unknown): ContentLanguage {
  return value === "en" ? "en" : "fr";
}

export function buildLanguageDirective(language: ContentLanguage): string {
  const name = language === "en" ? "English" : "French";
  return [
    "",
    "",
    `CRITICAL INSTRUCTION: The user has selected '${name}' as their preferred language. You MUST generate your ENTIRE response (explanations, QCMs, virtual patient dialogues, clinical cases, mental maps, summaries) EXCLUSIVELY in ${name}. Do not use any other language under any circumstances.`,
    "This applies to every human-readable text value. JSON keys, enum values and the exact output format required above stay EXACTLY as specified — only the natural-language content follows this rule.",
  ].join("\n");
}
