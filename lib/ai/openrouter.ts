import { detectMockPayload } from "@/lib/ai/mock-data";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// "anthropic/claude-3.5-sonnet" was retired by OpenRouter (404s with
// "No endpoints found") — this is the current equivalent, confirmed live
// against GET https://openrouter.ai/api/v1/models.
const MODEL = "anthropic/claude-sonnet-5";

// Forced model for the chat's "highlight" quick actions (Ask MedArt /
// Translate on a text selection) and the Module Workspace's cross-course
// synthesis pass — see app/api/courses/chat/route.ts's isHighlightMode and
// app/api/workspace/module-synthesis/route.ts's buildCrossCourseSynthesis.
// "anthropic/claude-3.5-haiku" was retired by OpenRouter (404s with "No
// endpoints found for anthropic/claude-3.5-haiku") — same failure mode as
// MODEL above, same fix: re-verified live against
// GET https://openrouter.ai/api/v1/models, which confirmed
// "anthropic/claude-3.5-haiku" is absent and "anthropic/claude-haiku-4.5"
// is present. Re-verify the same way if this ever 404s again — OpenRouter
// does retire/rename slugs.
export const HAIKU_MODEL = "anthropic/claude-haiku-4.5";

// "Economy" tier for the course chat's hybrid model router (see
// lib/chat-model-routing.ts) — a standard, single-excerpt explanation is
// routed here instead of HAIKU_MODEL. The originally-requested
// "google/gemini-2.5-flash" no longer exists on OpenRouter (superseded by
// the 3.x generation) — confirmed live against
// GET https://openrouter.ai/api/v1/models AND the model's own OpenRouter
// page, same verification discipline as HAIKU_MODEL above.
// "google/gemini-3.7-flash" is real, live, $0.75/M input + $3.75/M output —
// cheaper than HAIKU_MODEL ($1/M + $5/M) but NOT an order of magnitude
// cheaper; there is no currently-real model priced near-zero at a quality
// bar fit for medical explanations. Re-verify the same way if this 404s.
export const ECONOMY_MODEL = "google/gemini-3.7-flash";

// Shared free-tier (":free" suffix) fallback chain — genuinely zero
// marginal cost, used by app/api/dashboard-assistant/route.ts,
// app/api/courses/chat/route.ts, and app/api/assistant/route.ts's
// text-only path. Kept in ONE place so all three stay in sync rather than
// drifting if a slug ever retires.
//
// Re-verified live, 2026-08-30, against GET https://openrouter.ai/api/v1/models
// (product direction: find the best currently-available free models —
// "meta-llama/llama-3.3-70b-instruct:free" from the previous pass no longer
// exists, confirming free-tier slugs rotate at least as often as paid ones).
// Replaced "poolside/laguna-s-2.1:free" (still live, but a coding-agent
// model — a poor fit for general medical-student chat) with the Thinking
// Machines "Inkling" pair: dramatically larger active-parameter counts
// (41B / 12B vs Nemotron's 3B) and a 1M-token context, at the same $0 cost.
// Ordered by capability, largest first; Nemotron kept LAST as the
// already-proven-reliable-in-production fallback, not dropped.
//
// VISION: OpenRouter's own catalog describes both Inkling variants as
// "multimodal", but that's marketing copy, not a verified test call — per
// this session's standing "never trust an unverified capability claim"
// discipline, this chain is still treated as TEXT-ONLY until a real image
// request against it has been confirmed to work. app/api/assistant/route.ts
// (the one caller that accepts image attachments) routes an image-bearing
// message to HAIKU_MODEL instead, specifically to keep relying on
// Anthropic's own confirmed vision support rather than an unverified claim.
export const FREE_MODEL_CHAIN = ["thinkingmachines/inkling:free", "thinkingmachines/inkling-small:free", "nvidia/nemotron-3.5-lightning:free"];

