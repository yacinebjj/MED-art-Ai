# MedArt AI
## The Master Technical Handbook & Architecture Book

---

**An engineering reference for the MedArt AI platform**
*An autonomous AI study environment for Algerian medical, pharmacy and dental students*

| | |
|---|---|
| **Document type** | Engineering handover reference |
| **Intended reader** | Senior Software Engineer assuming ownership |
| **Prerequisite knowledge** | TypeScript, React, SQL, HTTP |
| **Production URL** | `https://med-art-ai-febc.vercel.app` |
| **Repository** | `yacinebjj/MED-art-Ai` — branch `main` |
| **Status** | Live in production |

---

### How to read this book

This document describes the system **as it actually is**, measured from the
source, not as it was sketched on a whiteboard. Every number in it — table
counts, route counts, timeouts, token budgets — was extracted from the codebase
rather than estimated.

Where a design looks strange, there is almost always a production incident
behind it. Those incidents are documented, with their causes, because the single
most expensive thing a new engineer can do here is rediscover them.

Two rules will save you more time than anything else in this book:

> **Rule 1 — Read the comment before changing the constant.**
> Several timeouts, token ceilings and slice sizes look arbitrary. They are not.
> Each was measured against Vercel's real execution wall and the model's real
> throughput, and each carries a comment recording what broke last time.

> **Rule 2 — Measure before you recalibrate.**
> The most costly bugs in this project's history came from tuning a value
> against an *assumed* platform limit. Every limit documented here was
> empirically measured, and the measurement method is included so you can
> repeat it on a different plan or provider.

<div style="page-break-after: always;"></div>

---

## Table of Contents

**Part 1 — System Overview & Architecture**
- 1.1 The product
- 1.2 Language and strictness
- 1.3 Framework: Next.js App Router
- 1.4 Server Components vs Client Components
- 1.5 The constraint that shapes everything: the execution wall
- 1.6 End-to-end data flow
- 1.7 The five non-negotiable invariants

**Part 2 — Directory Structure & Taxonomy**
- 2.1 Top-level layout
- 2.2 `app/` — routes, pages, API
- 2.3 `lib/` — the brain
- 2.4 `components/`, `providers/`, `hooks/`, `types/`
- 2.5 Naming conventions
- 2.6 Where does a new file go?

**Part 3 — Backend & Database Architecture**
- 3.1 The three Supabase clients
- 3.2 The service-role trap
- 3.3 The 44-table schema
- 3.4 Relationships and the entity graph
- 3.5 Row Level Security
- 3.6 The 43 Postgres functions
- 3.7 API surface: 80 route handlers
- 3.8 The standard gate order
- 3.9 Validation and error handling

**Part 4 — Deep-Dive Third-Party Integrations**
- 4.1 OpenRouter: the AI gateway
- 4.2 The three-layer timeout model
- 4.3 Token economics and the French tokenization ratio
- 4.4 The Explication pipeline
- 4.5 Subdivision and truncation recovery
- 4.6 Chargily Pay V2
- 4.7 Google Drive import

**Part 5 — Error Handling, Security & Deployment**
- 5.1 Error Boundaries
- 5.2 Security posture
- 5.3 Environment variables
- 5.4 Rate limiting
- 5.5 Deployment and verification

**Part 6 — Developer Onboarding & Roadmap**
- 6.1 Local setup
- 6.2 Commands and quality gates
- 6.3 Adding a feature, end to end
- 6.4 Technical debt register
- 6.5 Roadmap
- 6.6 Reading order

**Appendices**
- A. Environment variable matrix
- B. API endpoint index
- C. Incident log
- D. Glossary

<div style="page-break-after: always;"></div>

---

# Part 1 — System Overview & Architecture

## 1.1 The product

MedArt AI transforms a student's own course material — a PDF, a DOCX, a
photographed handout — into a complete study environment. A student uploads a
course; the platform generates, on demand:

| Feature | Output |
|---|---|
| **Explication Ultra-Détaillée** | An exhaustive, zero-prerequisite explanation of the whole course |
| **Résumé** | A condensed revision summary |
| **Cas Cliniques** | Simulated clinical cases with full diagnostic reasoning |
| **Examen QCMs** | Residency-level multiple-choice questions with per-option explanations |
| **Exemples & Analogies** | Simplified analogies for difficult concepts |
| **Infographie** | A generated visual mind-map |
| **Podcast Audio** | A narrated audio version |
| **Flashcards + SRS** | Spaced-repetition deck with mastery tracking |
| **Exam Generator** | Full mock exams, optionally mimicking a reference exam's style |
| **Course Chat** | RAG-grounded conversation about the student's own course |
| **Study Planner, Notes, Group Chat** | Supporting study tools |

The audience is specific: Algerian students in **Médecine**, **Pharmacie** and
**Chirurgie Dentaire**. This drives three engineering constraints that recur
throughout this book:

1. **The interface language is French**, and generated content is French (with
   optional English). This has a real technical consequence — see §4.3 on
   tokenization.
2. **Payments must be local** — Edahabia and CIB cards, via Chargily Pay V2.
   Stripe is not an option for this market.
3. **Mobile networks are unreliable**, which shaped the streaming protocol
   described in §4.4.

### Measured scale

| Metric | Count |
|---|---|
| API route handlers (`app/api/**/route.ts`) | 80 |
| Pages (`page.tsx`) | 21 |
| React components | 137 |
| Library modules (`lib/**/*.ts`) | 117 |
| Custom React hooks | 9 |
| Context providers | 7 |
| Shared type modules | 7 |
| PostgreSQL tables | 44 |
| Tables with RLS enabled | 44 (100%) |
| RLS policies | 46 |
| Postgres functions (RPC) | 43 |
| Files marked `"use client"` | 155 |

---

## 1.2 Language and strictness

The codebase is **TypeScript** targeting ES2017, compiled by SWC through
Next.js.

### Why TypeScript here specifically

The domain has many structurally similar but semantically distinct shapes: a
QCM, an exam question, a flashcard and a clinical case all contain question-like
text with explanations. They are *not* interchangeable. Structural typing
catches drift between the three places this app most often breaks:

1. What the AI model returns (JSON, unvalidated)
2. What the database column stores (`jsonb`)
3. What the React component expects (props)

