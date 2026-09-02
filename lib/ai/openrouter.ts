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

// Mid-tier model for PERSONALIZED generation — content that is unique to one
// student (their own flashcards, their own weakness remediation plan, their
// own study schedule, their own cross-course module synthesis) and therefore
// can never benefit from the cross-student/cross-university pooling that
// keeps STUDIO_MODEL's (Sonnet 5) real per-student cost near zero on
// app/api/studio/generate. For these routes the model tier is the only
// remaining cost lever, so they use this instead of STUDIO_MODEL.
// Confirmed live, 2026-08-31, against GET https://openrouter.ai/api/v1/models:
// $0.25/M input + $2/M output vs Sonnet 5's $2/M + $10/M — a 5x cut on
// completion cost (the dominant cost on these long-output generations), at a
// context window (400K) comfortably larger than any prompt these routes send.
// Re-verify the same way if this ever 404s.
export const MID_TIER_MODEL = "openai/gpt-5-mini";

// TRIED AND REVERTED: "openai/gpt-5-nano" was adopted for
// app/api/exam/generate/route.ts's exam-shortfall QCM batches after passing
// a real side-by-side test against 2 even-cheaper candidates (both of which
// had a confirmed factual error on independent adversarial review, while
// gpt-5-nano had none) — but real production usage then surfaced what that
// one-shot test missed: it doesn't reliably hit an exact structured-output
// count under load (two separate real failures: a 6-question batch came
// back as 7, and later even an 8-question batch — the "safe", standard
// round size — failed the same way). A handful of clean test calls is not
// enough evidence for a count-exactness guarantee; briefly reverted the exam
// route to HAIKU_MODEL. Left this history here instead of silently deleting
// it so the same mistake (trusting a small sample for a hard-exactness
// requirement) isn't repeated on the next cost-cutting pass.

// EXPLICIT, KNOWINGLY-ACCEPTED ACCURACY TRADEOFF — the product owner's own
// deliberate choice to prioritize runway over a measured, non-zero accuracy
// margin, with the explicit intent to revisit once the product has more
// revenue. Re-verify this tradeoff (or drop a given call site back to its
// previous model) rather than silently assuming it's still the right call
// once that revisit happens.
//
// Testing depth differs by call site — read this before adding a new one:
// - app/api/exam/generate/route.ts's exam-shortfall QCM batches: the ONLY
//   call site with deep validation — 2 full rounds, 8 independent real
//   trials each, plus independent adversarial re-verification of the best
//   sample. Structural reliability is perfect (16/16 trials produced
//   exactly the requested count, correct schema), but medical-accuracy is
//   NOT: even after hardening the prompt with an explicit "never substitute
//   your own general medical knowledge for what the source text
//   specifically says" instruction (see EXAM_PERSONA_AND_STYLE's own
//   "RIGUEUR ABSOLUE" paragraph), 2 of 8 trials still introduced a real,
//   source-contradicting biochemistry claim (a pathway-labeling mixup, e.g.
//   aérobie/anaérobie) in a distractor's explanation — a measured ~25%
//   per-batch recurrence rate, confirmed by independent review. HAIKU_MODEL
//   never showed this failure mode in the same testing and remains the
//   technically safer choice for THIS call site specifically.
// - lib/module-synthesis.ts's buildCrossCourseSynthesis, app/api/flashcards
//   /generate/route.ts, app/api/study/remediation-plan/generate/route.ts,
//   app/api/study-planner/generate/route.ts, and app/api/notes/organize
//   /route.ts: each tested with only 1-2 real calls (not the 16-trial depth
//   above) before switching. Those calls were clean (schema-valid, medically
//   sound on manual read), and two real defects found along the way — the
//   study-planner silently dropping the final days of a long plan, and
//   notes/organize returning a full HTML document instead of a fragment —
//   were fixed by hardening their own prompts (see each file's own
//   comments). But a small sample is exactly what the exam-QCM finding
//   above warns against trusting for a hard-accuracy guarantee — these
//   call sites carry a real, currently-unquantified version of the same
//   kind of risk, accepted on the same "runway over accuracy margin" basis
//   without the same amount of evidence behind it.
export const CHEAP_MODEL = "deepseek/deepseek-v3.2";

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

// Studio "Infographie / Mindmap" tab — confirmed live against
// GET https://openrouter.ai/api/v1/models (2026-09-02): real id, output
// modality includes "image". Real test generation confirmed the ACTUAL cost
// (~$0.07/image, 1120 image completion tokens at this model's
// $0.00006/token image_output rate — NOT a per-image flat price, which the
// tiny-looking per-unit number could otherwise be misread as) — see
// lib/studio-infographic-cache.ts's own comment. Cross-student cached
// there, so this is paid once per distinct course, not once per student.
const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";

