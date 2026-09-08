import { Agent } from "undici";
import dns from "dns";
import { detectMockPayload } from "@/lib/ai/mock-data";

/**
 * THE REAL, EMPIRICALLY-CONFIRMED ROOT CAUSE of the "Erreur 504" that kept
 * recurring on Explication Ultra-Détaillée no matter how generously every
 * timeout in this app was raised. Two prior rounds of fixes on the app side
 * (removing AI calls from the fast route, raising every timeoutMs/maxDuration
 * to match this project's real, measured Vercel duration ceiling — 250s+,
 * confirmed live) were all individually correct but never touched the ACTUAL
 * problem: a plain, unmodified `fetch()` call to OpenRouter — no custom
 * Agent, no retry logic, nothing app-specific — HUNG for the FULL configured
 * timeout (260s+) every time it was made from WITHIN this Vercel project's
 * serverless runtime, while the IDENTICAL request (same model, same prompt,
 * same 50KB+ payload) completed in ~7 SECONDS when sent from outside Vercel
 * entirely. That specific signature — works everywhere, hangs on one cloud
 * platform, same request — is the classic fingerprint of broken/slow IPv6
 * egress: Node's default DNS result order is "verbatim" (whatever order the
 * resolver returns, which can put an AAAA/IPv6 record first) even when the
 * platform's actual IPv6 route to the destination is unreachable or far
 * slower than its IPv4 route. Confirmed by direct A/B test against a live
 * diagnostic route deployed to this exact project: forcing IPv4-first
 * resolution turned a guaranteed 260s+ timeout into a successful 200
 * response. Scoped here (not a Next.js instrumentation hook or a
 * project-wide config) so it's guaranteed to run before ANY OpenRouter call
 * in this file — the first, and for this bug the only, module that needs it
 * — the moment this module is first imported; `dns.setDefaultResultOrder`
 * affects the whole Node process, so one call here is sufficient and safe to
 * repeat (idempotent) if some other module ever calls it too.
 */
dns.setDefaultResultOrder("ipv4first");

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