### Strict mode, and how it is enforced

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2017",
    "strict": true,              // ← the whole strict family
    "noEmit": true,              // tsc type-checks only; SWC compiles
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  }
}
```

`"strict": true` enables `strictNullChecks`, `noImplicitAny`,
`strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`,
`noImplicitThis` and `alwaysStrict`.

Two consequences worth internalising:

**`noEmit: true` makes `tsc` a linter, not a build step.** Next.js compiles with
SWC and runs its own type-check pass during `next build`. Therefore
`npx tsc --noEmit` is the *fast* gate and `npm run build` is the *authoritative*
one. A clean `tsc` does not guarantee a clean build.

**The `@/*` alias is mandatory by convention.** There are no relative parent
imports anywhere in the codebase. If you are writing `../../lib/...`, you are in
the wrong directory.

### The `any` audit — measured, not assumed

A standard handover fear is "the codebase is riddled with `any`". Measured
across all source directories:

| Directory | Occurrences |
|---|---|
| `lib/` | 18 |
| `app/` | 6 |
| `components/` | 2 |
| `providers/` | 0 |
| `hooks/` | 0 |
| `types/` | 0 |
| **Total** | **26** |

Across roughly 380 source files this is a low density, and the concentrations
are deliberate rather than lazy:

| Location | Count | Justification |
|---|---|---|
| `lib/supabase/server.ts` | 3 | The admin client is `SupabaseClient<any, any, any>` because this project does not run `supabase gen types`. Adopting generated types changes this one file and tightens everything downstream. |
| `lib/ai/openrouter.ts` | 5 | Third-party JSON before validation. These are genuine parse boundaries — the value *is* unknown until checked. |
| `lib/google-drive-picker.ts` | 2 | Google's `window.google` global SDK ships no types. |

> **Policy for new code:** `any` is acceptable **only** at an I/O boundary, and
> only until the value is validated. Once validated it must have a real type.
> Prefer a Zod schema over a hand-written interface for anything crossing a
> network boundary.

### Where types live

| Kind | Location | Purpose |
|---|---|---|
| Shared domain models | `types/*.ts` (7 files) | What the application *believes* |
| Runtime validation | `lib/ai/*-schemas.ts` (Zod) | What the application will *accept* from a model |
| Module-local | Declared in place | Row shapes, component props |

The distinction matters: `types/` is compile-time belief; `lib/ai/*-schemas.ts`
is runtime defence. Model output is never written to the database without a
`safeParse`.

---

## 1.3 Framework: Next.js App Router

Next.js 14 with the App Router. The decisive advantage for this project is
**per-route runtime configuration**:

```ts
export const runtime = "nodejs";   // not edge — needs Buffer, undici Agent, officeparser
export const maxDuration = 280;    // seconds — measured, see §1.5
```

Most applications never touch these. This one depends on them, because AI
generation legitimately runs for minutes.

`runtime = "nodejs"` is mandatory (not stylistic) on any route performing
document extraction or using the custom undici dispatcher — the Edge runtime
provides neither `Buffer` nor the undici `Agent` API.

### Rendering modes actually in use

| Mode | Where | Notes |
|---|---|---|
| Static (SSG) | `/`, `/login`, `/register`, `/pricing` | Prerendered at build time |
| Dynamic SSR | `/dashboard/module/[id]`, `/study`, group pages | Per-request, session-dependent |
| Client-driven | All Studio generation, chat, exam runner | `fetch()` → `/api/**` |
| Custom streaming | Explication parts, podcast | NDJSON heartbeat protocol (§4.4) |

---

## 1.4 Server Components vs Client Components

155 files carry `"use client"`. That proportion is high, and it is worth
understanding *why* before attempting to "optimise" it.

MedArt AI is not a content site. Its core surfaces — the Studio workspace, the
chat panel, the exam runner, the flashcard deck — are **stateful, long-lived,
interactive views**. A generation runs for minutes while the student navigates
elsewhere; that state lives in React. Those components are legitimately client
components.

Server Components are used where they actually pay:

- **Page shells and metadata.** `app/(auth)/login/page.tsx` is a Server
  Component exporting `metadata`, rendering a client `<LoginForm/>` inside
  `<Suspense>`.
- **Static presentation.** `app/not-found.tsx` ships zero client JavaScript.

### The boundary rule

> Push `"use client"` **down**, never up. A page should be a Server Component
> rendering a small client island — not a client component wrapping the entire
> tree.
>
> When adding a component ask: *does this need state, effects, or event
> handlers?* If not, leave it on the server.

### The one mistake that leaks secrets

`lib/supabase/server.ts` exports `getSupabaseAdmin()`, which reads
`SUPABASE_SERVICE_ROLE_KEY`. It must **never** be imported — even transitively,
through a chain of helper modules — from a file carrying `"use client"`, or the
key is bundled into the browser.

Treat any import path that can reach `lib/supabase/server.ts` as strictly
server-only.

---

## 1.5 The constraint that shapes everything: the execution wall

You cannot understand this architecture without this fact.

> **A Vercel serverless invocation is hard-killed at its `maxDuration`.**
> Not warned — killed. No `catch` runs, no `finally` runs, no response is
> written. The client simply observes the connection close.

This was measured empirically on this project's own plan using a throwaway
diagnostic route (deployed, measured, deleted):

| Test | `maxDuration` | Result |
|---|---|---|
| 270 s sleep | 280 | ✅ HTTP 200 |
| 277 s sleep | 280 | ✅ HTTP 200 |
| 285 s sleep | 280 | ❌ `FUNCTION_INVOCATION_TIMEOUT` at **280.88 s** |

The wall is real, precise, and enforced at exactly the declared value.

### Three architectural consequences

1. **Long generations are split across multiple HTTP requests**, sequenced from
   the **browser** rather than looped on the server. One request per part.
2. **Every long request streams a heartbeat**, so no intermediary sees an idle
   connection.
3. **Every in-request timeout sits meaningfully below the wall**, so an overrun
   produces a clean, retryable error instead of a silent kill.

> **Historical note, recorded so it is not relearned.** Background execution via
> `waitUntil` was implemented and then abandoned. A pure background *timer* runs
> reliably for 240 s+, but a real OpenRouter fetch inside `waitUntil` hung
> indefinitely on this account — over 450 s, never resolving, not even into its
> own internal timeout. The foreground, heartbeat-streamed design is the only
> one proven to work here. Do not "simplify" it back into a background job
> without repeating that experiment.

---

## 1.6 End-to-end data flow

```
┌──────────────────────────────────────────────────────────────────┐
│ BROWSER — React 18, Tailwind                                     │
│ Providers: Theme → Language → Pomodoro → Tooltip → Toast →       │
│            Push → Security                                       │
│                                                                  │
│  Server Components ─── rendered on Vercel, zero client JS        │
│  Client Components ─── state, effects, fetch()                   │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼──────────────────────────────────────┐
│ middleware.ts — every non-/api request                           │
│   • refreshes the Supabase session cookie                        │
│   • redirects unauthenticated users away from /dashboard, /study │
│   • redirects authenticated users away from /login, /register, / │
│                                                                  │
│   Matcher deliberately EXCLUDES /api/**  (see §3.7)              │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│ app/api/**/route.ts — 80 handlers                                │
│                                                                  │
│   1. getAuthenticatedUser()   → 401                              │
│   2. rateLimit()              → 429 + Retry-After                │
│   3. parse + validate body    → 400                              │
│   4. ownership check          → 404                              │
│   5. reserveGeneration()      → 403      (AI routes)             │
│   6. cache lookup             → instant return, no quota         │
│   7. the actual work                                             │
│   8. validate output (Zod)    → retryable error                  │
│   9. persist + cache                                             │
│  10. refundGeneration() on failure                               │
└───┬──────────────┬───────────────┬────────────────┬──────────────┘
    │              │               │                │
┌───▼──────┐ ┌─────▼──────┐ ┌──────▼─────┐ ┌────────▼────────┐
│ Supabase │ │ OpenRouter │ │  Chargily  │ │  Google Drive   │
│ Postgres │ │  all AI    │ │  Pay V2    │ │  REST v3        │
│ Storage  │ │            │ │            │ │                 │
│ Auth     │ │            │ │            │ │                 │
│ Realtime │ │            │ │            │ │                 │
└──────────┘ └────────────┘ └────────────┘ └─────────────────┘
```

### A worked trace: generating a "Résumé"

| Step | Component | What happens |
|---|---|---|
| 1 | `app/dashboard/module/[id]/page.tsx` | Client marks the section generating; `trackGeneration()` registers the promise so it **survives navigation** |
| 2 | `middleware.ts` | Session cookie refreshed |
| 3 | `app/api/studio/generate/route.ts` | Auth → rate limit → validation → ownership → quota reservation |
| 4 | `lib/studio-content-cache.ts` | Cache probed by `sha256(normalizeText(sourceText))`. **A hit returns instantly and consumes no quota** |
| 5 | `lib/ai/openrouter.ts` | `callOpenRouter(...)` — the billed call |
| 6 | `lib/ai/studio-schemas.ts` | `resolveStudioSchema(...).safeParse(...)` before any write |
| 7 | Supabase | Written to the matching `studio_courses` column; stored in the cross-student cache |
| 8 | Client | Result written into `courseCacheRef` keyed by `courseId` — **not** the `activeCourse` closure, which may have changed |

Step 4 is why the same course uploaded by two students only ever generates once.
Step 8 is why switching courses mid-generation does not corrupt state.

---

## 1.7 The five non-negotiable invariants

These are enforced by convention and review, not by the compiler. Violating any
of them causes either data leakage or a billing incident.

| # | Invariant | Why |
|---|---|---|
| **1** | The service-role client bypasses RLS. **Every route using it must scope its own queries by `user_id`.** | RLS protects the *anon* key, not server code. Omitting the scope is an IDOR — this has happened (§C.1) |
| **2** | Never expose a non-`NEXT_PUBLIC_` variable to the client | `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `CHARGILY_SECRET_KEY` |
| **3** | Quota is reserved **exactly once** per delivered generation, before the expensive call, and refunded on failure | Reserving inside a retried step charged students 2–3× (§C.4) |
| **4** | **No AI call without a rate limit** | Cost exhaustion by a single scripted account |
| **5** | **Never send a course's full `raw_text` to the chat model** — retrieval is top-K chunks only | The full-text fallback drove a ~$0.04/message cost incident and was removed deliberately |

<div style="page-break-after: always;"></div>

---

# Part 2 — Directory Structure & Taxonomy

## 2.1 Top-level layout

```
med-art-ai/
├── app/              Next.js App Router — pages, layouts AND API routes
├── components/       React components, grouped by feature (137)
├── lib/              All business logic and integrations (117)
├── hooks/            Reusable React hooks (9)
├── providers/        Context providers mounted in the root layout (7)
├── types/            Shared domain types (7)
├── supabase/         schema.sql — authoritative database definition
├── scripts/          One-off maintenance scripts (not deployed)
├── public/           Static assets, PWA manifest, service worker
├── docs/             This handbook
├── next.config.mjs   Security headers, build config
├── middleware.ts     Session refresh + route protection
└── tsconfig.json
```

> **The mental model:** `lib/` is the brain, `app/` is the delivery mechanism,
> `components/` is the face. Any logic that could plausibly be called from two
> different routes belongs in `lib/`, never inside a route handler.

---

## 2.2 `app/` — routes, pages and API

```
app/
├── layout.tsx            Root layout: fonts + every provider
├── page.tsx              Public landing page
├── globals.css           Tailwind layers + design tokens
├── error.tsx             Route-segment Error Boundary
├── global-error.tsx      Root-layout Error Boundary (renders its own <html>)
├── not-found.tsx         Styled 404
│
├── (auth)/               ROUTE GROUP — parentheses produce no URL segment
│   ├── login/            → /login
│   └── register/         → /register
│
├── auth/callback/        Supabase email-confirmation handler (a real URL)
│
├── dashboard/
│   ├── layout.tsx
│   ├── loading.tsx
│   ├── (shell)/          Pages sharing the sidebar/topbar chrome
│   ├── module/[id]/      The Studio workspace — the app's centre of gravity
│   ├── workspace/
│   ├── audio-workspace/
│   ├── search/
│   └── demo/
│
├── study/                Full-page SRS runner (no dashboard chrome)
├── pricing/
│
└── api/                  80 route handlers
    ├── studio/           Studio generation — the core AI product
    ├── exam/             Exam generator and attempts
    ├── flashcards/       Spaced-repetition deck
    ├── srs/              SRS attempts and mastery
    ├── courses/          Course chat (RAG)
    ├── notes/ groups/ study-planner/ lecture-notes/ todo-adjacent tools
    ├── chargily/         checkout + webhook
    ├── drive/            Google Drive import
    ├── curriculum/       Public reference catalogue
    ├── upload/           Signed-URL upload + finalize
    ├── push/             Web Push subscribe/dispatch
    └── profile/ search/ subscription/ workspace/ assistant/ modules/ highlights/ generate/
```