export interface GeneratedImageResult {
  /** `data:image/...;base64,...` — the raw model output, not yet uploaded anywhere. Caller decodes and stores it (see app/api/studio/infographic/route.ts). */
  imageDataUrl: string;
  /** Accompanying prose, if the model returned any alongside the image — rarely meaningful here, kept only for debugging/logging. */
  text: string | null;
}

/**
 * Image-generation counterpart to callOpenRouter above — a fundamentally
 * different request (`modalities: ["text", "image"]`) and response shape
 * (`choices[0].message.images`, an array of `{type, image_url: {url}}`, NOT
 * a plain `content` string) from every text-only call in this app, so it
 * gets its own function rather than overloading callOpenRouter's contract.
 * Confirmed live (2026-09-02, real test call against
 * IMAGE_MODEL/google/gemini-3.1-flash-image-preview): this exact response
 * shape is what comes back — `message.images[0].image_url.url` as a real
 * `data:image/png;base64,...` URL.
 */
export async function generateOpenRouterImage(
  messages: ChatMessageInput[],
  options?: { model?: string; timeoutMs?: number }
): Promise<GeneratedImageResult> {
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
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Med Art AI",
      },
      body: JSON.stringify({
        model: options?.model ?? IMAGE_MODEL,
        modalities: ["text", "image"],
        messages,
      }),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`OpenRouter image generation timed out after ${timeoutMs}ms`);
      throw new OpenRouterError("La génération de l'image met trop de temps. Réessaie dans un instant.", 504);
    }
    console.error("OpenRouter image generation fetch failed", error);
    throw new OpenRouterError("L'appel au modèle d'image a échoué. Réessaie dans un instant.", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = extractOpenRouterErrorDetail(body);
    console.error(`OpenRouter image API error (${res.status})`, body.slice(0, 500));
    throw new OpenRouterError(`La génération de l'image a échoué : ${detail}`, res.status);
  }

  const data = await res.json();
  logUsage(`generateOpenRouterImage model=${options?.model ?? IMAGE_MODEL}`, data?.usage);

  const message = data?.choices?.[0]?.message;
  const images = message?.images;
  const imageDataUrl = Array.isArray(images) && images.length > 0 ? images[0]?.image_url?.url : undefined;

  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    console.error("OpenRouter image generation returned no usable image", JSON.stringify(data).slice(0, 500));
    throw new OpenRouterError("Le modèle n'a renvoyé aucune image exploitable.", 502);
  }

  return { imageDataUrl, text: typeof message?.content === "string" ? message.content : null };
}

// Studio "Podcast Audio" tab — confirmed live against
// GET https://openrouter.ai/api/v1/models (2026-09-02): real id, output
// modality includes "audio". Real minimal calibration test confirmed: (1)
// streaming REQUIRES `audio.format: "pcm16"` (mp3/wav are rejected with a 400
// once `stream: true`), (2) narration runs at ~20 audio tokens/second, (3)
// `completion`/`audio_output` are billed at the SAME rate on this model
// ($0.0000024/token) — so a real 10-15 min episode costs roughly $0.02-0.04.
// Cross-student cached (lib/studio-podcast-cache.ts), so this is paid once
// per distinct course, not once per student.
export const AUDIO_MODEL = "openai/gpt-audio-mini";

export interface GeneratedAudioResult {
  /** Raw 24kHz mono 16-bit PCM samples, no container — caller must encode (see lib/audio/mp3-encoder.ts) before storing anywhere. */
  pcm16: Buffer;
  /** The model's own transcript of what it actually said — logged for debugging, never shown to students (the script that WAS the request is already known to the caller). */
  transcript: string;
}

/**
 * Audio-generation counterpart to callOpenRouter/generateOpenRouterImage
 * above — confirmed live (2026-09-02) that `openai/gpt-audio-mini` REJECTS
 * audio output entirely unless `stream: true` ("Audio output requires
 * stream: true"), so this can't reuse callOpenRouter's plain-JSON shape. The
 * response is OpenAI-style SSE with `choices[0].delta.audio.{data,transcript}`
 * fragments instead of `streamOpenRouter`'s plain-text content deltas, so
 * this accumulates the WHOLE thing into one buffer before returning rather
 * than piping through — the caller (app/api/studio/podcast/route.ts) needs
 * the complete audio before it can encode-and-upload, there is no "the
 * browser plays it as it arrives" use case here like the chat's streaming.
 */