// Zero-spend Studio-content generation for local development: callOpenRouter
// below checks this to serve a canned fixture (lib/ai/mock-data.ts) instead
// of a real, billed call. Deliberately does NOT gate streamOpenRouter (the
// chat) — a chat that gives the same fixed answer regardless of the
// question isn't "cost-controlled", it's broken, and that exact bug (every
// message answered with a hardcoded "méningite bactérienne" fixture) is why
// this no longer applies there. Exported so lib/ai/embeddings.ts applies the
// same gate to embedding calls used by Studio-content generation.
export const USE_MOCK_AI = process.env.USE_MOCK_AI === "true";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every claim in this file's comments about caching "saving money" was, until
 * now, never actually checked against a real API response — callOpenRouter
 * discarded `data.usage` entirely, and streamOpenRouter never even requested
 * it (`stream_options.include_usage` is required for a streamed OpenAI-
 * compatible completion to include a usage frame at all — see the SSE
 * transform below). Logging the raw object (rather than picking specific
 * field names) is deliberate: OpenRouter's pass-through shape for Anthropic's
 * `cache_creation_input_tokens` / `cache_read_input_tokens` isn't confirmed
 * from this codebase alone, and a wrong assumed field name would silently log
 * `undefined` forever, which is exactly the kind of unverified claim this
 * exists to stop making. Read these logs directly to see what's really there.
 */
function logUsage(label: string, usage: unknown): void {
  if (!usage) {
    console.log(`[openrouter:usage] ${label} — aucune donnée d'usage retournée par OpenRouter.`);
    return;
  }
  console.log(`[openrouter:usage] ${label}:`, JSON.stringify(usage));
}

function extractText(content: ChatMessageInput["content"]): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n");
}

function findSystemText(messages: ChatMessageInput[]): string {
  const systemMessage = messages.find((message) => message.role === "system");
  return systemMessage ? extractText(systemMessage.content) : "";
}

export class OpenRouterError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Pulls the human-readable detail out of OpenRouter's error body (shape:
 * `{"error":{"message":"...","code":...}}`), e.g. "google/gemini-1.5-flash
 * is not a valid model ID" — this is exactly the detail that used to get
 * swallowed into a generic "L'appel au modèle IA a échoué", which made a bad
 * model id or a misconfigured key indistinguishable from a real transient
 * outage. Falls back to a short raw-body excerpt if the body isn't the
 * expected JSON shape (e.g. an HTML error page from a proxy in front of the
 * API), never null/empty — there's always SOMETHING to show.
 */
function extractOpenRouterErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const detail = parsed?.error?.message;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  } catch {
    // body wasn't JSON — fall through to the raw excerpt below.
  }
  return body.trim().slice(0, 200) || "Réponse vide.";
}

/**
 * A single "part" of a message's content, Anthropic/OpenRouter's
 * content-block format. `cache_control: { type: "ephemeral" }` marks this
 * block (and everything before it in the prompt) as a cacheable prefix —
 * Anthropic requires exact-byte-match on that prefix to hit the cache, so
 * only ever put STATIC content (system persona, course raw_text) in a
 * cache-marked block, never anything that changes between calls (history,
 * the user's new question).
 */
export interface ContentBlock {
  type: "text";
  text: string;
  // `ttl: "1h"` (vs. the default 5-minute ephemeral cache) — verified live
  // against OpenRouter's own docs: supported end-to-end for Claude models on
  // every provider OpenRouter routes to. Costs more to WRITE (2x input price
  // vs 1.25x for the 5-min default) but reads are still ~90% off regardless
  // of TTL — worth it on a block that's genuinely reused across a realistic
  // gap between messages (a student reading/thinking for >5 min, which the
  // default TTL would treat as a fresh, full-price write every time). On a
  // small block (e.g. this app's persona prompt) the absolute cost delta
  // between the two write premiums is negligible, so there's no real
  // downside to defaulting long-lived static content to "1h".
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  /** Plain string for ordinary messages; a content-block array only when a cache breakpoint is needed on this message. */
  content: string | ContentBlock[];
}

// No timeout previously existed anywhere in this file — a stalled TCP
// connection (OpenRouter accepts the request but never sends a byte back)
// would hang the fetch indefinitely. On Vercel that's eventually cut off by
// the route's own `maxDuration`, but as a raw platform timeout with no JSON
// body, not this module's own clean OpenRouterError — and locally (`next
// dev`, no platform-level cutoff at all) it would hang forever. Default is
// comfortably under the 300s `maxDuration` the heaviest generation routes
// declare; callers on a tighter budget (e.g. the 60s flashcards/remediation
// routes) should pass a smaller `timeoutMs` explicitly.
const DEFAULT_TIMEOUT_MS = 240_000;