### Route groups

`(auth)` and `(shell)` are **route groups** — the parentheses keep them out of
the URL. `app/(auth)/login/page.tsx` serves `/login`, **not** `/auth/login`.

> This regularly confuses newcomers searching the tree. `app/login/` does not
> exist. The login page is at `app/(auth)/login/page.tsx`.

### Next.js special files

| File | Purpose | Environment |
|---|---|---|
| `layout.tsx` | Persistent shell around a segment | Server (unless marked) |
| `page.tsx` | The route's UI | Server (unless marked) |
| `loading.tsx` | Suspense fallback | — |
| `error.tsx` | Segment Error Boundary | **Client** (required) |
| `global-error.tsx` | Root-layout failure boundary | **Client** (required) |
| `not-found.tsx` | 404 | Server |
| `route.ts` | API handler | Server |

---

## 2.3 `lib/` — the brain

```
lib/
├── ai/                            Everything that talks to a model
│   ├── openrouter.ts                 THE gateway — every AI call routes here
│   ├── studio-prompts.ts             System prompts per Studio section
│   ├── studio-schemas.ts             Zod validation of model output
│   ├── exam-prompts.ts / exam-schemas.ts
│   ├── flashcard-prompts.ts / flashcard-schemas.ts
│   ├── infographic-prompts.ts
│   └── embeddings.ts                 pgvector embedding generation
│
├── supabase/                      Client factories — choose correctly (§3.1)
│   ├── client.ts                     Browser, anon key, singleton
│   ├── server.ts                     Service-role, SERVER ONLY, bypasses RLS
│   ├── middleware.ts                 Session refresh for middleware.ts
│   └── session-server.ts             getAuthenticatedUser()
│
├── search/                        Chunking and retrieval for RAG
├── push/                          Web Push dispatch
├── audio/                         Browser audio chunking, MP3 encoding
├── prompts/                       Legacy public-course prompt builders
├── translations/                  FR/EN UI strings, per feature
│
└── (root modules — one per domain concern)
    ├── studio-explication-client.ts  Browser-side Explication orchestrator
    ├── studio-explication-delta.ts   Slicing, length budgets, per-part generation
    ├── heartbeat-fetch.ts            NDJSON heartbeat stream reader
    ├── rate-limit.ts                 Fixed-window limiter + tier presets
    ├── subscription.ts               Plan quota reserve/refund
    ├── safe-redirect.ts              Open-redirect guard
    ├── document-extraction.ts        PDF/DOCX/PPTX → text
    ├── chargily.ts                   Payment gateway client
    ├── google-drive-picker.ts        OAuth + Drive REST
    ├── course-generation-shared.ts   sanitizeForPostgres, parseJsonResponse, …
    └── …
```

---

## 2.4 `components/`, `providers/`, `hooks/`, `types/`

### `components/` — grouped by feature, not by type

```
components/
├── ui/             Design-system primitives: Button, Dialog, Input, Toast, Tooltip
├── layout/         Sidebar, Topbar, Logo, ThemeToggle
├── course/         Course workspace + Studio panels (largest group)
├── dashboard/      Dashboard widgets, UploadModal, DriveBrowser
├── auth/           LoginForm, RegisterForm, AuthLayout
├── study/ groups/ notes/ todo/ billing/ pricing/ curriculum/
├── assistant/ visual-studio/ settings/ push/ pwa/ security/
```

> **The rule:** `components/ui/` is generic and knows nothing about medicine.
> Everything else may know the domain. If a component imports from `lib/ai/`, it
> does not belong in `ui/`.

### `providers/` (7)

Mounted in `app/layout.tsx`, wrapping the entire application. **Order matters:**

```
ThemeProvider → LanguageProvider → PomodoroProvider → TooltipProvider
  → ToastProvider → PushClientFallbackProvider → SecurityGuard
```

`AuthProvider` exposes `useAuth()` with the current user, profile, curriculum
profile, trial state and subscription state.

### `hooks/` (9)

`useAssistantConversations`, `useBlockPaste`, `useChatTheme`, `useCourseChat`,
`useFullscreen`, `useKeyboardInset` (iOS on-screen-keyboard handling),
`useMediaQuery`, `useSecurityGuard`, `useTextSelection`.

### `types/` (7)

`academic.ts`, `flashcard.ts`, `group-chat.ts`, `remediation.ts`,
`studio-course.ts`, `study-planner.ts`, `user-notes.ts`.

These describe the *application's* model. They are **not** generated from the
database. If you adopt `supabase gen types`, generated types should live
alongside these rather than replace them.

---

## 2.5 Naming conventions

| Element | Convention | Example |
|---|---|---|
| Logic files | `kebab-case.ts` | `studio-explication-delta.ts` |
| Component files | `PascalCase.tsx` | `DriveBrowser.tsx` |
| Hook files | `useCamelCase.ts` | `useMediaQuery.ts` |
| Components and types | `PascalCase` | `StudioCourseFull` |
| Variables and functions | `camelCase` | `generateExplicationPart` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_FILE_BYTES`, `RATE_LIMITS` |
| Database tables/columns | `snake_case` | `studio_courses`, `user_id` |
| Imports | Always `@/…` | `import { cn } from "@/lib/utils"` |

---

## 2.6 Where does a new file go?

| You are writing… | Location | Naming |
|---|---|---|
| An API endpoint | `app/api/<feature>/route.ts` | Folder = URL segment |
| A page | `app/<segment>/page.tsx` | — |
| A reusable UI primitive | `components/ui/` | `PascalCase.tsx` |
| A feature component | `components/<feature>/` | `PascalCase.tsx` |
| Business logic / integration | `lib/` or `lib/<area>/` | `kebab-case.ts` |
| A model prompt | `lib/ai/<feature>-prompts.ts` | — |
| A Zod schema for model output | `lib/ai/<feature>-schemas.ts` | — |
| A type used by 2+ features | `types/<domain>.ts` | — |
| A React hook | `hooks/useThing.ts` | `useCamelCase.ts` |

<div style="page-break-after: always;"></div>

---

# Part 3 — Backend & Database Architecture

## 3.1 The three Supabase clients

This is the most consequential choice in any new file. Getting it wrong either
leaks the service-role key to the browser or silently bypasses every access
control in the system.

| Factory | File | Key | RLS | Callable from |
|---|---|---|---|---|
| `createClient()` | `lib/supabase/client.ts` | anon (public) | **enforced** | Browser / `"use client"` |
| `getSupabaseAdmin()` | `lib/supabase/server.ts` | **service-role** | **BYPASSED** | Route handlers only |
| `createServerClient(...)` | `lib/supabase/middleware.ts` | anon | enforced | `middleware.ts` only |

### The browser client is a deliberate singleton

`createClient()` returns **the same instance** app-wide and sets
`autoRefreshToken: false`. Both details are load-bearing.

Every `GoTrueClient` runs its own background refresh timer. Supabase refresh
tokens are **single-use and rotating**. Multiple client instances in one tab
meant multiple timers racing to rotate the same token; the loser received
`Invalid Refresh Token: Already Used` and concluded the session was dead.

One shared instance removes one racer. `autoRefreshToken: false` removes the
other: `middleware.ts` already refreshes the cookie server-side on every
navigation, making the browser's unattended timer redundant. Explicit calls such
as `supabase.auth.getUser()` still refresh on demand.

> **Never** call `createBrowserClient` directly in a component. Always
> `createClient()`.

---

## 3.2 The service-role trap

`getSupabaseAdmin()` **bypasses Row Level Security completely.** RLS will not
protect you inside a route handler.

```ts
// ❌ IDOR — any authenticated user reads any course by guessing an integer
const { data } = await supabase
  .from("studio_courses").select("*")
  .eq("id", courseId);

// ✅ Ownership enforced in the query itself
const { data } = await supabase
  .from("studio_courses").select("*")
  .eq("id", courseId)
  .eq("user_id", user.id);
```

This is not hypothetical — see incident **C.1**.

> **Apply the scope to `UPDATE` and `DELETE` too**, not merely to a preceding
> `SELECT`. Performing the ownership check inside the mutation makes it atomic
> and immune to a time-of-check/time-of-use race.

---

## 3.3 The 44-table schema

`supabase/schema.sql` is the authoritative definition. Tables group into nine
families.

### Family 1 — Identity & billing (3)

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users`; university, curriculum selection, quota counters, push subscriptions |
| `subscriptions` | Active plan, billing cycle, expiry |
| `payments` | Payment audit trail; `status` `pending` → `paid` |

### Family 2 — Curriculum catalogue, public (4)

| Table | Purpose |
|---|---|
| `curriculum_specialties` | Médecine, Pharmacie, Chirurgie Dentaire |
| `curriculum_academic_years` | Year levels per specialty |
| `curriculum_teaching_units` | Teaching units within a year |
| `curriculum_modules` | Modules within a unit — **the most referenced table (7 FKs)** |

Contains **no user data**, which is why the four `api/curriculum/*` routes are
legitimately unauthenticated.

### Family 3 — Studio, the core product (9)

