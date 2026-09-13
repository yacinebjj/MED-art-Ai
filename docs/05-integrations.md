# 5. Third-Party Integrations

[← Back to index](./README.md)

---

## 5.1 OpenRouter — the AI gateway

**Every AI call in this application goes through `lib/ai/openrouter.ts`.** There
is no direct Anthropic/OpenAI/Google SDK anywhere. Adding one would bypass the
retry logic, the connection-pool fix, the timeout handling and the usage
logging — all of which exist because of production incidents.

### Exported entry points

| Function | Use |
|---|---|
| `callOpenRouter(messages, options)` | Standard non-streaming chat completion — the workhorse |
| `streamOpenRouter(...)` | Token-by-token streaming (chat surfaces) |
| `generateOpenRouterImage(...)` | Infographic generation |
| `generateOpenRouterAudio(...)` | Podcast narration (streamed PCM) |
| `transcribeAudioViaOpenRouter(...)` | Lecture-notes transcription |
| `extractPdfTextViaOcr(...)` | OCR fallback for scanned PDFs |
| `fetchOpenRouterWithRetry(url, init)` | Low-level shared fetch (exported so `lib/ai/embeddings.ts` shares the same hardening) |

### Model selection

| Constant | Model | Used for |
|---|---|---|
| `MODEL` | `anthropic/claude-sonnet-5` | Default for high-stakes generation |
| `HAIKU_MODEL` | `anthropic/claude-haiku-4.5` | Cheaper reasoning, vision |
| `CHEAP_MODEL` | `deepseek/deepseek-v3.2` | **The entire Explication pipeline** |
| `IMAGE_MODEL` | `google/gemini-3.1-flash-image-preview` | Infographics |

> **Model policy — do not change casually.** Model IDs were chosen after live
> comparison tests, not from spec sheets. One candidate that looked cheaper and
> faster on paper failed a live test outright (no response after 450s) while the
> incumbent completed the same prompt in 4.4s. **Never swap a model on
> documentation alone — run a real call on real content first.**

`CHEAP_MODEL` is always called with `reasoning: { effort: "low" }`. DeepSeek
V3.2 is a hidden-reasoning model: uncapped, it burns most of `maxTokens` on
invisible thinking before emitting a visible character, which silently truncates
the real answer.

### Three layers of timeout — all of which must be understood together

This is the subtlest part of the codebase and the source of its most expensive
bug.

| Layer | Constant | Guards |
|---|---|---|
| Connect phase | `OPENROUTER_CONNECT_TIMEOUT_MS` = 60s | TCP/TLS handshake (undici defaults to 10s — far too short) |
| Headers + body | `OPENROUTER_DISPATCHER_TIMEOUT_MS` = 250s | undici Agent-level backstop |
| Whole call | `options.timeoutMs` (`AbortController`) | The operative, per-caller ceiling |

**⚠️ The bug worth learning from.** `fetch()` resolves when response **headers**
arrive — roughly 2 seconds for OpenRouter. The model then streams the body for
*minutes*. The original code cleared its abort timer in a `finally` attached to
the fetch alone:

```ts
// ❌ THE BUG
try   { res = await fetchOpenRouterWithRetry(url, { signal }); }
finally { clearTimeout(timeoutId); }   // ← disarms the abort ~2s in
const data = await res.json();          // ← minutes, now completely unguarded
```

The consequence: `timeoutMs` was irrelevant to the phase where all the time was
actually spent. A call could only end by finishing, or by Vercel hard-killing
the invocation at the wall — which kills the route mid-flight, so no `catch` runs
and the client just sees the stream close with no error.

The fix keeps the timer armed across the body read:

```ts
// ✅ CORRECT
let data: any;
try {
  const res = await fetchOpenRouterWithRetry(url, { signal: timeoutController.signal });
  if (!res.ok) { /* … */ throw new OpenRouterError(detail, res.status); }
  data = await res.json();                 // still inside the guarded region
} catch (error) {
  if (error instanceof OpenRouterError) throw error;   // preserve real upstream status
  if (error?.name === "AbortError") throw new OpenRouterError("…", 504);
  throw new OpenRouterError("…", 502);
} finally {
  clearTimeout(timeoutId);
}
```

Note also that `OPENROUTER_DISPATCHER_TIMEOUT_MS` must sit **below** the route's
`maxDuration`. A backstop above the wall is not a backstop — the platform kills
the function before it can ever fire.

### A fresh undici Agent per call

