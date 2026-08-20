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
  cache_control?: { type: "ephemeral" };
}

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  /** Plain string for ordinary messages; a content-block array only when a cache breakpoint is needed on this message. */
  content: string | ContentBlock[];
}

/**
 * Thin wrapper around OpenRouter's OpenAI-compatible chat completions API.
 * Every real AI call in this app goes through here — never call Anthropic
 * (or any other provider) directly.
 */
export async function callOpenRouter(
  messages: ChatMessageInput[],
  options?: { maxTokens?: number; model?: string; bypassMock?: boolean; temperature?: number }
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
      }),
    });
  } catch (error) {
    console.error("OpenRouter fetch failed", error);
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
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
 */
export async function streamOpenRouter(
  messages: ChatMessageInput[],
  options?: { maxTokens?: number; model?: string }
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY n'est pas configurée sur le serveur.", 500);
  }

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
        stream: true,
      }),
    });
  } catch (error) {
    console.error("OpenRouter stream fetch failed", error);
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
  }

  if (!res.ok || !res.body) {
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
        } catch (error) {
          console.error("OpenRouter stream: malformed SSE frame", error, payload.slice(0, 200));
        }
      }
    },
  });

  return res.body.pipeThrough(unwrapSse);
}