| Table | Purpose |
|---|---|
| `studio_courses` | **The central table.** One row per uploaded course, one column per generated section |
| `studio_content_cache` | Cross-student cache keyed by content hash |
| `studio_content_variations` | Paraphrased variants to avoid identical output between students |
| `studio_course_chunks` | pgvector embeddings for RAG retrieval |
| `studio_course_explication_chapters` | Chapter map enabling cross-university delta reuse |
| `studio_infographic_cache` | Generated infographic URLs |
| `studio_podcast_cache` | Generated audio URLs |
| `studio_slides_cache` | Generated slide decks |
| `studio_cross_university_reuse_log` | **Audit trail** for every cross-university content reuse |

### Family 4 — Legacy public-course pipeline (8)

`courses`, `courses_cache`, `course_content_cache`, `course_chunks`,
`course_source_chunks`, `course_explication_chapters`, `user_courses`, `modules`.

An earlier generation of the product, still present. Scheduled for retirement
(§6.5).

### Family 5 — Learning & SRS (3)

`qcm_attempts` (Leitner box, next review date), `user_module_flashcards`,
`flashcards_content_cache`.

### Family 6 — Exams (5)

`module_generated_exams`, `user_exam_attempts` (denormalised `wrong_questions`),
`exam_content_cache`, `exam_content_variations`, `exam_harvested_qcms`.

### Family 7 — Study tools (7)

`user_notes`, `course_highlights`, `study_plans`, `study_plan_tasks`,
`course_chat_history`, `course_workspace_cache`, `lecture_notes_jobs`.

### Family 8 — Social (3)

`chat_groups`, `chat_members`, `chat_messages` — group study chat over
**Supabase Realtime** (`postgres_changes`, presence, broadcast).

### Family 9 — Platform spend guards (2)

`platform_daily_generation_usage`, `dashboard_assistant_daily_usage` — global
ceilings independent of per-user quota.

### `studio_courses` in detail

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity | **Sequential — see C.1** |
| `user_id` | `uuid` → `auth.users` | Ownership |
| `curriculum_module_id` | `bigint` → `curriculum_modules` | Placement |
| `title`, `raw_text` | `text` | Source |
| `explication`, `exemples_analogies` | `text` | Markdown sections |
| `resume`, `cas_clinique`, `qcms` | `jsonb` | Structured sections |
| `flashcard_queue` | `jsonb` | Served cards |
| `source_file_url` | `text` | Storage pointer |
| `updated_at` | `timestamptz` | Recency ordering |

Sections are **columns, not rows**, because the UI always loads an entire course
at once and each section is generated independently.

---

## 3.4 Relationships and the entity graph

```
auth.users ──┬──► profiles (1:1)
             ├──► subscriptions, payments
             ├──► studio_courses ──┬──► studio_course_chunks
             │                     ├──► studio_course_explication_chapters
             │                     ├──► module_generated_exams
             │                     └──► (5 FK references total)
             ├──► user_notes, course_highlights
             ├──► study_plans ──► study_plan_tasks
             ├──► qcm_attempts, user_exam_attempts
             ├──► chat_members ──► chat_groups ──► chat_messages
             └──► (18 tables reference auth.users in total)

curriculum_specialties ──► curriculum_academic_years
                              ──► curriculum_teaching_units
                                    ──► curriculum_modules (7 inbound FKs)
```

**Most-referenced tables:** `curriculum_modules` (7), `studio_courses` (5),
`curriculum_academic_years` (3).

A database trigger, `enforce_curriculum_module_year_matches_unit`, guarantees a
module's year matches its teaching unit's year — a consistency constraint that
cannot be expressed as a simple foreign key.

---

## 3.5 Row Level Security

**RLS is enabled on 44 of 44 tables** with 46 policies.

| Pattern | Extent | Meaning |
|---|---|---|
| `auth.uid()`-scoped | 36 references | Row belongs to a user; the anon key reads/writes only their own |
| `using (false)` — "Deny all client access" | **23 tables** | Server-only; the browser can never reach them |

The `using (false)` pattern deserves emphasis. Those 23 tables — caches, chunk
indexes, generated-content stores, usage counters — are deliberately unreachable
from the browser. Their protection is *total absence of client access*.

> **And that is exactly where the danger lies.** Such a table is airtight until a
> server route reads it with the admin client and omits its own ownership check.
> That is precisely how incident **C.1** happened: the table's RLS was perfect
> and entirely irrelevant.

---

## 3.6 The 43 Postgres functions

Business-critical logic lives in the database, not only in TypeScript. Four
families:

### Quota reservation — atomic, 16 functions

```
reserve_generations_used      / refund_generations_used
reserve_chat_messages_used    / refund_chat_messages_used
reserve_daily_chat_messages_used
reserve_flashcards_used       / refund_flashcards_used
reserve_highlight_messages_used / refund_highlight_messages_used
reserve_remediation_used      / refund_remediation_used
reserve_qcm_regenerate        / refund_qcm_regenerate
reserve_module_exam_regenerate/ refund_module_exam_regenerate
reserve_platform_generation
reserve_dashboard_assistant_request
```

> **Why in Postgres:** "check the quota, then increment it" must be **one atomic
> operation**. Performed as two round-trips from Node, two concurrent requests
> both read the pre-increment value and both proceed — the student gets free
> generations. Each `reserve_*` checks and increments in a single statement.

### Cache hit counters — 9 functions

`increment_*_hit_count` for each cache table. Observability only, never
load-bearing for correctness.

### Vector similarity — 6 functions

`match_similar_studio_chunks`, `match_studio_chunks_against_course`,
`match_course_chunks`, `match_chunks_against_course`,
`match_similar_source_chunks`, `match_similar_courses_by_slug` — pgvector
cosine-similarity search powering RAG retrieval and cross-university reuse.

### Analytics and triggers — the remainder

`course_mastery`, `course_weak_qcms`, `weakness_radar`, `handle_new_user`
(creates a `profiles` row on signup), and the curriculum consistency trigger.

---

## 3.7 API surface: 80 route handlers

| Group | Routes | Responsibility |
|---|---|---|
| `studio/` | ~14 | Studio generation: generate, regenerate, podcast, infographic, courses CRUD, the 4-step Explication pipeline |
| `exam/` | ~6 | Exam generation, attempts, style analysis |
| `flashcards/`, `srs/` | ~9 | Deck generation, pool, attempts, mastery, weakness radar |
| `courses/` | ~2 | RAG chat |
| `groups/` | ~8 | Group chat, members, messages, reactions |
| `notes/`, `lecture-notes/` | ~8 | Notes CRUD, organise, summarise, transcription |
| `study-planner/`, `study/` | ~7 | Plans, tasks, remediation |
| `upload/` | ~4 | Signed URL, finalize, OCR fallback |
| `chargily/` | 2 | checkout, webhook |
| `drive/` | ~1 | Drive import |
| `curriculum/` | 4 | Public catalogue |
| `push/` | ~4 | Subscribe, unsubscribe, dispatch |
| `profile/`, `subscription/`, `search/`, `workspace/`, `assistant/`, `modules/`, `highlights/`, `generate/` | remainder | Supporting endpoints |

### Authentication coverage

**74 of 80 routes call `getAuthenticatedUser()`.** The six exceptions are
intentional and each protected by a different, specific mechanism:

| Route | Why exempt | Actual protection |
|---|---|---|
| `api/chargily/webhook` | Called by Chargily, not a user | **HMAC signature** over the raw body |
| `api/push/dispatch` | Called by an external cron | `Authorization: Bearer $CRON_SECRET` |
| `api/curriculum/*` (4) | Public reference catalogue | Contains no user data — no `user_id` column exists |

> If you add a seventh unauthenticated route, it needs an equally specific
> answer to "what protects it instead".

### Why middleware excludes `/api/**`

`middleware.ts`'s matcher deliberately skips API routes. Each route performs its
own auth via `getAuthenticatedUser()`, which refreshes the session as needed.
Having middleware *also* refresh on every API call created two un-deduplicated
refresh paths racing to rotate the same single-use token — the confirmed cause of
`Invalid Refresh Token: Already Used` in production.

---

## 3.8 The standard gate order

Every protected route follows this sequence. The order is not arbitrary — each
step is cheaper than the next, so the cheapest rejection happens first.

```ts
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // 1. AUTH — cheapest meaningful rejection
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json(
    { success: false, error: "Tu dois être connecté(e)." }, { status: 401 });

  // 2. RATE LIMIT — before any I/O
  const rl = rateLimit(`feature:${user.id}`, RATE_LIMITS.ai);
  if (!rl.allowed) return NextResponse.json(
    { success: false, error: "Trop de requêtes — réessaie dans quelques minutes." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds(rl)) } });

  // 3. BODY PARSE
  let body: unknown;
  try { body = await request.json(); }
  catch (error) { return NextResponse.json(
    { success: false, error: `Corps de requête JSON invalide : ${errorMessage(error)}` },
    { status: 400 }); }

  // 4. FIELD VALIDATION — narrow every field explicitly
  const { courseId } = (body ?? {}) as { courseId?: unknown };
  if (typeof courseId !== "number" || !Number.isFinite(courseId))
    return NextResponse.json({ success: false, error: "'courseId' est requis." }, { status: 400 });

  // 5. OWNERSHIP — the admin client bypasses RLS
  const supabase = getSupabaseAdmin();
  const { data: course } = await supabase
    .from("studio_courses").select("raw_text")
    .eq("id", courseId).eq("user_id", user.id)   // ← never omit
    .maybeSingle();
  if (!course) return NextResponse.json(
    { success: false, error: "Cours introuvable." }, { status: 404 });

  // 6. QUOTA — last gate before spending money
  const gate = await reserveGeneration(user);
  if (!gate.allowed) return NextResponse.json(
    { success: false, error: gate.reason }, { status: 403 });

  try {
    // 7. CACHE, then the billed call, then Zod validation, then persist
  } catch (error) {
    await refundGeneration(user);   // ← never charge for a failure
    throw error;
  }
}
```