// Ultra-cheap VISION tier — for a pure structured-extraction task (read a
// document/image, emit a JSON profile) that needs multimodal input but not
// deep medical reasoning, HAIKU_MODEL's $1/M+$5/M is overkill.
//
// SECOND PASS, 2026-09-05 — pushed further below "google/gemini-3.5-flash-
// lite" ($0.30/M+$2.50/M, this constant's first pick) after an explicit
// "cheapest possible without sacrificing accuracy" ask. Surveyed OpenRouter's
// full vision-capable catalog (two independent fetches: one full-catalog
// price sort, one exact-id lookup on the shortlist below, to guard against a
// single hallucinated/misparsed entry given this endpoint's huge JSON body —
// the full-catalog scan alone is NOT trustworthy on its own: it repeatedly
// mis-tagged text-only models as vision-capable and vice versa). Real,
// confirmed-live vision candidates cheaper than Gemini 3.5 Flash Lite, from
// cheapest to most expensive:
//   - "qwen/qwen3.7-flash"              $0.03/M  + $0.13/M  (absolute floor)
//   - "z-ai/glm-5.3-flash"              $0.075/M + $0.25/M
//   - "meta/muse-spark-1.2-contributor" $0.10/M  + $0.20/M
//   - "qwen/qwen3.8-flash"              $0.15/M  + $0.47/M  <- chosen
// Deliberately did NOT pick the absolute floor (qwen3.7-flash): its own
// OpenRouter description leans "object recognition, spatial understanding,
// real-world [interaction]" — a general vision-language model, not
// specifically a document-reading one — and the real dollar gap to the pick
// below is negligible (a single analysis call here is a few thousand tokens
// total, so the difference between the floor and the pick below is well
// under $0.001 per upload — not a real optimization either way). Also
// deliberately skipped the "-contributor" variant despite its price: that
// naming pattern on OpenRouter denotes a discounted tier traded for the
// provider logging/training on your prompts, which is a real, unacceptable
// privacy trade-off for a student's own uploaded exam document.
// "qwen/qwen3.8-flash" is the pick: still ~2x cheaper on input and >5x
// cheaper on output than the previous choice, genuinely multimodal
// (architecture.input_modalities: text/image/video, 1M context), and its own
// description explicitly names "document and codebase analysis, chart
// analysis" — the closest capability match to this call site's actual job
// (reading a scanned/photographed exam and extracting its structural DNA)
// among the cheaper candidates. NOT yet validated with a real test call
// (same "no live paid call without explicit go-ahead" discipline as every
// other model choice in this app) — re-verify the same way if this ever
// 404s, or revert to google/gemini-3.5-flash-lite (see git history) if a
// real test call surfaces an accuracy problem this survey couldn't catch.
export const CHEAP_VISION_MODEL = "qwen/qwen3.8-flash";

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
// keeps ECONOMY_MODEL's real per-student cost near zero on
// app/api/studio/generate (see lib/ai/studio-prompts.ts — every Studio
// section runs on ECONOMY_MODEL except Explication Ultra-Détaillée, which
// runs on CHEAP_MODEL below — no Sonnet fallback anywhere). For these
// routes the model tier is the only remaining cost lever, so they use this
// instead. Confirmed live, 2026-08-31, against
// GET https://openrouter.ai/api/v1/models: $0.25/M input + $2/M output vs
// Sonnet 5's $2/M + $10/M — a 5x cut on completion cost (the dominant cost
// on these long-output generations), at a context window (400K) comfortably
// larger than any prompt these routes send. Re-verify the same way if this
// ever 404s.
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
// - app/api/studio/generate/route.ts's Explication Ultra-Détaillée (all 3
//   generation shapes: the generic path, the fresh-generation-with-tagging
//   path, and the cross-university delta-chapter/wrapper calls in
//   lib/studio-explication-delta.ts) — explicit product decision to trade
//   ECONOMY_MODEL's (Gemini 3.7 Flash) proven JSON-escaping reliability for
//   CHEAP_MODEL's (DeepSeek V3.2) reputation for genuinely long, exhaustive
//   long-form writing at a LOWER $/M-token cost than ECONOMY_MODEL, not a
//   higher one. Not validated with a real test call before shipping (no
//   test budget was authorized) — this is exactly the "small sample" risk
//   pattern flagged above, on the single most rigor-critical content this
//   app produces. No `reasoning` option is set here, matching every other
//   CHEAP_MODEL call site in this file — if a truncation failure mode
//   analogous to ECONOMY_MODEL's hidden-reasoning-tokens bug ever surfaces
//   for this model, re-read this file's own `reasoning` option doc comment
//   below before assuming the same fix transfers as-is.
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
 * REAL BUG, not a misconfiguration of the timeout right above: Node's global
 * `fetch` (undici) enforces its OWN connect-PHASE timeout — 10 SECONDS BY
 * DEFAULT — completely independent of the AbortController/timeoutMs pair
 * every function below already sets up. A slow TCP/TLS handshake to
 * OpenRouter (a brief network hiccup, slow DNS, a congested link) fails with
 * `UND_ERR_CONNECT_TIMEOUT` well before DEFAULT_TIMEOUT_MS's own 240s abort
 * would ever fire — raising THAT timeout (the obvious first guess reading
 * this file) does nothing for this failure mode, since it bounds the whole
 * request including response streaming, not the initial connect. Fixed by
 * handing every fetch() call in this file (via fetchOpenRouterWithRetry
 * below) a custom undici Agent with a much longer connect timeout instead of
 * undici's global default. Scoped to this file's OWN dispatcher instance
 * (never `setGlobalDispatcher`) so this fix can't silently change
 * connect-timeout behavior for any other fetch call elsewhere in the app
 * (Supabase, web-push, etc.) — matching the actual ask (fix OpenRouter
 * calls), not a process-wide default.
 */
const OPENROUTER_CONNECT_TIMEOUT_MS = 60_000;
const OPENROUTER_DISPATCHER = new Agent({
  connect: { timeout: OPENROUTER_CONNECT_TIMEOUT_MS },
  // headersTimeout/bodyTimeout are undici's OTHER two built-in timeouts —
  // time-to-first-response-byte and max-gap-between-body-chunks,
  // respectively, both also defaulting to values this app never explicitly
  // chose. Matched to DEFAULT_TIMEOUT_MS so neither becomes a NEW, tighter,
  // undocumented ceiling underneath the one this file's callers already
  // reason about.
  headersTimeout: DEFAULT_TIMEOUT_MS,
  bodyTimeout: DEFAULT_TIMEOUT_MS,
});

