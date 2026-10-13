import { brandedUpstreamMessage, fetchOpenRouterWithRetry, OpenRouterError, type ChatMessageInput } from "@/lib/ai/openrouter";
import { stripReasoning } from "@/lib/strip-reasoning";

/**
 * Direct DeepSeek API client (https://api-docs.deepseek.com) — used ONLY by
 * Explication Ultra-Détaillée (lib/studio-explication-delta.ts), which used to
 * reach deepseek/deepseek-v3.2 through OpenRouter. Every other AI call in the
 * app still goes through lib/ai/openrouter.ts.
 *
 * The direct API does not serve V3.2: as of 2026-10 it only exposes
 * `deepseek-flash` (DeepSeek-V4.1-Flash) and `deepseek-v4-pro`. Flash is the
 * cheap tier ($0.15-0.30/M input, $0.60-1.20/M output depending on peak
 * hours); override with DEEPSEEK_EXPLICATION_MODEL to try Pro.
 */
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export const EXPLICATION_MODEL = process.env.DEEPSEEK_EXPLICATION_MODEL || "deepseek-flash";

const DEFAULT_TIMEOUT_MS = 240_000;

/**
 * No new data frame for this long = the request is stuck (queued or stalled
 * mid-answer). Aborting early leaves the browser-driven retry in
 * lib/studio-explication-client.ts time to try again inside the route's
 * maxDuration, instead of everything dying together at the deadline.
 * DeepSeek's ": keep-alive" SSE comments do NOT count as progress.
 */
const STALL_TIMEOUT_MS = 60_000;

export interface CallDeepSeekOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Thinking mode is ON by default on DeepSeek V4 — Explication wants it off (whole budget for visible text). */
  thinking?: boolean;
  /** `response_format: json_object` — the prompt must itself ask for JSON. */
  jsonOutput?: boolean;
}

function toPlainText(content: ChatMessageInput["content"]): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n");
}

function extractDeepSeekErrorDetail(body: string): string {
  try {
    const detail = JSON.parse(body)?.error?.message;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  } catch {
    // not JSON — fall through to the raw excerpt.
  }
  return body.trim().slice(0, 200) || "Réponse vide.";
}

/**
 * Same contract as callOpenRouter (resolves to the whole answer text, throws
 * OpenRouterError with the same statuses and the same `truncated` flag), so
 * callers and their retry logic are unchanged.
 *
 * STREAMED UNDER THE HOOD: the request uses `stream: true` and accumulates
 * the deltas. The connection to DeepSeek is never idle for minutes (no
 * proxy/idle-timeout drop), the stall watchdog catches a stuck request in
 * STALL_TIMEOUT_MS instead of at the deadline, and the deadline timer stays
 * armed through the whole body read.
 */
export async function callDeepSeek(messages: ChatMessageInput[], options?: CallDeepSeekOptions): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("DEEPSEEK_API_KEY n'est pas configurée sur le serveur.", 500);
  }

  const model = options?.model ?? EXPLICATION_MODEL;
  const maxTokens = options?.maxTokens ?? 8192;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  // Cast, not an annotation: assigned only inside callbacks, so TS would
  // otherwise narrow it to `null` for good.
  let abortReason = null as "deadline" | "stall" | null;
  const abort = (reason: "deadline" | "stall") => {
    if (abortReason) return;
    abortReason = reason;
    controller.abort();
  };
  const startedAt = Date.now();
  let lastFrameAt = startedAt;
  const deadlineTimer = setTimeout(() => abort("deadline"), timeoutMs);
  const watchdog = setInterval(() => {
    if (Date.now() - lastFrameAt > STALL_TIMEOUT_MS) abort("stall");
  }, 5_000);

  let content = "";
  let finishReason: string | null = null;
  let usage: unknown = null;

  try {
    const res = await fetchOpenRouterWithRetry(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: toPlainText(m.content) })),
        max_tokens: maxTokens,
        thinking: { type: options?.thinking ? "enabled" : "disabled" },
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.jsonOutput ? { response_format: { type: "json_object" } } : {}),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      console.error(`DeepSeek API error (${res.status})`, extractDeepSeekErrorDetail(body));
      throw new OpenRouterError(brandedUpstreamMessage(res.status, "text"), res.status);
    }

    // OpenAI-style SSE: "data: {chunk}" lines, ": keep-alive" comments,
    // terminated by "data: [DONE]". Lines can be split across reads.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        lastFrameAt = Date.now();
        try {
          const json = JSON.parse(payload);
          const choice = json?.choices?.[0];
          const delta: unknown = choice?.delta?.content;
          if (typeof delta === "string") content += delta;
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (json?.usage) usage = json.usage;
        } catch (error) {
          console.error("DeepSeek stream: malformed SSE frame", error, payload.slice(0, 200));
        }
      }
    }
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    if (abortReason || (error instanceof Error && error.name === "AbortError")) {
      console.error(
        abortReason === "stall"
          ? `DeepSeek stream stalled (no data for ${STALL_TIMEOUT_MS}ms, ${content.length} chars received, model=${model})`
          : `DeepSeek call timed out after ${timeoutMs}ms (${content.length} chars received, model=${model})`
      );
      throw new OpenRouterError("MedArt Neural Engine met trop de temps à répondre. Réessaie dans un instant.", 504);
    }
    console.error("DeepSeek fetch failed", error);
    throw new OpenRouterError("MedArt Neural Engine n'a pas pu répondre. Réessaie dans un instant.", 502);
  } finally {
    clearTimeout(deadlineTimer);
    clearInterval(watchdog);
  }

  console.log(
    `[deepseek:usage] model=${model} finish=${finishReason} ${Math.round((Date.now() - startedAt) / 1000)}s:`,
    JSON.stringify(usage)
  );

  // Cut off by max_tokens: incomplete — flagged so the client re-splits the
  // slice instead of retrying an identical request (see OpenRouterError.truncated).
  if (finishReason === "length") {
    console.error(`DeepSeek response truncated by max_tokens ceiling (model=${model}, maxTokens=${maxTokens})`);
    throw new OpenRouterError(
      "La réponse de l'IA a été coupée avant la fin (limite de longueur atteinte). Réessaie — la génération sera automatiquement redécoupée si besoin.",
      502,
      { truncated: true }
    );
  }
  if (finishReason === "insufficient_system_resource") {
    throw new OpenRouterError(brandedUpstreamMessage(503, "text"), 503);
  }
  if (finishReason === null) {
    // Stream closed without a final chunk: the connection dropped mid-answer.
    console.error(`DeepSeek stream ended without finish_reason (${content.length} chars received, model=${model})`);
    throw new OpenRouterError("MedArt Neural Engine n'a pas pu répondre. Réessaie dans un instant.", 502);
  }
  if (!content.trim()) {
    console.error(`DeepSeek returned an empty answer (finish=${finishReason}, model=${model})`);
    throw new OpenRouterError("Réponse inattendue du modèle.", 502);
  }

  const cleaned = stripReasoning(content);
  return cleaned.length > 0 ? cleaned : content;
}
