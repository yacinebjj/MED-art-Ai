# 2. System Architecture & Data Flow

[← Back to index](./README.md)

---

## 2.1 The layers

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER                                                     │
│  React 18 · Tailwind · providers (Theme, Language, Toast,    │
│  Pomodoro, Auth)                                             │
│                                                              │
│  ├─ Server Components ── rendered on Vercel, no client JS    │
│  └─ Client Components ── state, effects, fetch()             │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼──────────────────────────────────────────────┐
│  middleware.ts  (runs on every non-/api request)             │
│  └─ refreshes the Supabase session cookie                    │
│  └─ redirects unauthenticated users away from /dashboard,    │
│     /study                                                   │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│  app/api/**/route.ts   — 80 handlers                         │
│                                                              │
│  Standard gate order:                                        │
│    1. getAuthenticatedUser()      → 401                      │
│    2. rateLimit()                 → 429                      │
│    3. body parse + validate       → 400                      │
│    4. ownership check (user_id)   → 404                      │
│    5. reserveGeneration()         → 403   (AI routes only)   │
│    6. …do the work…                                          │
│    7. refundGeneration() on failure                          │
└───┬───────────────┬───────────────┬──────────────┬───────────┘
    │               │               │              │
┌───▼────┐  ┌───────▼──────┐  ┌─────▼──────┐  ┌────▼─────────┐
│Supabase│  │  OpenRouter  │  │  Chargily  │  │ Google Drive │
│ PG +   │  │  all AI gen  │  │  Pay V2    │  │  REST v3     │
│ Storage│  │              │  │            │  │              │
└────────┘  └──────────────┘  └────────────┘  └──────────────┘
```

---

## 2.2 The canonical request: generating a Studio section

This is the path most of the product runs through. Walk it once and the rest of
the codebase reads easily.

**Scenario:** a student opens a course and taps **Résumé**.

### Step 1 — Client initiates

`app/dashboard/module/[id]/page.tsx` (a client component) calls its
`handleGenerate` flow, which marks the section as generating in local state so
the tile shows a spinner, then `POST`s to `/api/studio/generate`.

The generation promise is registered with `trackGeneration(...)` so it
**survives navigation** — the student can leave the page and the request keeps
running.

### Step 2 — Middleware refreshes the session

`middleware.ts` → `lib/supabase/middleware.ts::updateSession()` refreshes the
auth cookie.

> Note the matcher deliberately **excludes `/api/**`**. Every API route does its
> own auth via `getAuthenticatedUser()`, which refreshes as needed. Having
> middleware *also* refresh on API calls created two concurrent rotations of the
> same single-use refresh token — the confirmed cause of
> `Invalid Refresh Token: Already Used`.

### Step 3 — The route handler's gate sequence

`app/api/studio/generate/route.ts`:

```ts
const user = await getAuthenticatedUser();          // 401 if absent
if (!user) return NextResponse.json({ success: false, error: "…" }, { status: 401 });

const rl = rateLimit(`studio-generate:${user.id}`, RATE_LIMITS.ai);
if (!rl.allowed) return NextResponse.json(…, { status: 429, headers: { "Retry-After": … } });

// body parse → 400 on malformed JSON
// field validation → 400
// ownership: .eq("id", courseId).eq("user_id", user.id) → 404
// reserveGeneration(user) → 403 if over plan quota
```

### Step 4 — Cache before spend

Before any billed call, the route checks the cross-student content cache
(`lib/studio-content-cache.ts`), keyed by
`sha256(normalizeText(sourceText))`. A hit returns instantly, **consumes no
quota**, and costs nothing.

This is why the same course uploaded by two students only ever generates once.

### Step 5 — The AI call

`callOpenRouter(messages, { model, maxTokens, timeoutMs, reasoning })` in
`lib/ai/openrouter.ts`. See [§5](./05-integrations.md) for its internals — the
timeout semantics there are subtle and were a real production bug.

### Step 6 — Validate, then persist

The model's JSON is parsed and **validated with Zod** before touching the
database:

```ts
const result = resolveStudioSchema(actionType, studyYear).safeParse(parsedValue);
if (!result.success) { /* log fieldErrors, throw retryable */ }
```

Then written to the `studio_courses` row (one column per section), and stored in
the content cache for the next student.

### Step 7 — Response and UI reconciliation

The route returns `{ success: true, data, cached }`. The client writes the
result into `courseCacheRef` keyed by `courseId` — deliberately **not** into the
`activeCourse` closure, because the student may have switched courses while the
generation ran.

---

## 2.3 The exception: the Explication pipeline

"Explication Ultra-Détaillée" is the one flow that does **not** fit the pattern
above, because its output is far too large for a single invocation. It is worth
understanding separately — see
[§5](./05-integrations.md#the-explication-pipeline) for the full mechanics.

```
Browser (lib/studio-explication-client.ts)  ── orchestrates the whole run
   │
   ├─1─► POST /api/studio/generate/explication-start
   │       reserves quota ONCE · returns { totalParts }
   │       (or resolves instantly from cache / cross-university delta)
   │
   ├─2─► POST /api/studio/generate/explication-part   × N, sequential
   │       NDJSON stream: {"type":"heartbeat"} every 15s
   │                      {"type":"result", …} last line
   │       each part independently retryable; never touches quota
   │
   └─3─► POST /api/studio/generate/explication-finalize
           assembles + persists the collected parts
       (on give-up: POST …/explication-abandon → refunds the reservation)