// Bounded — a persistently broken network still fails (not an infinite
// retry loop), just after a couple of quick, cheap extra attempts instead of
// none. 1s flat backoff, not exponential: these are connect-phase hiccups
// expected to clear in well under a second, not rate-limit-style backpressure
// that would call for a longer/growing delay.
const OPENROUTER_MAX_NETWORK_RETRIES = 2;
const OPENROUTER_NETWORK_RETRY_DELAY_MS = 1000;

/**
 * True only for a genuine transient NETWORK failure (never reached the
 * server, or the connection itself dropped) — never for our own
 * AbortController firing (that already waited the full timeoutMs; retrying
 * it would just double the wait for no benefit) and never for an HTTP error
 * response (4xx/5xx), which every caller's own `res.ok` handling already
 * deals with on its own terms (e.g. 429 rate-limit surfaced to the student,
 * not silently retried here).
 */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  const code = (error as NodeJS.ErrnoException).code ?? (error.cause as NodeJS.ErrnoException | undefined)?.code;
  return (
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    error.message.includes("fetch failed")
  );
}

/**
 * Shared low-level fetch used by every OpenRouter call site in this file
 * (different URLs — chat completions vs. the transcription endpoint — and
 * different body shapes — JSON vs. multipart — so this only owns the two
 * infra concerns that are IDENTICAL across all of them and were previously
 * duplicated 5 times: attaching OPENROUTER_DISPATCHER above, and retrying a
 * genuine transient network failure a couple of times before giving up. Each
 * caller keeps building its own `init` (headers/body/signal) exactly as
 * before and still owns its own res.ok/response-shape handling untouched.
 *
 * `dispatcher` is a real, Node-fetch-supported RequestInit option that
 * lib.dom.d.ts's bundled RequestInit type (which @types/node's fetch typing
 * reuses) doesn't declare — same "runtime accepts a shape our stricter local
 * type doesn't" situation as this file's ContentBlock/ChatMessageInput casts
 * elsewhere, same fix (a type assertion at the one call site, not a wider
 * type change).
 *
 * Exported so any OTHER file that talks to an OpenRouter endpoint directly
 * (currently: lib/ai/embeddings.ts's getEmbedding, a different endpoint —
 * /embeddings, not /chat/completions or /audio/transcriptions — that used to
 * bypass this entirely with a bare, unguarded `fetch`) shares the exact same
 * fix instead of re-implementing (or worse, half-implementing) it.
 */
