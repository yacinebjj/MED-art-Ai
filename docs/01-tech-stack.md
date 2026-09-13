# 1. Language & Tech Stack Deep Dive

[← Back to index](./README.md)

---

## 1.1 The stack, and why each piece is here

| Layer | Technology | Why this one |
|---|---|---|
| Language | **TypeScript** (ES2017 target) | The domain is medical content with many overlapping shapes (a QCM, a clinical case, a flashcard, an exam question). Structural typing catches shape drift between the AI's JSON output, the DB row and the React prop — the three places this app most often breaks. |
| Framework | **Next.js 14 (App Router)** | One deployable unit for UI *and* API. Critically, it gives per-route runtime config (`maxDuration`, `runtime`), which this app depends on heavily because AI generation runs for minutes. |
| UI | **React 18 + Tailwind CSS** | Tailwind keeps styling colocated with markup; with 137 components and one designer-less team, a utility system beats a parallel stylesheet hierarchy. |
| Data / Auth / Storage | **Supabase (PostgreSQL)** | Postgres with Row Level Security, plus auth and object storage, without running infrastructure. `pgvector` is used for semantic chunk matching. |
| AI | **OpenRouter** | A single API key and one HTTP shape across many model providers. Lets the app switch models per feature by changing a string constant, with no SDK churn. |
| Payments | **Chargily Pay V2** | The practical option for DZD payments (Edahabia / CIB) for an Algerian audience. |
| Hosting | **Vercel** | First-class Next.js support. Its serverless execution ceiling is the single most important constraint on this codebase's architecture — see §1.4. |

---

## 1.2 TypeScript strictness: how it is actually enforced

`tsconfig.json` runs with **`"strict": true`**, which enables the whole strict
family — `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`,
`strictPropertyInitialization` and the rest.

```jsonc
{
  "compilerOptions": {
    "strict": true,          // ← the important one
    "noEmit": true,          // tsc type-checks only; Next/SWC does the compiling
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }   // every internal import is "@/lib/…", never "../../.."
  }
}
```

Two consequences worth internalising:

**`noEmit: true`** means `tsc` is a *linter* here, not a build step. `next build`
compiles with SWC and performs its own type-check pass. So `npx tsc --noEmit` is
the fast local gate; `next build` is the authoritative one.

**The `@/*` path alias is mandatory by convention.** There are no relative
parent imports (`../../lib/...`) anywhere in the codebase. If you find yourself
writing one, you are in the wrong directory.

### The `any` situation — measured, not assumed

A common fear on handover is "the codebase is full of `any`". It is not. The
actual count across `app/`, `lib/`, `components/`, `providers/`, `hooks/` and
`types/`:

| Directory | `any` occurrences |
|---|---|
| `lib/` | 18 |
| `app/` | 6 |
| `components/` | 2 |
| `providers/`, `hooks/`, `types/` | 0 |
| **Total** | **26** |

Across ~380 source files, that is a low density — and the concentrations are
deliberate, not lazy:

- **`lib/supabase/server.ts` (3)** — the admin client is typed
  `SupabaseClient<any, any, any>` because this project does not run
  `supabase gen types`. If you introduce generated types, this is the one file
  to change and everything downstream tightens for free.
- **`lib/ai/openrouter.ts` (5)** — the shape of a third-party JSON response
  before validation. These are *parse boundaries*: the value genuinely is
  unknown until checked. The correct fix is not a hand-written interface but a
  runtime schema (the project already uses Zod elsewhere — see below).
- **`lib/google-drive-picker.ts` (2)** — Google's global `window.google` SDK,
  which ships no types.

**Rule of thumb for new code:** `any` is acceptable *only* at an I/O boundary,
and only until the value is validated. Once validated, it must be a real type.

### Where types actually live

| Kind of type | Where | Example |
|---|---|---|
| Domain models shared across features | `types/*.ts` (7 files) | `types/studio-course.ts`, `types/academic.ts`, `types/flashcard.ts` |
| Runtime-validated AI output | `lib/ai/*-schemas.ts` (Zod) | `lib/ai/studio-schemas.ts`, `lib/ai/exam-schemas.ts` |
| Local to one module | Declared in that file | `interface StudioCourseFullRow` |