---

## 3.9 Validation and error handling

### Input validation

Two complementary styles, both acceptable:

1. **Manual narrowing** — the dominant pattern for simple bodies:
   `typeof x !== "string"` checks with explicit 400s.
2. **Zod schemas** — used where the shape is complex, and **always** for AI
   output.

Both are equally sound. What is *not* acceptable is casting
(`body as { courseId: number }`) and using the value without a runtime check.

### Response shape

| Shape | Routes | Status |
|---|---|---|
| `{ success: boolean, … }` | 64 of 80 | **The convention — use this** |
| Bare `{ error }` / `{ data }` | 16 | Legacy, predates the convention |

New routes **must** use `{ success: true, … }` / `{ success: false, error }`.

> **Why the 16 were not migrated in bulk.** 64 routes already use
> `{success, error}` and the entire frontend reads `data.success`. Imposing a
> different shape means touching 80 routes *and* every call site in one sweep.
> During a handover that is an unacceptable risk. They are migrated
> opportunistically — one route plus its call sites per commit.

### HTTP status semantics

Client retry logic depends on these being correct:

| Code | Meaning | Client behaviour |
|---|---|---|
| `400` | Malformed input | Do not retry |
| `401` | Unauthenticated | **Retry once** — see the refresh-token race below |
| `403` | Quota exhausted / forbidden | Do not retry |
| `404` | Not found or not owned | Do not retry |
| `413` | Payload too large | Do not retry |
| `429` | Rate limited | Retry after `Retry-After` |
| `502` | Upstream failure | Retry with backoff |
| `504` | Upstream timeout | **Subdivide**, do not retry identically |

### The 401 retry exception

`isRetryable()` treats **401 as retryable**, which looks wrong and is not. Two
concurrent authenticated requests can race the single-use refresh-token
rotation; the loser receives a hard 401 even though the session is alive and the
browser's cookie has already been updated by the winner. One retry after a short
backoff succeeds. Treating 401 as permanent meant losing multi-minute
generations to a self-resolving race.

### Error message policy

User-facing messages are **French** and must never leak internals. Full detail
goes to `console.error` for the server logs.

```ts
// ❌ leaks table names, constraint names, SQLSTATE codes to the browser
return NextResponse.json(
  { error: `Échec : ${error.message} (code ${error.code})` }, { status: 500 });

// ✅
console.error("[route] Échec insertion:", error);
return NextResponse.json(
  { success: false, error: "L'opération a échoué. Réessaie." }, { status: 500 });
```

<div style="page-break-after: always;"></div>

---

# Part 4 — Deep-Dive Third-Party Integrations

## 4.1 OpenRouter: the AI gateway

**Every AI call in this application passes through `lib/ai/openrouter.ts`.**
There is no direct Anthropic, OpenAI or Google SDK anywhere. Introducing one
would bypass the retry logic, the connection-pool fix, the timeout handling and
the usage logging — each of which exists because of a production incident.

### Exported entry points

| Function | Purpose |
|---|---|
| `callOpenRouter(messages, options)` | Non-streaming chat completion — the workhorse |
| `streamOpenRouter(...)` | Token-by-token streaming for chat surfaces |
| `generateOpenRouterImage(...)` | Infographic generation |
| `generateOpenRouterAudio(...)` | Podcast narration (streamed PCM) |
| `transcribeAudioViaOpenRouter(...)` | Lecture transcription |
| `extractPdfTextViaOcr(...)` | OCR fallback for scanned PDFs |
| `fetchOpenRouterWithRetry(url, init)` | Shared low-level fetch, exported so `lib/ai/embeddings.ts` inherits the same hardening |

### Model selection

| Constant | Model | Used for |
|---|---|---|
| `MODEL` | `anthropic/claude-sonnet-5` | Default for high-stakes generation |
| `HAIKU_MODEL` | `anthropic/claude-haiku-4.5` | Cheaper reasoning, vision input |
| `CHEAP_MODEL` | `deepseek/deepseek-v3.2` | **The entire Explication pipeline** |
| `IMAGE_MODEL` | `google/gemini-3.1-flash-image-preview` | Infographics |

> **Model policy.** Model IDs were chosen after **live comparison tests**, not
> from specification sheets. One candidate that appeared cheaper and faster on
> paper failed a live test outright — no response after 450 s — while the
> incumbent completed the identical prompt in 4.4 s.
>
> **Never swap a model on documentation alone. Run a real call on real content
> first.**

`CHEAP_MODEL` is always invoked with `reasoning: { effort: "low" }`. DeepSeek
V3.2 is a hidden-reasoning model: uncapped, it consumes most of `maxTokens` on
invisible thinking before emitting a visible character, silently truncating the
real answer.

### A fresh undici Agent per call

`createOpenRouterDispatcher()` returns a **new** `Agent` per request rather than
sharing a pooled one.

A pooled keep-alive connection can go stale across a serverless instance's
freeze/thaw cycle: the remote end drops it while the local socket still appears
alive, and the next request hangs forever with no error any timeout can catch. A
fresh agent cannot go stale — nothing is reused. The cost is one additional
TCP+TLS handshake per call, negligible against calls taking 60–260 s.

---

## 4.2 The three-layer timeout model

The subtlest part of the codebase, and the source of its most expensive bug.

| Layer | Constant | Guards |
|---|---|---|
| Connect phase | `OPENROUTER_CONNECT_TIMEOUT_MS` = 60 s | TCP/TLS handshake — undici defaults to 10 s, far too short |
| Headers + body | `OPENROUTER_DISPATCHER_TIMEOUT_MS` = 250 s | Agent-level backstop |
| Whole call | `options.timeoutMs` (`AbortController`) | The operative per-caller ceiling |

### The bug worth learning from

`fetch()` resolves when response **headers** arrive — roughly two seconds for
OpenRouter. The model then streams the body for *minutes*. The original code
cleared its abort timer in a `finally` attached to the fetch alone:

```ts
// ❌ THE BUG
try     { res = await fetchOpenRouterWithRetry(url, { signal }); }
finally { clearTimeout(timeoutId); }   // ← disarms the abort ~2 s in
const data = await res.json();          // ← minutes, entirely unguarded
```

**Consequence:** `timeoutMs` was irrelevant to the phase where all the time was
actually spent. A call could end only by finishing, or by Vercel hard-killing
the invocation at the wall — which kills the route mid-flight, so no `catch`
runs and the client observes the stream closing with no error at all.

```ts
// ✅ CORRECT — the timer stays armed across the body read
let data: any;
try {
  const res = await fetchOpenRouterWithRetry(url, { signal: timeoutController.signal });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenRouterError(extractOpenRouterErrorDetail(body), res.status);
  }
  data = await res.json();                        // still guarded
} catch (error) {
  if (error instanceof OpenRouterError) throw error;   // preserve upstream status
  if (error?.name === "AbortError")
    throw new OpenRouterError("Le modèle IA met trop de temps à répondre.", 504);
  throw new OpenRouterError("L'appel au modèle IA a échoué.", 502);
} finally {
  clearTimeout(timeoutId);
}
```

> **A backstop above the wall is not a backstop.**
> `OPENROUTER_DISPATCHER_TIMEOUT_MS` must sit *below* the route's `maxDuration`,
> or the platform kills the function before it can fire. It was 300 s against a
> 280 s wall — structurally unable to help. It is now 250 s.

This same flaw existed in `generateOpenRouterImage`,
`transcribeAudioViaOpenRouter` and `extractPdfTextViaOcr` and was fixed in all
four. `generateOpenRouterAudio` was already correct — it streams and keeps the
timer armed across the whole read loop.

### Never trust model output

**1 — Truncation detection.** OpenRouter returns `finish_reason: "length"` when
the response hit `max_tokens` mid-sentence. Unchecked, a truncated answer is
just a normal string and passes as success. It is thrown as a retryable
`OpenRouterError` carrying an explicit `truncated: true` flag.

> The flag exists because status alone is ambiguous: truncation surfaces as 502
> like any other upstream error, yet only truncation is cured by requesting
> *less work*. Callers branch on `error.truncated`, never on message text.

**2 — Schema validation.** Model JSON is validated with Zod before it reaches
the database:

```ts
const result = resolveStudioSchema(actionType, studyYear).safeParse(parsed);
if (!result.success) { /* log fieldErrors, throw retryable */ }
```

---

## 4.3 Token economics and the French tokenization ratio

A detail with direct architectural consequences.

**Medical French tokenizes worse than English.** Long technical terms
(*physiopathologie*, *anticoagulation*) fragment into multiple tokens, and the
JSON wrapper escapes every newline. The calibrated ratio used throughout this
codebase is:

> **≈ 1.9 tokens per French word**

An earlier calibration used ≈1.44 — an English-ish ratio — and produced an
authorized output ceiling that *exceeded* the token cap, meaning the prompt
permitted a length the model could not finish without truncation.

### Worked budget — the standard Explication part