/**
 * Thin wrapper around OpenRouter's OpenAI-compatible chat completions API.
 * Every real AI call in this app goes through here — never call Anthropic
 * (or any other provider) directly.
 */
export async function callOpenRouter(
  messages: ChatMessageInput[],
  options?: {
    maxTokens?: number;
    model?: string;
    bypassMock?: boolean;
    temperature?: number;
    timeoutMs?: number;
    // Same reasoning-token cap as streamOpenRouter's own `reasoning` option
    // (see its comment) — needed here too now that lib/cache-prewarming.ts
    // calls this non-streaming path with a model that can route to
    // ECONOMY_MODEL, which has the same hidden-reasoning-token behavior
    // regardless of whether the call streams or not.
    reasoning?: { effort?: "high" | "medium" | "low" | "minimal"; max_tokens?: number; exclude?: boolean };
  }
): Promise<string> {
  // detectMockPayload matches by loose substring against the SYSTEM PROMPT
  // TEXT, not by an explicit section id — it was built for one fixed set of
  // prompts (lib/prompts/public-course-sections.ts) and has no way to know a
  // caller belongs to a different pipeline entirely. This already bit the
  // Studio pipeline once: its "explication" prompt happened to contain the
  // literal substring "explication ULTRA-DÉTAILLÉE", which is also this
  // mock system's marker for the real per-course pipeline — so in dev mode
  // it silently served the hardcoded méningite JSON fixture instead of ever
  // calling Claude, no matter how the prompt was worded. `bypassMock` lets a
  // caller opt out of this matching entirely rather than playing whack-a-mole
  // rewording prompts to dodge marker collisions that could reappear with
  // any future edit.
  if (USE_MOCK_AI && !options?.bypassMock) {
    const systemText = findSystemText(messages);
    const mock = detectMockPayload(systemText);
    if (mock) {
      console.log(`[MOCK AI] callOpenRouter interceptée — section "${mock.section}" servie depuis lib/ai/mock-data.ts, aucun appel réel à OpenRouter.`);
      await delay(1000 + Math.random() * 1000);
      return JSON.stringify({ [mock.section]: mock.value });
    }
    console.warn("[MOCK AI] Mode mock actif mais aucun fixture ne correspond à ce prompt système — appel réel à OpenRouter effectué. Ajoute un marqueur dans lib/ai/mock-data.ts si ce prompt est nouveau.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY n'est pas configurée sur le serveur.", 500);
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Optional but recommended by OpenRouter for attribution/rankings.
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Med Art AI",
      },
      body: JSON.stringify({
        model: options?.model ?? MODEL,
        messages,
        max_tokens: options?.maxTokens ?? 8192,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
      }),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`OpenRouter fetch timed out after ${timeoutMs}ms`);
      throw new OpenRouterError("Le modèle IA met trop de temps à répondre. Réessaie dans un instant.", 504);
    }
    console.error("OpenRouter fetch failed", error);
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = extractOpenRouterErrorDetail(body);
    console.error(`OpenRouter API error (${res.status})`, body.slice(0, 500));
    // Propagate OpenRouter's own status (400 bad request/model id, 401 bad
    // key, 429 rate limit, ...) instead of collapsing everything to a
    // generic 502 — every caller of callOpenRouter already forwards
    // OpenRouterError.status straight through to its own API response, so
    // this makes THAT response accurate too, not just the server log.
    throw new OpenRouterError(`L'appel au modèle IA a échoué : ${detail}`, res.status);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    console.error("OpenRouter returned an unexpected payload", JSON.stringify(data).slice(0, 500));
    throw new OpenRouterError("Réponse inattendue du modèle.", 502);
  }

  logUsage(`callOpenRouter model=${options?.model ?? MODEL}`, data?.usage);

  return content;
}