```

**Why the browser orchestrates instead of the server:** a server-side loop over
N parts would be one invocation, and would hit the execution wall (§1.4). One
HTTP request per part means each is independently bounded and independently
retryable, and a completed part is never regenerated because a later one failed.

**Quota integrity:** reservation happens *only* in `explication-start`, which is
never retried. `explication-part` touches quota at all — deliberately, because
the client retries it freely. An earlier version reserved inside the retried
step and charged students 2–3× for one delivered generation.

---

## 2.4 Payment data flow

```
Student clicks a paid plan
   └─► POST /api/chargily/checkout
         ├─ auth + rate limit
         ├─ createChargilyCheckout()  → Chargily API
         ├─ INSERT payments (status: "pending")
         └─ returns { checkoutUrl }
   └─► browser redirects to Chargily's hosted page
         … student pays on Chargily …
   └─► Chargily calls POST /api/chargily/webhook   (server-to-server)
         ├─ verifyChargilySignature(rawBody, signature)   ← HMAC, not session auth
         ├─ UPDATE payments  status → paid
         └─ UPSERT subscriptions  (activates the plan)
```

The webhook is the **only** source of truth for activation. The browser
returning to `/dashboard/billing?status=success` is a UI hint, never a grant of
entitlement — a user can navigate to that URL directly.

---

## 2.5 Cross-cutting concerns

| Concern | Implementation | Location |
|---|---|---|
| Auth gate | `getAuthenticatedUser()` — 74 of 80 routes | `lib/supabase/session-server.ts` |
| Rate limiting | In-memory fixed-window, tiered presets | `lib/rate-limit.ts` |
| Plan quota | `reserveGeneration()` / `refundGeneration()` | `lib/subscription.ts` |
| Content caching | sha256 of normalized source text | `lib/studio-content-cache.ts` and siblings |
| Error surface | French, user-facing; internals to `console.error` only | per route |
| Security headers | CSP, X-Frame-Options, nosniff, Referrer-Policy | `next.config.mjs` |

### The six routes without an auth gate — all intentional

| Route | Why it is exempt | What protects it instead |
|---|---|---|
| `api/chargily/webhook` | Called by Chargily, not a user | HMAC signature verification |
| `api/push/dispatch` | Called by an external cron | `Authorization: Bearer $CRON_SECRET` |
| `api/curriculum/*` (4) | Public reference catalogue (specialties, years, teaching units, modules) | Contains no user data — no `user_id` column on any of these tables |

If you add a seventh unauthenticated route, it needs an equally specific answer
to "what protects it instead".

### Rate limiting — a documented limitation you will eventually hit

`lib/rate-limit.ts` is an **in-process `Map`**. It is a correct hard limit only
while the app runs as a single process. On Vercel, each concurrent serverless
instance gets its own map, so the effective ceiling is
`limit × number of instances`.

This is knowingly accepted for now and flagged in the file itself, with a
drop-in Upstash Redis migration sketched out. The call signature
`rateLimit(key, config)` is designed so the swap touches only that one file —
though it makes the function `async`, which means auditing all 80 call sites.

[Next: Project Directory Map →](./03-directory-map.md)