export async function generateOpenRouterAudio(
  messages: ChatMessageInput[],
  options?: { model?: string; voice?: string; maxTokens?: number; timeoutMs?: number }
): Promise<GeneratedAudioResult> {
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
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Med Art AI",
      },
      body: JSON.stringify({
        model: options?.model ?? AUDIO_MODEL,
        modalities: ["text", "audio"],
        audio: { voice: options?.voice ?? "alloy", format: "pcm16" },
        max_tokens: options?.maxTokens ?? 8192,
        stream: true,
        stream_options: { include_usage: true },
        messages,
      }),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`OpenRouter audio generation timed out after ${timeoutMs}ms`);
      throw new OpenRouterError("La génération audio met trop de temps. Réessaie dans un instant.", 504);
    }
    console.error("OpenRouter audio generation fetch failed", error);
    throw new OpenRouterError("L'appel au modèle audio a échoué. Réessaie dans un instant.", 502);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeoutId);
    const body = await res.text().catch(() => "");
    const detail = extractOpenRouterErrorDetail(body);
    console.error(`OpenRouter audio API error (${res.status})`, body.slice(0, 500));
    throw new OpenRouterError(`La génération audio a échoué : ${detail}`, res.status);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const audioB64Parts: string[] = [];
  const transcriptParts: string[] = [];
  let usage: unknown = null;

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let json: any;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }

        if (json.usage) usage = json.usage;
        const delta = json?.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.audio?.data) audioB64Parts.push(delta.audio.data);
        if (delta.audio?.transcript) transcriptParts.push(delta.audio.transcript);
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  logUsage(`generateOpenRouterAudio model=${options?.model ?? AUDIO_MODEL}`, usage);

  const audioB64 = audioB64Parts.join("");
  if (!audioB64) {
    console.error("OpenRouter audio generation returned no audio data");
    throw new OpenRouterError("Le modèle n'a renvoyé aucun audio exploitable.", 502);
  }

  return { pcm16: Buffer.from(audioB64, "base64"), transcript: transcriptParts.join("") };
}

// Dashboard "Audio to Smart Notes" — Phase 1 (STT). This app's hard rule is
// 100% OpenRouter, zero third-party API keys — so this uses OpenRouter's OWN
// dedicated transcription endpoint (`/api/v1/audio/transcriptions`, a
// DIFFERENT endpoint from `/chat/completions`, confirmed live 2026-09-02 via
// openrouter.ai/blog/tutorials/transcription-on-openrouter), never a direct
// call to Groq or any other STT provider.
//
// Model confirmed live via GET /api/v1/models?output_modalities=transcription
// (2026-09-02): `openai/whisper-large-v3-turbo` is real and present, same
// model family/name this app previously called directly on Groq. Billing
// unit CONFIRMED by a real call (2026-09-02): `usage` returns `{seconds,
// cost}`, no token counts at all — billed by audio DURATION, not tokens.
//
// SURPRISE, also confirmed by a real A/B test on the identical clip: passing
// a `language` hint (e.g. "fr") does NOT change the transcript output on a
// French/Darija-mixed clip, but roughly TRIPLES the effective rate —
// ~$0.04/hour with `language: "fr"` vs ~$0.012/hour with no `language` at
// all (auto-detect). This route deliberately never passes `language` — see
// app/api/lecture-notes/process/route.ts's own call site.
//
// ALSO CONFIRMED, and more important than the price: on a real clip
// containing an embedded Darija/Arabic-script phrase, this model did not
// mis-transcribe that segment (which the CAFE/NADI benchmarks' WER numbers
// would predict) — it SILENTLY DROPPED it from the output entirely, with
// both a "fr" language hint and with none. This is worse than a garbled
// transcription: lost content here can never be "reconstructed from
// context" by the Phase 2 extraction prompt, because it was never
// transcribed in the first place. Only tested on one short synthetic clip —
// real classroom audio (background noise, real accents, longer Darija
// passages) may behave differently, better or worse.
export const TRANSCRIPTION_MODEL = "openai/whisper-large-v3-turbo";

const OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

export type TranscriptionFormat = "wav" | "mp3" | "flac" | "m4a" | "ogg" | "webm" | "aac";

const TRANSCRIPTION_FORMAT_MIME: Record<TranscriptionFormat, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  webm: "audio/webm",
  aac: "audio/aac",
};

// Kept safely under the endpoint's DOCUMENTED multipart cap (25 MB,
// confirmed live 2026-09-02) rather than right at it — base64 in the JSON
// path below is for files ABOVE this line only, where multipart genuinely
// isn't an option.
const MULTIPART_SAFE_MAX_BYTES = 24 * 1024 * 1024;

