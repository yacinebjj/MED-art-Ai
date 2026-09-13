# 3. Project Directory Map

[← Back to index](./README.md)

---

## 3.1 Top level

```
med-art-ai/
├── app/              # Next.js App Router: pages, layouts AND API routes
├── components/       # React components, grouped by feature (137 files)
├── lib/              # All business logic, integrations, helpers (117 files)
├── hooks/            # Reusable React hooks (9)
├── providers/        # React context providers mounted in the root layout (7)
├── types/            # Shared domain types (7)
├── supabase/         # schema.sql — the single source of truth for the DB
├── scripts/          # One-off maintenance/migration scripts (not shipped)
├── public/           # Static assets, PWA manifest, service worker (sw.js)
└── docs/             # ← you are here
```

**The mental model:** `lib/` is the brain, `app/` is the delivery mechanism,
`components/` is the face. Business logic that could theoretically be called
from two different routes belongs in `lib/`, never in a route handler.

---

## 3.2 `app/` — routes, pages and API

```
app/
├── layout.tsx            # root layout: fonts + all providers
├── page.tsx              # public landing page
├── globals.css           # Tailwind layers + design tokens
├── error.tsx             # ⚠️ route-segment Error Boundary
├── global-error.tsx      # ⚠️ root-layout Error Boundary (renders its own <html>)
├── not-found.tsx         # 404
│
├── (auth)/               # route GROUP — parentheses = no URL segment
│   ├── login/            #   → /login
│   └── register/         #   → /register
│
├── auth/callback/        # Supabase email-confirmation handler (real URL)
│
├── dashboard/
│   ├── layout.tsx
│   ├── loading.tsx
│   ├── (shell)/          # pages sharing the sidebar/topbar chrome
│   ├── module/[id]/      # the Studio workspace — the app's centre of gravity
│   ├── workspace/
│   ├── audio-workspace/
│   ├── search/
│   └── demo/
│
├── study/                # full-page SRS/flashcard runner (no dashboard chrome)
├── pricing/
│
└── api/                  # 80 route handlers
    ├── studio/           #   Studio generation (the core AI product)
    ├── exam/             #   exam generator + attempts
    ├── flashcards/       #   spaced-repetition deck
    ├── srs/              #   SRS attempts & mastery
    ├── courses/          #   course chat (RAG)
    ├── notes/  groups/  study-planner/  lecture-notes/
    ├── chargily/         #   checkout + webhook
    ├── drive/            #   Google Drive import
    ├── curriculum/       #   public reference catalogue
    ├── upload/           #   signed-URL upload + finalize
    ├── push/             #   Web Push subscribe/dispatch
    └── profile/  search/  subscription/  workspace/  assistant/  modules/  highlights/  generate/
```

### Route groups and what they mean

`(auth)` and `(shell)` are **route groups**: the parentheses keep them out of
the URL. `app/(auth)/login/page.tsx` serves `/login`, not `/auth/login`.

> This trips people up when searching. If you are looking for the login page,
> `app/login/` does not exist — it is `app/(auth)/login/`.

### Special files (Next.js conventions)

| File | Purpose | Runs on |
|---|---|---|
| `layout.tsx` | Persistent shell around a segment | Server (unless marked) |
| `page.tsx` | The route's own UI | Server (unless marked) |
| `loading.tsx` | Suspense fallback while the segment loads | — |
| `error.tsx` | Error Boundary for the segment | **Client** (required) |
| `global-error.tsx` | Catches root-layout failures; renders its own `<html>` | **Client** (required) |
| `not-found.tsx` | 404 | Server |
| `route.ts` | API handler (`GET`/`POST`/`PATCH`/`DELETE`) | Server |

---

## 3.3 `lib/` — the brain