/**
 * Same OpenRouter call as `callOpenRouter`, but with `stream: true` — returns
 * a `ReadableStream` of PLAIN TEXT (just the incremental content deltas, no
 * SSE envelope) so a Route Handler can pass it straight through as the
 * response body and the browser can read it with a plain `getReader()` loop,
 * no client-side SSE parser needed. Used by the MedArt Assistant chat, which
 * needs to render the answer progressively instead of waiting for the whole
 * completion.
 *
 * Deliberately NEVER gated by USE_MOCK_AI, unlike callOpenRouter above — a
 * fixed, unconditional canned reply here (this function used to return the
 * exact same "méningite bactérienne" fixture for every single message,
 * regardless of what the student actually typed) makes the chat look
 * completely broken rather than merely cost-controlled: the whole point of
 * a chat is that the reply changes with the question. The chat always calls
 * the real model.
 *
 * `options.model` defaults to the standard Sonnet MODEL — pass HAIKU_MODEL
 * explicitly for the chat's highlight quick actions, which is what forces
 * that cheap-model routing rather than it happening implicitly/by accident.
 *
 * `options.reasoning` controls a reasoning-capable model's hidden
 * "thinking" tokens (OpenRouter's unified `reasoning` request field — see
 * https://openrouter.ai/docs/use-cases/reasoning-tokens). Verified live:
 * reasoning tokens are billed as OUTPUT tokens but are NOT a separate budget
 * from the visible completion — on a model like google/gemini-3.7-flash
 * (lib/chat-model-routing.ts's ECONOMY_MODEL), an uncapped `effort` can
 * silently consume most of `maxTokens` on hidden reasoning before the model
 * writes a single word of the actual answer, which is exactly what produced
 * real mid-sentence truncations (~796 tokens in) with no `reasoning` field
 * ever being set. Passing `{ effort: "low" }` (~20% of the budget per
 * OpenRouter's own documented mapping) leaves the rest for the visible
 * reply; harmless no-op on a model with no reasoning capability at all.
 */
export async function streamOpenRouter(
  messages: ChatMessageInput[],
  options?: {
    maxTokens?: number;
    model?: string;
    timeoutMs?: number;
    temperature?: number;
    reasoning?: { effort?: "high" | "medium" | "low" | "minimal"; max_tokens?: number; exclude?: boolean };
  }
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY n'est pas configurée sur le serveur.", 500);
  }

  // Same stalled-connection guard as callOpenRouter above — aborts the whole
  // request (headers + body read) if OpenRouter never responds at all. Bounds
  // total stream duration too, but max_tokens already caps a reply's length
  // long before this generous a ceiling would ever cut off a real answer.
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Med Art AI",
      },
      body: JSON.stringify({
        model: options?.model ?? MODEL,
        messages,
        max_tokens: options?.maxTokens ?? 4096,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.reasoning ? { reasoning: options.reasoning } : {}),
        stream: true,
        // Without this, a streamed OpenAI-compatible completion never
        // includes a usage frame at all — the final SSE chunk (empty
        // `choices`) that carries prompt/completion/cache token counts is
        // opt-in. Every prior claim about this route's caching "working" was
        // unverifiable without it; see logUsage's own comment above.
        stream_options: { include_usage: true },
      }),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`OpenRouter stream fetch timed out after ${timeoutMs}ms`);
      throw new OpenRouterError("Le modèle IA met trop de temps à répondre. Réessaie dans un instant.", 504);
    }
    console.error("OpenRouter stream fetch failed", error);
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeoutId);
    const body = await res.text().catch(() => "");
    const detail = extractOpenRouterErrorDetail(body);
    console.error(`OpenRouter stream API error (${res.status})`, body.slice(0, 500));
    throw new OpenRouterError(`L'appel au modèle IA a échoué : ${detail}`, res.status);
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  // OpenRouter streams OpenAI-style SSE frames: lines starting with "data: ",
  // each holding one JSON delta, terminated by a literal "data: [DONE]" line.
  // This TransformStream unwraps that envelope down to just the raw text
  // deltas, buffering any line split across chunk boundaries.
  const unwrapSse = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);
          const delta: unknown = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            controller.enqueue(encoder.encode(delta));
          }
          // With stream_options.include_usage above, OpenRouter sends one
          // final frame carrying `usage` and no real delta — this is the
          // only place that data ever surfaces for a streamed call.
          if (json?.usage) {
            logUsage(`streamOpenRouter model=${options?.model ?? MODEL}`, json.usage);
          }
        } catch (error) {
          console.error("OpenRouter stream: malformed SSE frame", error, payload.slice(0, 200));
        }
      }
    },
    flush() {
      clearTimeout(timeoutId);
    },
  });

  return res.body.pipeThrough(unwrapSse);
}