The distinction that matters: **`types/` describes what the app believes;
`lib/ai/*-schemas.ts` describes what it will accept from the model.** AI output
is never trusted into the database without a `safeParse` — see
[§5](./05-integrations.md#never-trust-model-output).

---

## 1.3 Next.js App Router: how this app uses it

### Server Components vs Client Components, in practice

155 files carry `"use client"`. That is a high proportion, and it is worth
understanding *why* before you try to "fix" it:

MedArt AI is not a content site. Its core surfaces — the Studio workspace, the
chat panel, the exam runner, the flashcard deck — are **stateful, long-lived,
interactive views**. A generation runs for minutes while the student navigates;
that state lives in React. Those components are legitimately client components.

Server Components are used where they pay off:

- **Page shells and metadata** (`app/(auth)/login/page.tsx` exports `metadata`
  and renders a client `<LoginForm/>` inside `<Suspense>`).
- **Static presentation** — `app/not-found.tsx` is a Server Component and ships
  zero client JS.

**The boundary rule:** push `"use client"` **down**, not up. A page should be a
Server Component that renders a small client island, rather than a client
component wrapping the whole tree. When adding a feature, ask: *does this need
state, effects, or event handlers?* If not, leave it on the server.

> ⚠️ **The one thing that will bite you:** `lib/supabase/server.ts` exports
> `getSupabaseAdmin()`, which reads `SUPABASE_SERVICE_ROLE_KEY`. It must never
> be imported — even transitively — from a file that carries `"use client"`, or
> the key is bundled to the browser. Treat any import path that reaches it as
> server-only.

### Route Segment Config — the part that is load-bearing here

Most Next.js apps never touch this. This one depends on it:

```ts
export const runtime = "nodejs";   // not edge: needs Buffer, undici Agent, officeparser
export const maxDuration = 280;    // seconds; measured, see below
```

`maxDuration` is declared per route because AI generation legitimately runs for
minutes. `runtime = "nodejs"` is required (not optional) on any route that does
document extraction or uses the custom undici dispatcher.

### Rendering modes actually in use

| Mode | Where | Notes |
|---|---|---|
| Static (SSG) | Marketing/auth pages (`/`, `/login`, `/register`, `/pricing`) | Prerendered at build |
| Dynamic SSR | `/dashboard/module/[id]`, `/study`, group pages | Per-request, session-dependent |
| Client-side | All Studio generation, chat, exam runner | Driven by `fetch()` to `/api/**` |
| Streaming (NDJSON) | Explication parts, podcast | Custom heartbeat protocol, see §5 |

---

## 1.4 The constraint that shapes everything: Vercel's execution wall

You cannot understand this codebase's architecture without this fact.

**A Vercel serverless invocation is hard-killed at its `maxDuration`.** Not
warned — killed. No `catch`, no `finally`, no chance to write a response. The
client just sees the connection close.

This was measured empirically on this project's own plan with a throwaway
diagnostic route:

| Test | Result |
|---|---|
| 270s sleep under `maxDuration = 280` | ✅ HTTP 200 |
| 277s sleep under `maxDuration = 280` | ✅ HTTP 200 |
| 285s sleep under `maxDuration = 280` | ❌ `FUNCTION_INVOCATION_TIMEOUT` at **280.88s** |

So the wall is real, precise, and enforced exactly at the declared value.

Three architectural consequences follow, and they explain most of what looks
unusual in this repo:

1. **Long generations are split into multiple HTTP requests**, sequenced from
   the *browser*, not looped on the server. One request per part.
   (`lib/studio-explication-client.ts`)
2. **Every long request streams a heartbeat** so intermediaries never see an
   idle connection. (`lib/heartbeat-fetch.ts`)
3. **Every timeout inside a request is set meaningfully below the wall**, so an
   overrun produces a clean, retryable error instead of a silent kill.

> **Hard-won lesson, encoded here so it is not relearned:** background work via
> `waitUntil` was tried and abandoned. A pure background *timer* runs fine for
> 240s+, but a real OpenRouter fetch inside `waitUntil` hung indefinitely on
> this account. The foreground, heartbeat-streamed design is the one proven to
> work. Do not "simplify" it back into a background job without re-running that
> experiment.

---

## 1.5 Tooling and quality gates

```bash
npx tsc --noEmit   # type check (fast, run constantly)
npm run lint       # next lint / ESLint
npm run build      # authoritative: type check + compile + route table
```

**The build is the real gate.** A clean `tsc` does not guarantee a clean build.
Two known-acceptable lint warnings exist (`<img>` usage in
`app/dashboard/(shell)/assistant/page.tsx` and
`components/course/workspace/InfographicViewer.tsx`) — anything beyond those two
is new and should be fixed, not normalised.

[Next: System Architecture & Data Flow →](./02-architecture.md)