```
lib/
├── ai/                  # everything that talks to a model
│   ├── openrouter.ts        # THE gateway — every AI call goes through here
│   ├── studio-prompts.ts    # system prompts per Studio section
│   ├── studio-schemas.ts    # Zod schemas validating model output
│   ├── exam-prompts.ts / exam-schemas.ts
│   ├── flashcard-prompts.ts / flashcard-schemas.ts
│   ├── infographic-prompts.ts
│   └── embeddings.ts
│
├── supabase/            # client factories — pick the right one (see §4)
│   ├── client.ts            # browser, anon key, singleton
│   ├── server.ts            # service-role, SERVER ONLY, bypasses RLS
│   ├── middleware.ts        # session refresh for middleware.ts
│   └── session-server.ts    # getAuthenticatedUser()
│
├── search/              # chunking + retrieval for RAG
├── push/                # Web Push dispatch
├── audio/               # browser audio chunking / mp3 encoding
├── prompts/             # prompt builders for the legacy public-course pipeline
├── translations/        # FR/EN UI strings, per feature
│
└── (root-level modules — one per domain concern)
    ├── studio-explication-client.ts   # browser-side orchestrator for Explication
    ├── studio-explication-delta.ts    # slicing, budgets, per-part generation
    ├── heartbeat-fetch.ts             # NDJSON heartbeat stream reader
    ├── rate-limit.ts
    ├── subscription.ts                # plan quota reserve/refund
    ├── safe-redirect.ts               # open-redirect guard
    ├── document-extraction.ts         # PDF/DOCX/PPTX → text
    ├── course-generation-shared.ts    # sanitizeForPostgres, parseJsonResponse, …
    └── …
```

### Where do I put a new file?

| You are writing… | Put it in | Naming |
|---|---|---|
| A new API endpoint | `app/api/<feature>/route.ts` | folder = URL segment |
| A page | `app/<segment>/page.tsx` | |
| A reusable UI primitive | `components/ui/` | `PascalCase.tsx` |
| A feature-specific component | `components/<feature>/` | `PascalCase.tsx` |
| Business logic / an integration | `lib/` (or `lib/<area>/`) | `kebab-case.ts` |
| A model prompt | `lib/ai/<feature>-prompts.ts` | |
| A Zod schema for model output | `lib/ai/<feature>-schemas.ts` | |
| A type used by 2+ features | `types/<domain>.ts` | |
| A React hook | `hooks/useThing.ts` | `useCamelCase.ts` |

**Naming conventions in force:**

- Files: `kebab-case.ts` for logic, `PascalCase.tsx` for components.
- Components and types: `PascalCase`. Variables and functions: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE` (`MAX_FILE_BYTES`, `RATE_LIMITS`).
- Imports: always `@/…`, never `../../`.

---

## 3.4 `components/` — grouped by feature, not by type

```
components/
├── ui/            # design-system primitives: Button, Dialog, Input, Toast, Tooltip…
├── layout/        # Sidebar, Topbar, Logo, ThemeToggle
├── course/        # course workspace + Studio panels (the largest group)
├── dashboard/     # dashboard widgets, UploadModal, DriveBrowser
├── auth/          # LoginForm, RegisterForm, AuthLayout
├── study/ groups/ notes/ todo/ billing/ pricing/ curriculum/
├── assistant/ visual-studio/ settings/ push/ pwa/ security/
```

The rule: **`components/ui/` is generic and knows nothing about medicine.**
Everything else may know about the domain. If a component imports from
`lib/ai/`, it does not belong in `ui/`.

---

## 3.5 `providers/`, `hooks/`, `types/`

**`providers/`** — mounted in `app/layout.tsx`, so they wrap the entire app.
Order matters (Theme → Language → Pomodoro → Tooltip → Toast → Push → Security).
`AuthProvider` exposes `useAuth()` with the current user, profile, trial and
subscription state.

**`hooks/`** — 9 reusable hooks. Notable ones:
`useMediaQuery` (responsive logic in JS), `useKeyboardInset` (iOS Safari
on-screen-keyboard handling), `useTextSelection` (highlight capture),
`useSecurityGuard`, `useCourseChat`.

**`types/`** — 7 domain modules. These describe *the app's* model; they are not
generated from the database. If you adopt `supabase gen types`, generated types
should live alongside these, not replace them.

---

## 3.6 `supabase/` and `scripts/`

`supabase/schema.sql` is the **authoritative schema** — 44 tables with their RLS
policies and RPC functions. It is hand-maintained.

> ⚠️ **Migration caveat:** this project has no migration runner. `schema.sql` is
> the intent; the live database is the reality, and they can drift. Several
> tables were originally created by hand in the Supabase SQL editor and added to
> `schema.sql` afterwards. **Before relying on a column, verify it exists in the
> live database.** Formalising migrations is the top item on the roadmap
> ([§6](./06-contributing.md#roadmap)).

`scripts/` holds one-off maintenance scripts. They are not part of the build and
not deployed.

[Next: Database & Auth →](./04-database-auth.md)
