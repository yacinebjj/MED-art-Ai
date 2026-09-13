# MedArt AI — Developer Handbook

> Engineering documentation for the MedArt AI platform: an AI study environment
> for Algerian medical, pharmacy and dental students.
>
> **Audience:** a senior engineer taking ownership of this codebase.
> **Assumption:** you know TypeScript, React and SQL. You do *not* know this
> project. Everything project-specific is explained.

---

## Read this first

This handbook documents the system **as it actually is**, not as it was
designed on a whiteboard. Where a decision looks odd, there is usually a
production incident behind it — those are called out explicitly, because the
odd-looking code is frequently the load-bearing code.

Two habits will save you the most time here:

1. **Read the comment before changing the constant.** Several timeouts, token
   ceilings and slice sizes in this codebase look arbitrary. They are not.
   They were measured against Vercel's real execution wall and the model's
   real throughput, and each carries a comment explaining what broke last
   time. See [§5 Integrations](./05-integrations.md#the-explication-pipeline).
2. **Measure before you recalibrate.** The most expensive bugs in this
   project's history came from tuning a number against an *assumed* platform
   limit. Every such limit here has been empirically measured; the method is
   documented so you can re-measure on a different plan.

---

## Table of contents

| # | Document | What it answers |
|---|---|---|
| 1 | [Language & Tech Stack](./01-tech-stack.md) | Why TypeScript/Next.js, how strictness is enforced, SSR vs CSR in practice |
| 2 | [System Architecture & Data Flow](./02-architecture.md) | What happens end-to-end when a student clicks "generate" |
| 3 | [Project Directory Map](./03-directory-map.md) | Where every kind of file goes, and where to put new ones |
| 4 | [Database & Auth](./04-database-auth.md) | The 44-table schema, RLS model, session handling |
| 5 | [Third-Party Integrations](./05-integrations.md) | OpenRouter, Chargily Pay V2, Google Drive |
| 6 | [Contribution Guidelines](./06-contributing.md) | How to add a feature, commands, conventions, roadmap |

---

## The system in one page

```
Browser (Next.js App Router, React 18)
   │
   ├── Server Components ──► direct Supabase reads (service-role, server-only)
   │
   └── Client Components ──► fetch() ──► /app/api/** (80 route handlers)
                                            │
                                            ├── getAuthenticatedUser()   ← auth gate
                                            ├── rateLimit()              ← abuse gate
                                            ├── reserveGeneration()      ← quota gate
                                            │
                                            ├──► Supabase (PostgreSQL + Storage + Auth)
                                            ├──► OpenRouter  (all AI generation)
                                            ├──► Chargily Pay V2 (DZD payments)
                                            └──► Google Drive REST (source import)
```

### Scale, as of this writing

| Metric | Count |
|---|---|
| API route handlers (`app/api/**/route.ts`) | 80 |
| Pages (`page.tsx`) | 21 |
| React components | 137 |
| Library modules (`lib/**/*.ts`) | 117 |
| Custom hooks | 9 |
| PostgreSQL tables | 44 |
| Tables with RLS enabled | 44 (100%) |
| RLS policies | 46 |

---

## Non-negotiable invariants

These are the rules that, if broken, cause either data leakage or a billing
incident. They are enforced by convention and code review, not by the type
system — so they need to be in your head.

1. **The service-role Supabase client bypasses RLS. Every route using it must
   scope its own queries by `user_id`.** RLS is a safety net for the *anon*
   key, not for server code. A route that reads a table by a client-supplied
   id without `.eq("user_id", user.id)` is an IDOR. This has happened —
   see [§4](./04-database-auth.md#the-service-role-trap).
2. **Never expose a non-`NEXT_PUBLIC_` env var to the client.** In particular
   `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY` and `CHARGILY_SECRET_KEY`.
3. **Quota is reserved exactly once per delivered generation**, before the
   expensive call, and refunded on failure. Never inside a retryable step.
4. **No AI call without a rate limit.** Every route that reaches OpenRouter
   goes through `rateLimit(key, RATE_LIMITS.ai)`.
5. **Never send a course's full `raw_text` to the chat model.** Retrieval is
   top-K chunks only. The full-text fallback was removed deliberately — it was
   the dominant driver of a ~$0.04/message cost incident.

---

## Getting running locally

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev                        # http://localhost:3000
```

You need, at minimum, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` for the app
to boot and generate anything. See [§6](./06-contributing.md#environment-variables)
for the full matrix of what each key unlocks.