| Quantity | Value |
|---|---|
| Slice of source covered | 6,000 characters |
| Target output | 2,220 words |
| Hard ceiling in the prompt | 2,997 words |
| Ceiling in tokens (×1.9) | ≈ 5,694 |
| `EXPLICATION_PART_MAX_TOKENS` | **8,000** |
| Headroom | **≈ 2,306 tokens** |
| Generation time at ~70 tok/s | ≈ 60 s typical, ≈ 81 s worst case |
| `EXPLICATION_PART_TIMEOUT_MS` | 200,000 ms |
| Route `maxDuration` | 280 s |

Each ceiling sits comfortably beneath the next. That layering is the entire
point.

---

## 4.4 The Explication pipeline

The flagship feature, and the one with the most non-obvious engineering.

### Why it is split into parts

A full ultra-detailed explanation is far longer than a single invocation can
produce. The source is sliced, and **each slice is its own HTTP request,
sequenced from the browser**:

```
┌──────────────────────────────────────────────────────────────┐
│ lib/studio-explication-client.ts   (runs in the BROWSER)     │
└───────────────────────┬──────────────────────────────────────┘
                        │
   1 ──► POST /api/studio/generate/explication-start
         • reserves quota ONCE · never retried
         • may resolve instantly (cache / cross-university delta)
         • returns { totalParts }
                        │
   2 ──► POST /api/studio/generate/explication-part   × N, sequential
         • NDJSON stream, always HTTP 200
         • independently retryable · touches NO quota
         • carries previousPartTail for chapter continuity
                        │
   3 ──► POST /api/studio/generate/explication-finalize
         • assembles + persists the collected parts
                        │
   ✗ ──► POST /api/studio/generate/explication-abandon
         • refunds the reservation if the run gives up
```

**Why the browser orchestrates rather than the server:** a server-side loop over
N parts is *one* invocation and would hit the execution wall. One request per
part means each is independently bounded and independently retryable, and a
completed part is never regenerated because a later one failed.

**Quota integrity:** reservation happens only in `explication-start`, which is
never retried. `explication-part` touches quota not at all — deliberately,
because the client retries it freely. An earlier version reserved inside the
retried step and charged students 2–3× for one delivered generation.

### The heartbeat protocol

Each part streams **NDJSON** over one held-open connection:

```
{"type":"heartbeat"}                                   ← every 15 s
{"type":"heartbeat"}
{"type":"result","success":true,"partMarkdown":"…"}    ← always the final line
```

Always HTTP 200, because the true outcome is unknown when headers are sent. The
logical status rides in the final line's `status` field; `lib/heartbeat-fetch.ts`
reads **that**, not the transport status.

> **Why heartbeats exist:** a mobile carrier's NAT drops an idle TCP connection
> after 30–120 s of silence, and a part legitimately generates for minutes with
> no bytes flowing. Real bytes every 15 s defeat that entirely, regardless of
> how long the work takes.

### The lesson about generation time

The pipeline repeatedly timed out at ~200 s. The intuitive fix — "slice the
input smaller" — was tested and **falsified**:

| Attempt | Source size | Result |
|---|---|---|
| Whole part | 6,000 chars | Timeout at ~200 s |
| Half | 3,000 chars | Timeout at ~200 s |
| Quarter | ~1,500 chars | Timeout at ~200 s |

Generation time was **not proportional to input size**. The arithmetic explained
why:

> `14,000 max_tokens ÷ 200 s = 70 tok/s` — precisely DeepSeek V3.2's real
> throughput.

The model was generating flat out to the token ceiling on every call regardless
of input, because the system prompt orders it to:
*"ne t'arrête JAMAIS par souci de longueur… vise largement plus de 8000 mots,
sans plafond réel"*. The per-part correction asked it not to "inflate
artificially" but never named a number — so the louder absolute instruction won.

**The operative lever is therefore the output budget, not the input size.**
`buildPartLengthBudget(sliceLength)` now states a concrete word target and hard
ceiling in the prompt, explicitly overriding the global mandate for that part.

> **Total length is not reduced.** A long course simply has more parts: a
> 60,000-character course targets ≈22,200 words overall — far beyond the
> 8,000-word mandate — where previously it produced *nothing*, because every
> part died at the wall.

---

## 4.5 Subdivision and truncation recovery

`lib/studio-explication-client.ts` selects a recovery strategy by failure type.
The distinction matters more than the retry count.

| Failure | Strategy | Rationale |
|---|---|---|
| **504** — generation timeout | **Subdivide:** whole → halves → quarters → eighths | Systematic. An identical retry meets the same wall for the same reason |
| **`truncated: true`** — hit `max_tokens` | **Subdivide**, identically | Systematic and deterministic against the same ceiling |
| Network drop, 5xx, 401 race | Retry identically, exponential backoff **2 s → 6 s → 18 s** | Genuinely transient; the same request can succeed |
| 4xx (except 401) | Fail immediately | Retrying a malformed request only wastes attempts |

Server support: `explication-part` accepts optional `subPartIndex` /
`subPartCount`. When present, `splitSliceIntoSubSlices()` divides that part's
slice into boundary-aware pieces (paragraph → line → sentence) and generates
only the requested one. Absent those parameters the happy path is unchanged.

> **A verification finding worth recording.** Truncation is thrown as status
> 502, while escalation originally matched only 504. A truncated part therefore
> burned three byte-identical retries against a deterministic ceiling, then
> hard-failed and abandoned the *entire* multi-part generation — discarding
> every already-completed, already-billed part. The explicit `truncated` flag
> exists to close exactly that gap.

### Progress visibility

`onProgress` reports `partIndex`, `totalParts`, `attempt`, `subPartIndex`,
`subPartCount` and `isRecovering`, so the UI renders
`Partie 3/7 · tentative 2` rather than appearing frozen.

> This is not cosmetic. Retries nobody can see are indistinguishable from a
> hang — which produced a real "the client did not retry" bug report about logic
> that *was* retrying, silently, for ten minutes.

---

## 4.6 Chargily Pay V2

`lib/chargily.ts` exposes two functions:

| Function | Purpose |
|---|---|
| `createChargilyCheckout(params)` | Creates a hosted checkout; returns `{ id, checkout_url }` |
| `verifyChargilySignature(rawBody, signatureHeader)` | HMAC verification for webhooks |

### Plans

A freemium tier plus **nine paid plans** — three pricing tiers (individual,
group, promo) × three billing cycles (monthly, 4-month, annual). Prices are in
**DZD**; payment methods are Edahabia and CIB.

### Checkout flow

```
Student selects a paid plan
  └─► POST /api/chargily/checkout
        1. getAuthenticatedUser()                    → 401
        2. rateLimit(…, RATE_LIMITS.mutation)        → 429
        3. validate plan id (isPlanId, isPaidPlanId) → 400
        4. createChargilyCheckout({ amount, successUrl, failureUrl,
                                    webhookEndpoint, metadata })
        5. INSERT payments (status: "pending")   ← best-effort
        6. return { checkoutUrl }
  └─► browser redirects to Chargily's hosted page
        … the student pays on Chargily's domain …
  └─► Chargily calls POST /api/chargily/webhook   (server-to-server)
        1. verifyChargilySignature(rawBody, signature)   ← HMAC, not a session
        2. UPDATE payments  status → paid
        3. UPSERT subscriptions  → plan activated
```

Step 2 of checkout is essential: this route hits a **live payment API** and
writes a row on every call. It must never be unthrottled.

Step 5 is deliberately best-effort — a Supabase hiccup must not block a checkout
that Chargily has already created.

### The webhook is the only source of truth

> ⚠️ **Entitlement is granted in the webhook and nowhere else.** The browser
> landing on `/dashboard/billing?status=success` is a UI hint — any user can
> type that URL. Never grant access from a client-side redirect.

The **raw** body must be verified before JSON parsing; re-serialising changes the
bytes and invalidates the signature.

---

## 4.7 Google Drive import

Students import source documents directly from Drive.

### Architectural history

This previously embedded Google's hosted Picker widget in an iframe. That was
removed after two limitations proved unfixable from our side:

1. With third-party cookies blocked — now the Chrome default — the Picker's
   internal account chooser rendered a dead "Sign in to your Google Account" box.
2. Its internal layout is not responsive below tablet width.

### Current design — direct REST

| Step | Mechanism |
|---|---|
| 1 | `requestAccessToken()` opens Google Identity Services' OAuth **popup** — a real top-level window, not an iframe, so the cookie problem does not apply |
| 2 | `listDriveFiles(accessToken, opts)` calls `GET https://www.googleapis.com/drive/v3/files` with a Bearer token |
| 3 | `components/dashboard/DriveBrowser.tsx` renders our own responsive UI: Récents / Mon Drive / Partagés avec moi, folder navigation, search, pagination |
| 4 | `POST /api/drive/import` downloads server-side, extracts text, returns it |

### Consequences worth knowing

- **Scope is `drive.readonly`**, not `drive.file` — required to *list* files the
  user has not explicitly picked.
- **Only a Client ID is needed.** No API key, no "Google Picker API" enablement.
- **The OAuth popup must open synchronously** inside the click handler.
  `preloadGoogleDriveScripts()` loads the GIS script when the modal opens so the
  handler has no `await` before `requestAccessToken()` — several mobile browsers
  revoke popup permission across an async gap.
- A 401 mid-session throws `DriveAuthExpiredError` so the UI can offer
  "Se reconnecter"; `/api/drive/import` returns `authExpired: true` for the same
  purpose on the import path.
- The import route enforces a **100 MB cap**, checking both `Content-Length` and
  the actual buffered length.

