/**
 * Hybrid model router for the course chat (app/api/courses/chat/route.ts) —
 * a standard, single-excerpt question ("explique-moi ce paragraphe du
 * cours") goes to ECONOMY_MODEL (cheaper); anything with a real signal of
 * clinical complexity goes to HAIKU_MODEL (Anthropic, stronger).
 *
 * DELIBERATELY biased toward escalating to HAIKU_MODEL on any doubt, never
 * the reverse — this is a medical education platform, and the cost of
 * under-routing a genuinely complex question to a weaker model (a subtly
 * wrong clinical answer) is categorically worse than the cost of
 * over-routing a simple one to the stronger model (one avoidably-more-
 * expensive call). Because of that bias, the economy tier only ever serves
 * the CONFIDENTLY-simple slice of traffic — this router does not, and is
 * not meant to, route 100% of volume to the cheap model.
 *
 * Keyword/length-based, not a model-driven classifier: an LLM call to
 * classify the LLM call would add its own latency and cost, working against
 * the very thing this exists to cut. Same "approximate, not exhaustive"
 * character as lib/chat-context-retrieval.ts's own BROAD_QUESTION_PATTERN —
 * tune from real production near-miss cases, not from theory.
 */

import { ECONOMY_MODEL, HAIKU_MODEL } from "@/lib/ai/openrouter";
import { isBroadQuestion } from "@/lib/chat-context-retrieval";

// A real clinical-vignette / decision-making question ("cas clinique",
// "conduite à tenir", dosage/contre-indication questions...) needs the
// stronger model's judgment far more than "explain this paragraph" does —
// getting a dosage or a differential subtly wrong is a materially different
// risk than a slightly less polished conceptual explanation.
const COMPLEX_SIGNAL_PATTERN =
  /cas clinique|diagnostic diff[ée]rentiel|prise en charge|conduite [àa] tenir|protocole|posologie|interaction m[ée]dicamenteuse|ant[ée]c[ée]dents|score de |classification de |contre-indication|effet ind[ée]sirable|surdosage|overdose|dose|mg\/kg/i;

// A short, single-paragraph "explain this excerpt" question is exactly the
// economy tier's target case. Past this length, a message is more likely a
// multi-part or vignette-style question that benefits from the stronger
// model — same reasoning as MAX_HIGHLIGHT_CHARS existing at all.
const MAX_SIMPLE_MESSAGE_CHARS = 500;

/**
 * Returns the OpenRouter model id this message should be generated with.
 * `isBroad` should be the SAME broad-question signal already used to widen
 * RAG retrieval (lib/chat-context-retrieval.ts's isBroadQuestion) — a
 * "résumé de tout le cours" question is synthesizing across more chunks and
 * warrants the stronger model for the same reason.
 */
export function resolveChatModel(text: string, isBroad: boolean): string {
  if (isBroad) return HAIKU_MODEL;
  if (text.length > MAX_SIMPLE_MESSAGE_CHARS) return HAIKU_MODEL;
  if (COMPLEX_SIGNAL_PATTERN.test(text)) return HAIKU_MODEL;
  const questionMarkCount = (text.match(/\?/g) ?? []).length;
  if (questionMarkCount > 1) return HAIKU_MODEL; // multi-part question — treat like a vignette, not a quick lookup.
  return ECONOMY_MODEL;
}

/** True only when `model` is an Anthropic model — Anthropic's `cache_control: { type: "ephemeral" }` prompt-caching breakpoint is Anthropic-specific; sending it to a non-Anthropic provider via OpenRouter has no documented, verified behavior, so callers must gate on this before tagging a content block. */
export function supportsAnthropicPromptCaching(model: string): boolean {
  return model.startsWith("anthropic/");
}

/** True only when `model` is ECONOMY_MODEL — callers use this to apply that model's specific reasoning-token cap and wider output ceiling (see app/api/courses/chat/route.ts's MAX_OUTPUT_TOKENS_ECONOMY). */
export function isEconomyModel(model: string): boolean {
  return model === ECONOMY_MODEL;
}
