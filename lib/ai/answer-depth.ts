/**
 * DYNAMIC SYSTEM PROMPTS — product order 2026-11-09. Each Copilot request is
 * sent with the persona that fits the model answering it
 * (lib/ai/omni-routing.ts):
 *  - "detailed": the free models (PRIMARY_FREE_OMNI and the free chain). No
 *    length limit — the app's default brevity rules are left out and
 *    FREE_MODEL_DEPTH_DIRECTIVE is added, to use their large output budget.
 *  - "concise": a paid fallback (CHAT_MODEL, ECONOMY_MODEL). The concise
 *    persona with its length target, plus the short-answer note
 *    (withPaidFallbackBrevity) under a 500-token ceiling.
 * A format the student chose (Synthèse express, QCM, flashcards, a style) is
 * an explicit request and keeps its own instructions under both.
 */
export type AnswerDepth = "detailed" | "concise";

/** Injected verbatim (product order 2026-11-09) into the persona of every free-model request. */
export const FREE_MODEL_DEPTH_DIRECTIVE =
  "You must provide extremely detailed, exhaustive, and highly precise academic and clinical explanations. Go into deep, granular detail. Provide comprehensive breakdowns. Do not summarize unless explicitly asked. Use your maximum output capacity to explain the concepts thoroughly.";

/**
 * Right after the (English) directive in a French persona: it sets the depth,
 * never the language — the strict language mirror (French, Arabic, darija,
 * English as the student writes) must not drift to English because of it.
 */
export const DEPTH_DIRECTIVE_LANGUAGE_NOTE =
  "(Cette consigne règle la profondeur de la réponse, jamais sa langue : le miroir de langue ci-dessus reste strict.)";