<div style="page-break-after: always;"></div>

---

# Part 5 — Error Handling, Security & Deployment

## 5.1 Error Boundaries

React unmounts the **entire tree** on an uncaught render error. With 155 client
components, a single undefined field anywhere blanked the whole page — no
message, no recovery, no way back.

Three boundary files now exist:

| File | Catches | Notes |
|---|---|---|
| `app/error.tsx` | Any error in the route segment | Offers `reset()` — re-renders without a full reload, recovering from transient errors without losing the session |
| `app/global-error.tsx` | Errors thrown by the **root layout itself** | Must render its own `<html>`/`<body>` — it *replaces* the layout rather than nesting inside it |
| `app/not-found.tsx` | 404 | Server Component, zero client JS |

> **Why `global-error.tsx` uses inline styles and no shared components.** Every
> provider, every Tailwind-styled primitive and the font variable live in the
> layout that just crashed. Depending on any of them risks throwing a second
> time *inside* the safety net.

Neither boundary displays `error.message`: in production Next.js replaces it
with a generic string anyway, and real detail belongs in server logs and
`error.digest`, not in front of a student.

---

## 5.2 Security posture

### Headers — `next.config.mjs`

| Header | Value |
|---|---|
| `Content-Security-Policy` | Full policy, see below |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

The CSP allows exactly what the application genuinely uses:

```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob: https:
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://www.googleapis.com https://accounts.google.com
            https://oauth2.googleapis.com
frame-src   https://accounts.google.com https://docs.google.com https://*.supabase.co
frame-ancestors 'self'
object-src 'none' ; base-uri 'self' ; form-action 'self'
```

> **Two entries that look optional and are not.**
> `wss://*.supabase.co` — group chat uses Supabase Realtime over WebSockets;
> omitting it breaks live chat silently.
> `frame-src … docs.google.com … *.supabase.co` — the "Afficher le cours"
> viewer iframes Supabase Storage PDFs and Google Docs Viewer; omitting them
> breaks the file viewer for every file type.
>
> `'unsafe-inline'`/`'unsafe-eval'` remain because Next.js App Router hydration
> requires inline scripts without a nonce. Removing them is a nonce-based CSP
> project, not a one-line tightening (§6.5).

### Open-redirect protection

`lib/safe-redirect.ts` — `sanitizeRedirectPath()` forces any `next` parameter to
a same-origin relative path. Applied in `app/auth/callback/route.ts` and
`components/auth/LoginForm.tsx`.

> Without it, `?next=@evil.com` makes `origin + next` parse with `evil.com` as
> the host — the real open redirect recorded in **C.2**.

### Other controls

| Control | Implementation |
|---|---|
| Upload size caps | 100 MB, enforced at the route **and** at the Storage bucket |
| Text length caps | `MAX_HIGHLIGHT_CHARS`, `MAX_MESSAGE_CHARS`, `MAX_SOURCE_CHARS` |
| Webhook authenticity | HMAC over the raw body |
| Cron authenticity | `Authorization: Bearer $CRON_SECRET` |
| Error leakage | Raw Postgres messages and SQLSTATE codes never reach the client |

### CORS

No permissive CORS headers are set anywhere, and none should be. The API is
consumed exclusively by this app's own frontend on the same origin; browsers
therefore block cross-origin reads by default. Adding `Access-Control-Allow-Origin`
would be a deliberate decision requiring a matching auth story — do not add it
casually.

---

## 5.3 Environment variables

See **Appendix A** for the complete matrix.

> **The rule:** `NEXT_PUBLIC_` is inlined into the browser bundle. Anything
> without that prefix must never be read from a file reachable by a
> `"use client"` component.

> **Build-time inlining.** `NEXT_PUBLIC_*` values are baked in **at build
> time**, not read at runtime. Changing one in Vercel requires a **redeploy** —
> the running deployment keeps the old value. This has caused real confusion:
> corrected credentials appeared to have no effect until a rebuild ran.

---

## 5.4 Rate limiting

`lib/rate-limit.ts` — a fixed-window counter with named tiers:

| Tier | Limit | Window | Applies to |
|---|---|---|---|
| `ai` | 20 | 5 min | Any route reaching OpenRouter |
| `mutation` | 30 | 5 min | Plain writes, checkout |
| `chatMessage` | 120 | 5 min | Group chat sends |
| `freeAssistant` | 15 | 1 min | Free-tier assistant |
| `lectureChunk` | 40 | 10 min | Per-chunk transcription |

### A documented limitation you will eventually hit

> ⚠️ This is an **in-process `Map`**. It is a correct hard limit only while the
> app runs as a single process. On Vercel each concurrent serverless instance
> holds its own map, so the effective ceiling is
> `limit × number of instances serving that key`.

This is knowingly accepted and flagged in the file itself, with an Upstash Redis
migration sketched out. The signature `rateLimit(key, config)` is designed so the
swap touches only that file — though it makes the function `async`, requiring an
audit of all call sites.

---

## 5.5 Deployment and verification

Pushing to `main` triggers Vercel automatically.

> ⚠️ **Three Vercel projects build from this repository.** Only
> **`med-art-ai-febc`** is production. `med-art-ai` and `med-art-ai-vz6g` are
> stale duplicates whose failing checks are noise. Always verify the correct
> project.

```bash
# 1. Confirm the production project specifically
curl -s "https://api.github.com/repos/yacinebjj/MED-art-Ai/commits/<sha>/status" \
  | grep -B3 '"context": "Vercel – med-art-ai-febc"'

# 2. Confirm the site actually serves
curl -s -o /dev/null -w "%{http_code}\n" https://med-art-ai-febc.vercel.app/

# 3. Confirm security headers are live
curl -sI https://med-art-ai-febc.vercel.app/ | grep -i "content-security-policy"
```

### Logs

Vercel's dashboard provides function logs. Since diagnosis currently depends on
`console.error` plus log retention, **structured logging and error tracking are
on the roadmap** (§6.5, item 7).

<div style="page-break-after: always;"></div>

---

# Part 6 — Developer Onboarding & Roadmap

## 6.1 Local setup

```bash
git clone https://github.com/yacinebjj/MED-art-Ai.git
cd MED-art-Ai
npm install
cp .env.local.example .env.local     # then fill in real values
npm run dev                          # → http://localhost:3000
```

**Minimum to boot and generate anything:** `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OPENROUTER_API_KEY`.

Google Drive import additionally requires `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, with
`http://localhost:3000` registered under **Authorized JavaScript origins** in
Google Cloud Console.

---

## 6.2 Commands and quality gates

```bash
npm run dev          # dev server
npm run build        # production build — authoritative type check
npm start            # serve a production build locally
npm run lint         # ESLint
npx tsc --noEmit     # fast type check — run constantly
```

### Before every commit

```bash
npx tsc --noEmit && npm run lint && npm run build
```

All three must pass. **Known-acceptable output:** exactly two ESLint `<img>`
warnings (`app/dashboard/(shell)/assistant/page.tsx`,
`components/course/workspace/InfographicViewer.tsx`). Anything beyond those two
is new and should be fixed, not normalised.

> **Windows note.** Concurrent `next build` runs — or a build running while the
> dev server is live — can abort with `UNKNOWN: unknown error, write` or
> `Cannot find module for page: /_document`. These are filesystem races on
> `.next`, not real failures. Stop the dev server, `rm -rf .next`, rebuild, and
> **confirm you get a full route table** before believing a build passed. Exit
> code 0 alone is not sufficient evidence.

---

## 6.3 Adding a feature, end to end

Worked example: a **"Mnémotechniques"** Studio section.

### Step 1 — Type and schema first

```ts
// types/studio-course.ts — what the app believes
export interface Mnemonic { id: string; concept: string; device: string; }

// lib/ai/studio-schemas.ts — what we accept from the model
export const MnemonicsSchema = z.object({
  mnemonics: z.array(z.object({
    id: z.string(),
    concept: z.string().min(3),
    device: z.string().min(10),
  })).min(5),
});
```

### Step 2 — Prompt

Add `MNEMONICS_SYSTEM_PROMPT` to `lib/ai/studio-prompts.ts`. **Never inline a
prompt in a route handler.**

If the section can be long, give it an explicit length budget (§4.3) rather than
an open-ended "be exhaustive" instruction.

### Step 3 — Database

Add the column to `studio_courses` in `supabase/schema.sql` **and run it against
the live database** — there is no migration runner (§6.4, item 1).

### Step 4 — Route handler

Follow the gate order in §3.8 exactly. Reserve quota before the billed call;
refund on failure.

### Step 5 — UI

Add the tile to the Studio panel and a viewer under
`components/course/workspace/`. Wire loading and error states — generation takes
real time, and a frozen-looking UI is itself a bug (§4.5).

### Step 6 — Verify

`npx tsc --noEmit && npm run lint && npm run build`, then exercise the feature
in a browser.

---

## 6.4 Technical debt register

Tracked honestly, in priority order:

| # | Item | Impact | Effort |
|---|---|---|---|
| **1** | **No migration runner.** `schema.sql` is intent; the live database is reality, and they can drift | **High** — a missing column fails at runtime | Medium |
| **2** | **Rate limiting is in-process**, so the real ceiling is `limit × instances` | **High** under load | Medium |
| **3** | 16 of 80 routes use the legacy response shape | Medium | Medium |
| **4** | **No automated tests.** Verification is `tsc` + lint + build + manual | Medium | High |
| **5** | No generated Supabase types — the admin client is `SupabaseClient<any, any, any>` | Medium | Low |
| **6** | Two stale duplicate Vercel projects deploy from this repo | Low, but confusing | Low |
| **7** | `loading.tsx` on only 2 of 21 pages | Low | Low |
| **8** | Two `<img>` lint warnings | Cosmetic | Low |