export async function fetchOpenRouterWithRetry(url: string, init: RequestInit): Promise<Response> {
  const initWithDispatcher = { ...init, dispatcher: OPENROUTER_DISPATCHER } as RequestInit;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, initWithDispatcher);
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt >= OPENROUTER_MAX_NETWORK_RETRIES) throw error;
      console.warn(
        `[openrouter] Échec réseau transitoire (tentative ${attempt + 1}/${OPENROUTER_MAX_NETWORK_RETRIES + 1}), nouvel essai dans ${OPENROUTER_NETWORK_RETRY_DELAY_MS}ms:`,
        error
      );
      await delay(OPENROUTER_NETWORK_RETRY_DELAY_MS);
    }
  }
}

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
    res = await fetchOpenRouterWithRetry(OPENROUTER_URL, {
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
    res = await fetchOpenRouterWithRetry(OPENROUTER_URL, {
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
    res = await fetchOpenRouterWithRetry(OPENROUTER_URL, {
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

      res = await fetchOpenRouterWithRetry(OPENROUTER_TRANSCRIPTION_URL, {
        method: "POST",
        // No Content-Type here — fetch sets the correct multipart boundary
        // itself from the FormData instance; setting it manually breaks it.
        headers: baseHeaders,
        body: form,
        signal: timeoutController.signal,
      });
    } else {
      res = await fetchOpenRouterWithRetry(OPENROUTER_TRANSCRIPTION_URL, {
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
    res = await fetchOpenRouterWithRetry(OPENROUTER_URL, {
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

// Fallback text extraction for uploaded documents that have NO real text
// layer (a scanned/photographed course, or a PDF "printed" from slides
// rather than natively exported — confirmed in production: a real 59-page
// course PDF extracted to 59 bytes of pure page-break characters via
// officeparser's normal, non-OCR text extraction). officeparser's OWN
// `ocr: true` option does NOT help here — its PDF parser's own source
// comment states OCR is not supported for PDF page images at all ("Tesseract.js
// requires encoded image files... To enable OCR, a PNG encoder would need to
// be added") — confirmed live: a real test against this exact file returned
// in 6.5s with ~0 chars extracted, consistent with that documented gap.
// Rather than building a local PDF-page-rasterization + PNG-encoding +
// Tesseract pipeline from scratch (real engineering cost AND a real risk of
// native-dependency breakage on Vercel's serverless runtime — explicitly the
// trade-off this approach was chosen to avoid), this uses OpenRouter's own
// `file-parser` plugin with the `mistral-ocr` engine: a real, documented,
// server-side PDF OCR service (https://openrouter.ai/docs/features/multimodal/pdfs),
// priced at $2/1,000 pages (~$0.0002/page) — no local rendering, no native
// deps, works on any model. Confirmed via OpenRouter's own docs (not
// guessed): the parsed result comes back in the assistant message's
// `annotations[].file.content` array, SEPARATE from whatever the model
// itself replies — so this never risks the model paraphrasing, summarizing,
// or truncating a long document while "reproducing" it; the parsed text is
// read directly, verbatim, regardless of how minimal a reply the model gives.
const OCR_MODEL = CHEAP_VISION_MODEL;

export interface PdfOcrResult {
  text: string;
  /** Number of `annotations[].file.content` text blocks concatenated — purely diagnostic (logged, not relied on for correctness). */
  blockCount: number;
}

/**
 * Extracts text from a PDF via OpenRouter's mistral-ocr file-parser plugin.
 * `fileUrl` must be a publicly reachable URL (this app's Supabase Storage
 * bucket for uploaded course sources is already public — see
 * lib/course-source-storage.ts) since OpenRouter's parser fetches it
 * server-side rather than accepting raw bytes inline for this shape.
 */
export async function extractPdfTextViaOcr(fileUrl: string, fileName: string, options?: { timeoutMs?: number }): Promise<PdfOcrResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError("OPENROUTER_API_KEY n'est pas configurée sur le serveur.", 500);
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchOpenRouterWithRetry(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Med Art AI",
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
        messages: [
          {
            role: "user",
            content: [
              // Minimal instruction — the model's OWN reply is discarded
              // entirely below; only the plugin-produced `annotations` are
              // read. maxTokens is kept small to bound the (separate, much
              // smaller) cost of the model actually reading/replying to
              // whatever gets injected into its context.
              { type: "text", text: "Confirme uniquement que le document a été reçu, en un mot." },
              { type: "file", file: { filename: fileName, file_data: fileUrl } },
            ],
          },
        ],
        max_tokens: 20,
      }),
      signal: timeoutController.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error(`OpenRouter PDF OCR timed out after ${timeoutMs}ms`);
      throw new OpenRouterError("L'extraction OCR met trop de temps. Réessaie dans un instant.", 504);
    }
    console.error("OpenRouter PDF OCR fetch failed", error);
    throw new OpenRouterError("L'appel au service OCR a échoué. Réessaie dans un instant.", 502);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = extractOpenRouterErrorDetail(body);
    console.error(`OpenRouter PDF OCR API error (${res.status})`, body.slice(0, 500));
    throw new OpenRouterError(`L'extraction OCR a échoué : ${detail}`, res.status);
  }

  const data = await res.json();
  logUsage(`extractPdfTextViaOcr model=${OCR_MODEL}`, data?.usage);

  const annotations = data?.choices?.[0]?.message?.annotations;
  const fileContent = Array.isArray(annotations)
    ? annotations.find((a: unknown) => (a as { type?: string })?.type === "file")?.file?.content
    : undefined;

  if (!Array.isArray(fileContent)) {
    console.error("OpenRouter PDF OCR returned no file annotation", JSON.stringify(data).slice(0, 500));
    throw new OpenRouterError("Le service OCR n'a renvoyé aucun contenu exploitable pour ce document.", 502);
  }

  const textBlocks = fileContent.filter((block: unknown) => (block as { type?: string })?.type === "text") as { text?: string }[];
  const text = textBlocks
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("\n\n")
    .trim();

  return { text, blockCount: textBlocks.length };
}