export interface TranscriptionResult {
  text: string;
  /** Raw usage object from OpenRouter — logged, not parsed into named fields (see logUsage's own comment on why: an assumed field name for an unconfirmed shape is exactly the kind of unverified claim this codebase no longer makes). */
  usage: unknown;
}

/**
 * Real failure, confirmed live 2026-09-02: a request comfortably over a few
 * MB sent via the JSON/base64 path came back as a non-2xx HTTP status with a
 * COMPLETELY EMPTY body — the classic signature of a proxy/gateway rejecting
 * an oversized request before it ever reaches the actual transcription
 * model, not a real API error with a message. The docs describe base64 JSON
 * as "supporting larger files" than multipart's documented 25 MB cap, but
 * never state a real number — that claim doesn't hold up in practice.
 *
 * Fix: prefer multipart/form-data (the endpoint's OTHER supported input
 * mode, matching the OpenAI-compatible "file + model" shape) for any file
 * that fits under the multipart path's DOCUMENTED 25 MB limit — which is
 * every file this feature will see in practice except a genuine multi-hour
 * lecture. JSON/base64 is now only the FALLBACK for files that exceed that,
 * where there is no alternative — its real behavior at large sizes is still
 * unverified (see the module-level comment above `TRANSCRIPTION_MODEL`).
 */
export async function transcribeAudioViaOpenRouter(
  buffer: Buffer,
  format: TranscriptionFormat,
  // temperature defaults to 0 (deterministic, most-likely-token decoding) —
  // Whisper-family models are well known to "hallucinate" invented words
  // during silence/noise/low-confidence audio, and a real fidelity issue was
  // reported on this exact pipeline (see lib/ai/lecture-notes-prompts.ts's
  // own hardening comment). A higher temperature only adds decoding
  // randomness, which is never wanted for a transcription meant to be
  // word-for-word faithful.
  options?: { language?: string; timeoutMs?: number; temperature?: number }
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY n'est pas configurée sur le serveur.", 500);
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const useMultipart = buffer.length <= MULTIPART_SAFE_MAX_BYTES;
  const baseHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": "Med Art AI",
  };

  let res: Response;
  try {
    if (useMultipart) {
      const form = new FormData();
      form.append("model", TRANSCRIPTION_MODEL);
      // Uint8Array.from(...) — same reasoning as lib/audio/mp3-encoder.ts's
      // own comment: Buffer's underlying ArrayBufferLike isn't assignable to
      // BlobPart's stricter ArrayBuffer type.
      form.append("file", new Blob([Uint8Array.from(buffer)], { type: TRANSCRIPTION_FORMAT_MIME[format] }), `audio.${format}`);
      if (options?.language) form.append("language", options.language);
      form.append("temperature", String(options?.temperature ?? 0));

      res = await fetch(OPENROUTER_TRANSCRIPTION_URL, {
        method: "POST",
        // No Content-Type here — fetch sets the correct multipart boundary
        // itself from the FormData instance; setting it manually breaks it.
        headers: baseHeaders,
        body: form,
        signal: timeoutController.signal,
      });
    } else {
      res = await fetch(OPENROUTER_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { ...baseHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: TRANSCRIPTION_MODEL,
          input_audio: { data: buffer.toString("base64"), format },
          temperature: options?.temperature ?? 0,
          ...(options?.language ? { language: options.language } : {}),
        }),
        signal: timeoutController.signal,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`OpenRouter transcription timed out after ${timeoutMs}ms`);
      throw new OpenRouterError("La transcription met trop de temps. Réessaie dans un instant.", 504);
    }
    console.error("OpenRouter transcription fetch failed", error);
    throw new OpenRouterError("L'appel à la transcription a échoué. Réessaie dans un instant.", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = extractOpenRouterErrorDetail(body);
    console.error(`OpenRouter transcription API error (${res.status}, multipart=${useMultipart})`, body.slice(0, 500));
    // The HTTP status is now ALWAYS in the message the client sees — an
    // empty `detail` used to silently hide whether this was even a real API
    // error vs. a bare proxy rejection.
    throw new OpenRouterError(`La transcription a échoué (HTTP ${res.status}) : ${detail}`, res.status);
  }

  const data = await res.json();
  logUsage(`transcribeAudioViaOpenRouter model=${TRANSCRIPTION_MODEL}`, data?.usage);

  const text = data?.text;
  if (typeof text !== "string" || !text.trim()) {
    console.error("OpenRouter transcription returned an unexpected payload", JSON.stringify(data).slice(0, 500));
    throw new OpenRouterError("La transcription est revenue vide — le fichier est peut-être inaudible ou silencieux.", 502);
  }

  return { text, usage: data?.usage };
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