`createOpenRouterDispatcher()` returns a **new** `Agent` for every request
rather than sharing a pooled one. A pooled keep-alive connection can go stale
across a serverless instance's freeze/thaw cycle: the remote end drops it while
the local socket still looks alive, and the next request hangs forever with no
error any timeout can catch. A fresh agent cannot go stale. The cost is one
extra TCP+TLS handshake per call — negligible against calls that take 60–260s.

### Never trust model output

Two independent guards run on every completion:

**1. Truncation detection.** OpenRouter returns `finish_reason: "length"` when
the response hit `max_tokens` mid-sentence. Without checking it, a truncated
answer is just a normal string and sails through as a success. It is now thrown
as a retryable `OpenRouterError` carrying an explicit `truncated: true` flag.

> The flag exists because status alone is ambiguous: truncation surfaces as 502
> like any other upstream error, but only truncation is fixed by asking for
> *less work* rather than retrying identically. Callers branch on
> `error.truncated`, never on message text.

**2. Schema validation.** Model JSON is validated with Zod before it touches the
database:

```ts
const result = resolveStudioSchema(actionType, studyYear).safeParse(parsed);
if (!result.success) { /* log fieldErrors, throw retryable */ }
```

### System prompts

Prompts live in `lib/ai/*-prompts.ts`, never inline in a route. The Explication
prompt in particular demands exhaustive, simplified, zero-prerequisite
explanation — and this has a direct engineering consequence, covered next.

---

## 5.2 The Explication pipeline

The flagship feature, and the one with the most non-obvious engineering. Read
this before touching anything in `lib/studio-explication-*.ts`.

### Why it is split into parts

A full "ultra-detailed explanation" is far longer than one serverless
invocation can produce. So the source text is sliced, and **each slice is its
own HTTP request, sequenced from the browser**:

```
explication-start   → reserves quota ONCE, returns totalParts
explication-part    → × N, sequential, independently retryable, no quota
explication-finalize→ assembles + persists
explication-abandon → refunds if the run gives up
```

### The heartbeat protocol

Each part streams **NDJSON** over one held-open connection:

```
{"type":"heartbeat"}                                   ← every 15s
{"type":"heartbeat"}
{"type":"result","success":true,"partMarkdown":"…"}    ← always the last line
```

Always HTTP 200, because the real outcome is unknown when headers are sent. The
logical status rides in the final line's `status` field;
`lib/heartbeat-fetch.ts` reads *that*, not the transport status.

The heartbeat exists because a mobile carrier's NAT drops an idle TCP connection
after 30–120s of silence, and a part legitimately generates for minutes with no
bytes flowing. Real bytes every 15s defeats that entirely.

### The lesson about generation time

The pipeline repeatedly timed out at ~200s. The instinct — "slice the input
smaller" — was tested and **falsified**: a full slice timed out at ~200s, its
half timed out at ~200s, and its quarter (~1,500 characters) *also* timed out at
~200s.

Generation time was not proportional to input size. The arithmetic explained
why: `14,000 max_tokens ÷ 200s = 70 tok/s`, which is DeepSeek V3.2's real
throughput. The model was generating flat out to the token ceiling on every
call regardless of input — because the system prompt orders it to
(*"ne t'arrête JAMAIS par souci de longueur… sans plafond réel"*), and the
per-part correction asked it not to "inflate artificially" without ever naming
a number.

**So the operative lever is the output budget, not the input size.**
`buildPartLengthBudget(sliceLength)` now states a concrete word target and hard
ceiling in the prompt, explicitly overriding the global mandate for that part.

| Knob | Value | Reason |
|---|---|---|
| `CHUNKED_SLICE_CHARS` | 6,000 | Source covered per part |
| `buildPartLengthBudget` | ~2,220 words target / ~2,997 ceiling for a full slice | Bounds real generation time |
| `EXPLICATION_PART_MAX_TOKENS` | 8,000 | ~2,300 tokens of headroom above the authorized ceiling |
| `EXPLICATION_PART_TIMEOUT_MS` | 200,000 | Clean, retryable failure well under the 280s wall |
| `maxDuration` (route) | 280 | Measured platform ceiling |

Total document length is *not* reduced: a long course simply has more parts
(~22,200 words for a 60,000-character course).

> **Tokens-per-word matters.** Budgets are calibrated at **~1.9 tokens per
> French word** — medical French tokenizes worse than English. An earlier pass
> used ~1.44 and produced an authorized ceiling that *exceeded* the cap.

### Client-side recovery

`lib/studio-explication-client.ts` chooses recovery by failure type:

| Failure | Response | Why |
|---|---|---|
| **504** (generation timeout) | Subdivide: whole → halves → quarters → eighths | Systematic. An identical retry hits the same wall |
| **`truncated: true`** (hit `max_tokens`) | Subdivide, same as above | Systematic. Deterministic against the same ceiling |
| Network drop / 5xx / 401 race | Retry identically, exponential backoff (2s/6s/18s) | Genuinely transient |
| 4xx (except 401) | Fail immediately | Retrying a malformed request wastes attempts |

Progress is reported through `onProgress` so the UI can render
`Partie 3/7 · tentative 2` instead of appearing frozen — retries that nobody can
see are indistinguishable from a hang, which caused a real "it didn't retry" bug
report about logic that *was* retrying.

---

## 5.3 Chargily Pay V2

`lib/chargily.ts` exposes two functions:

| Function | Purpose |
|---|---|
| `createChargilyCheckout(params)` | Creates a hosted checkout, returns `{ id, checkout_url }` |
| `verifyChargilySignature(rawBody, signatureHeader)` | HMAC verification for webhooks |

### Checkout

`app/api/chargily/checkout/route.ts`:

1. `getAuthenticatedUser()` → 401
2. `rateLimit(…, RATE_LIMITS.mutation)` → 429 *(this route hits a live payment
   API and writes a row on every call; it must never be unthrottled)*
3. Validate the plan id (`isPlanId`, `isPaidPlanId`)
4. `createChargilyCheckout({ amount, successUrl, failureUrl, webhookEndpoint, metadata: { userId, plan, email } })`
5. Insert a `payments` row with `status: "pending"` (best-effort — a Supabase
   hiccup must not block a checkout Chargily already created)
6. Return `{ checkoutUrl }`

### Webhook — the only source of truth

`app/api/chargily/webhook/route.ts` is intentionally **unauthenticated by
session** — Chargily calls it server-to-server. It is protected by HMAC:

```ts
const signature = request.headers.get("signature");
if (!verifyChargilySignature(rawBody, signature)) {
  console.warn("Chargily webhook: invalid signature");
  return /* 401 */;
}
```

> The **raw** body must be verified, before JSON parsing — re-serializing changes
> the bytes and breaks the signature.

On a valid `checkout.paid` event it marks the payment paid and upserts the
subscription.

> ⚠️ **Entitlement is granted here and nowhere else.** The browser landing on
> `/dashboard/billing?status=success` is a UI hint only — anyone can type that
> URL. Never grant access from a client-side redirect.

### Environment

| Variable | Notes |
|---|---|
| `CHARGILY_SECRET_KEY` | `test_sk_…` while integrating, `live_sk_…` in production. **Server-only** |
| `CHARGILY_API_BASE` | Test: `https://pay.chargily.net/test/api/v2` · Live: `https://pay.chargily.net/api/v2` |
| `APP_URL` | Required in production — Chargily cannot reach a webhook on `localhost` |

---

## 5.4 Google Drive import

Students import source documents straight from Drive.

**Architecture note:** this used to embed Google's hosted Picker widget in an
iframe. That was removed. Two limitations were unfixable from our side: with
third-party cookies blocked (now the Chrome default) the Picker's internal
account chooser rendered a dead "Sign in" box, and its layout is not responsive
below tablet width.

The current design talks to the **Drive REST API directly**:

1. `requestAccessToken()` (`lib/google-drive-picker.ts`) opens Google Identity
   Services' OAuth **popup** — a real top-level window, not an iframe, so the
   third-party-cookie problem does not apply.
2. `listDriveFiles(accessToken, opts)` calls
   `GET https://www.googleapis.com/drive/v3/files` with a Bearer token.
3. `components/dashboard/DriveBrowser.tsx` renders our own responsive UI
   (Récents / Mon Drive / Partagés avec moi, folder navigation, search).
4. On selection, `POST /api/drive/import` downloads the file server-side,
   extracts text, and returns it.

**Consequences worth knowing:**

- Scope is `drive.readonly` (not `drive.file`) — required to *list* files the
  user has not explicitly picked.
- Only a **Client ID** is needed. No API key, no "Google Picker API" enablement.
- The OAuth popup must be opened **synchronously** inside the click handler.
  `preloadGoogleDriveScripts()` loads the GIS script when the modal opens, so
  the handler has no `await` before `requestAccessToken()` — several mobile
  browsers revoke popup permission across an async gap.
- A 401 mid-session throws `DriveAuthExpiredError` so the UI can offer
  "Se reconnecter" instead of a dead end; `/api/drive/import` returns
  `authExpired: true` for the same reason.
- The import route enforces a 100 MB cap (`Content-Length` *and* actual buffer
  length).

[Next: Contribution Guidelines →](./06-contributing.md)