---

## 6.5 Roadmap

### Near term

1. **Adopt Supabase CLI migrations** — closes debt #1, the highest-risk item
2. **Move rate limiting to Upstash Redis** — closes #2
3. **Generate Supabase types** — closes #5, cheap and high value
4. **Add tests around the money paths**: `reserveGeneration`/`refundGeneration`,
   the Chargily webhook, and the Explication part orchestrator

### Medium term

5. Migrate the 16 legacy routes to the standard response shape, one route plus
   its call sites per commit
6. **Nonce-based CSP** — removes `'unsafe-inline'`/`'unsafe-eval'`; a real
   project, not a config tweak
7. **Structured logging and error tracking** (Sentry or equivalent). Diagnosis
   currently depends on `console.error` and Vercel log retention
8. Retire the legacy public-course pipeline once nothing depends on it

### Longer term

9. **Cost observability per student.** Spend guards exist
   (`platform_daily_generation_usage`) but there is no dashboard
10. **Formalise the cross-university similarity threshold.** Currently 0.85, set
    from a single manually-inspected pair. `studio_cross_university_reuse_log`
    is the audit trail for revisiting it
11. Complete `loading.tsx` coverage for the remaining pages

---

## 6.6 Reading order

To become productive fastest, read in this order:

| Order | File | Why |
|---|---|---|
| 1 | `lib/ai/openrouter.ts` | The AI gateway and its timeout semantics — the most important file |
| 2 | `lib/studio-explication-delta.ts` | Slicing, budgets, the per-part generator |
| 3 | `lib/studio-explication-client.ts` | The orchestrator; teaches every platform constraint at once |
| 4 | `app/dashboard/module/[id]/page.tsx` | The product's centre of gravity |
| 5 | `supabase/schema.sql` | The data model and its reasoning |
| 6 | `lib/supabase/*.ts` | The three clients and when each applies |
| 7 | `middleware.ts` + `lib/supabase/middleware.ts` | Session and route protection |

<div style="page-break-after: always;"></div>

---

# Appendices

## Appendix A — Environment variable matrix

| Variable | Scope | Required for | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | App boot | Inlined at build time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Auth, browser queries | Safe to expose; RLS is its boundary |
| `SUPABASE_URL` | **server** | All route handlers | |
| `SUPABASE_SERVICE_ROLE_KEY` | **server** | All route handlers | **Bypasses RLS — never to the client** |
| `OPENROUTER_API_KEY` | **server** | Every AI feature | |
| `CHARGILY_SECRET_KEY` | **server** | Payments | `test_sk_…` / `live_sk_…` |
| `CHARGILY_API_BASE` | server | Test vs live endpoint | |
| `APP_URL` | server | Chargily callbacks in production | Chargily cannot reach `localhost` |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | public | Drive import | Restricted by Authorized JavaScript origins |
| `VAPID_PUBLIC_KEY` | server | Web Push | Must equal the `NEXT_PUBLIC_` twin |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | Web Push | |
| `VAPID_PRIVATE_KEY` | **server** | Web Push | |
| `VAPID_SUBJECT` | server | Web Push | `mailto:` or `https://` |
| `CRON_SECRET` | **server** | `POST /api/push/dispatch` | Bearer token |

---

## Appendix B — API endpoint index (selected)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/studio/generate` | POST | ✅ | Generate one Studio section |
| `/api/studio/regenerate` | POST | ✅ | Regenerate with a variation |
| `/api/studio/generate/explication-start` | POST | ✅ | Reserve quota, plan parts |
| `/api/studio/generate/explication-part` | POST | ✅ | Generate one part (NDJSON) |
| `/api/studio/generate/explication-finalize` | POST | ✅ | Assemble and persist |
| `/api/studio/generate/explication-abandon` | POST | ✅ | Refund on give-up |
| `/api/studio/podcast` | POST | ✅ | Audio narration (NDJSON) |
| `/api/studio/infographic` | POST | ✅ | Infographic image |
| `/api/studio/courses` | GET/POST | ✅ | List / create courses |
| `/api/studio/courses/[id]` | GET/PATCH/DELETE | ✅ | Course detail |
| `/api/courses/chat` | POST | ✅ | RAG chat (streamed) |
| `/api/exam/generate` | GET/POST | ✅ | Exam history / generation |
| `/api/flashcards/generate` | POST | ✅ | Definitive flashcard set |
| `/api/srs/attempt` | POST | ✅ | Record an SRS attempt |
| `/api/upload/sign` | POST | ✅ | Signed upload URL |
| `/api/upload/finalize` | POST | ✅ | Extract text after upload |
| `/api/drive/import` | POST | ✅ | Import from Google Drive |
| `/api/chargily/checkout` | POST | ✅ | Create a payment |
| `/api/chargily/webhook` | POST | ❌ HMAC | **Activates subscriptions** |
| `/api/curriculum` | GET | ❌ public | Reference catalogue |
| `/api/push/dispatch` | POST | ❌ CRON_SECRET | Hourly push sweep |

---

## Appendix C — Incident log

Real production incidents, their causes, and where the fix lives. Read these
before modifying the corresponding subsystem.

### C.1 — IDOR in course chat *(critical, fixed)*

**Symptom:** none observed — found by audit.
**Cause:** `/api/courses/chat` derived a course id from a client-supplied slug
(`studio-course-<N>`) and passed it to a retrieval helper querying by
`course_id` alone through the **service-role** client. Because
`studio_courses.id` is a sequential `bigint`, any authenticated student could
read any other student's private course content and generated Explication by
iterating small integers.
**Fix:** verify ownership before the id is used; fail open to "no context" so it
cannot become an id-enumeration oracle.
**Lesson:** invariant #1. RLS does not protect server code.

### C.2 — Open redirect in the auth flow *(critical, fixed)*

**Cause:** the `next` query parameter was concatenated raw into a post-auth
redirect. `?next=@evil.com` makes `origin + next` parse with `evil.com` as the
host — confirmed against both Next's redirect helper and the browser URL parser.
**Fix:** `lib/safe-redirect.ts`, applied in the callback route and `LoginForm`.

### C.3 — The timeout that could never fire *(critical, fixed)*

**Symptom:** `flux terminé sans résultat après 280s` — the stream closing with
no error, repeatedly, on heavy courses.
**Cause:** `clearTimeout` ran in a `finally` attached to the fetch, which
resolves on response **headers** (~2 s). The abort was disarmed almost
immediately and the multi-minute body read ran completely unguarded. The
configured `timeoutMs` was irrelevant to the phase consuming the time.
**Fix:** keep the timer armed across the body read; lower the undici backstop
below the platform wall.
**Lesson:** this also retroactively explained the `waitUntil` failure — that
timeout was not unreliable, it was structurally incapable of firing.

### C.4 — Quota charged 2–3× *(fixed)*

**Cause:** quota reservation lived inside the retried per-part step.
**Fix:** reserve exactly once in `explication-start`, which is never retried.

### C.5 — Generation time independent of input size *(fixed)*

**Symptom:** a part, its half, and its quarter all timed out at ~200 s.
**Cause:** `14,000 max_tokens ÷ 200 s = 70 tok/s` — the model generated flat out
to the ceiling regardless of input, because the prompt forbade stopping for
length. Input chunking could never have helped.
**Fix:** bound the **output** via an explicit per-part word budget; lower
`max_tokens`.

### C.6 — Invisible retries reported as "no retry" *(fixed)*

**Cause:** retry logic existed and worked, but `onProgress` had zero consumers
and the error carried no attempt count. Retries were indistinguishable from a
hang.
**Fix:** surface progress in the UI; include the attempt count in the final
error.
**Lesson:** unobservable recovery is functionally equivalent to no recovery.

### C.7 — Refresh-token race *(mitigated)*

**Cause:** multiple `GoTrueClient` instances plus middleware all rotating the
same single-use refresh token.
**Fix:** singleton browser client with `autoRefreshToken: false`; middleware
excludes `/api/**`; 401 treated as retryable once.

---

## Appendix D — Glossary

| Term | Meaning |
|---|---|
| **Studio** | The per-course generation workspace — the core product surface |
| **Section / tile** | One generated artefact (Résumé, QCM, …) |
| **Part** | One slice of a multi-request Explication generation |
| **Sub-part** | A further subdivision of a part after a timeout or truncation |
| **Heartbeat** | `{"type":"heartbeat"}` NDJSON line keeping a long connection alive |
| **Delta / cross-university reuse** | Reusing chapters from a similar course uploaded by another student |
| **Quota reservation** | Atomic check-and-increment of a plan counter before a billed call |
| **The wall** | Vercel's hard `maxDuration` kill at 280 s |
| **Truncation** | `finish_reason: "length"` — response cut off by `max_tokens` |
| **RLS** | Row Level Security, Postgres' per-row access control |
| **Service-role client** | Supabase client that bypasses RLS entirely |
| **SRS** | Spaced Repetition System (Leitner boxes) |

---

<div align="center">

**End of the MedArt AI Master Technical Handbook**

*Every figure in this document was measured from the codebase.
When you change a system, update its section — a stale handbook
is worse than none.*

</div>
