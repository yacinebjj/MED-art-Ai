const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// "anthropic/claude-3.5-sonnet" was retired by OpenRouter (404s with
// "No endpoints found") — this is the current equivalent, confirmed live
// against GET https://openrouter.ai/api/v1/models.
const MODEL = "anthropic/claude-sonnet-5";

export class OpenRouterError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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
  options?: { maxTokens?: number }
): Promise<string> {
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
        model: MODEL,
        messages,
        max_tokens: options?.maxTokens ?? 8192,
      }),
    });
  } catch (error) {
    console.error("OpenRouter fetch failed", error);
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`OpenRouter API error (${res.status})`, body.slice(0, 500));
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
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
 */
export async function streamOpenRouter(
  messages: ChatMessageInput[],
  options?: { maxTokens?: number }
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
        model: MODEL,
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
    console.error(`OpenRouter stream API error (${res.status})`, body.slice(0, 500));
    throw new OpenRouterError("L'appel au modèle IA a échoué. Réessaie dans un instant.", 502);
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
